import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DWLFClient } from '../client.js';
import { filteredServer, PROFILE_INSTRUCTIONS } from '../profiles.js';
import { registerAll, type SharedCaches } from '../register.js';
import {
  AuthServerUnavailableError, bearerToken, challenge, InvalidTokenError, metadataPath, protectedResourceMetadata, type Caller, type TokenVerifier,
} from './auth.js';
import type { HostedConfig, HostedSettings } from './config.js';
import { CredentialUnavailableError, GrantRefusedError } from './credentials.js';
import type { CallLimiter } from './limits.js';
import { HOSTED_TOOLS, missingScopes, TOOL_SCOPES } from './scopes.js';
import { accountHash } from './store.js';

/**
 * The hosted MCP endpoint (DWLF-622; docs/HOSTED-MCP.md): Streamable HTTP, stateless, POST only, JSON responses,
 * as a Web-standard `Request → Response` function, so the Lambda adapter and the tests drive the same code.
 *
 * Per request, in order: the flag (off = 404 everywhere) → Origin → the RFC 9728 metadata → method → the bearer
 * token (401; checked BEFORE the body is read, so an unauthenticated caller's body never is) → body cap → for
 * `tools/call`: the tool's scopes (403 step-up), the MCP-level limits, the account's managed key → a fresh McpServer +
 * DWLFClient for this caller. The call deadline runs from the moment the request arrived, so the token check and the
 * credential work count against it and the host still answers before the Lambda's own timeout.
 *
 * Server-side clients only in v1: any request carrying an Origin header is refused (DNS rebinding, browser CSRF), and
 * there is no CORS. Browser clients would need both an allowlist and CORS (OPTIONS routes, exposed headers).
 *
 * The hosted server never sends the caller's token anywhere but the authorization server's token exchange, and makes
 * no policy: SPT enforces plans, scopes, licensing and quotas on the managed key (charter invariant).
 */

export type HostedDeps = {
  verify: TokenVerifier;
  credentials: {
    resolve(caller: Caller, accessToken: string): Promise<{ apiKey: string; keyId: string }>;
    forget(caller: Caller, keyId: string): Promise<void>;
  };
  limiter: Pick<CallLimiter, 'admit'>;
  shared: SharedCaches;
  version: string;
  log: (entry: Record<string, unknown>) => void;
  now?: () => number;
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: unknown; id?: JsonRpcId; method?: unknown; params?: { name?: unknown; arguments?: unknown } };

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

const rpcError = (status: number, code: number, message: string, id: JsonRpcId = null, headers: Record<string, string> = {}) =>
  json(status, { jsonrpc: '2.0', id, error: { code, message } }, headers);

/** A tool's own error, as the tool would have answered it: the agent reads it and adapts; it is not a protocol error. */
const toolError = (id: JsonRpcId, text: string) =>
  json(200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } });

async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createHostedHandler(settings: HostedSettings, deps?: HostedDeps): (req: Request) => Promise<Response> {
  if (!settings.enabled) {
    // Dark: nothing is served, and nothing says what would be.
    return async () => json(404, { error: 'not_found' });
  }
  if (!deps) throw new Error('Hosted MCP: dependencies are required when enabled.');
  return hostedHandler(settings, deps);
}

function hostedHandler(config: HostedConfig, deps: HostedDeps) {
  const now = deps.now ?? Date.now;
  const mcpPath = new URL(config.resource).pathname;
  const prmPaths = new Set([metadataPath(config.resource), '/.well-known/oauth-protected-resource']);
  const unauthorized = (error?: 'invalid_token', description?: string) =>
    rpcError(401, -32001, 'Unauthorized', null, {
      'WWW-Authenticate': challenge(config.resource, { error, scopes: config.defaultScopes, description }),
    });

  return async (req: Request): Promise<Response> => {
    const started = now();
    const url = new URL(req.url);
    // DNS rebinding / browser CSRF (MCP transport spec: an invalid Origin MUST be refused). No browser origin is valid
    // in v1 (see the header), so any Origin is refused.
    if (req.headers.get('origin')) return rpcError(403, -32000, 'Origin not allowed');

    if (prmPaths.has(url.pathname)) {
      if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
      return json(200, protectedResourceMetadata(config), { 'Cache-Control': 'public, max-age=3600' });
    }
    if (url.pathname !== mcpPath) return json(404, { error: 'not_found' });
    // 2026-07-28 is stateless: no GET stream, no session to DELETE.
    if (req.method !== 'POST') return rpcError(405, -32000, 'Method not allowed: POST only', null, { Allow: 'POST' });

    const token = bearerToken(req.headers.get('authorization'));
    if (!token) return unauthorized();
    let caller: Caller;
    try {
      caller = await deps.verify(token);
    } catch (error) {
      if (error instanceof AuthServerUnavailableError) {
        // Not the token's fault: a 401 would make every client discard its token during an AS outage.
        deps.log({ event: 'hosted-mcp-jwks-unavailable', error: error.message });
        return rpcError(503, -32000, 'Authorization server unavailable; retry shortly', null, { 'Retry-After': '30' });
      }
      if (!(error instanceof InvalidTokenError)) throw error;
      deps.log({ event: 'hosted-mcp-token-refused', reason: error.message });
      return unauthorized('invalid_token');
    }

    const raw = await readCapped(req, config.maxBodyBytes);
    if (raw === null) return rpcError(413, -32600, `Request body over ${config.maxBodyBytes} bytes`, null, { Connection: 'close' });
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(raw);
    } catch {
      return rpcError(400, -32700, 'Parse error');
    }
    // One message per POST: JSON-RPC batching left the MCP transport in 2025-06-18.
    if (!message || typeof message !== 'object' || Array.isArray(message)) return rpcError(400, -32600, 'Invalid request: one JSON-RPC message per POST');

    const id = message.id ?? null;
    const isCall = message.method === 'tools/call';
    const tool = isCall && typeof message.params?.name === 'string' ? message.params.name : null;
    const who = { account: accountHash(caller), clientId: caller.clientId };
    const done = (outcome: string, response: Response) => {
      deps.log({ event: 'hosted-mcp-request', ...who, method: message.method, tool, outcome, status: response.status, ms: now() - started });
      return response;
    };

    // Only a call to a hosted tool needs a credential or counts against the limits. Anything else (initialize,
    // tools/list, ping, an unknown tool) is answered by the server itself: the hosted server registers tools only
    // (no resources or prompts), so nothing but a tool ever calls the DWLF API, and its client here has no key.
    const deadlineAt = started + config.callDeadlineMs;
    if (!tool || !HOSTED_TOOLS.has(tool)) return done('protocol', await serve(message, null, caller, deadlineAt));

    if (!Object.hasOwn(TOOL_SCOPES, tool)) {
      // A hosted tool with no scope entry is a build mistake (the scope test catches it): refuse, never guess.
      return done('unmapped', toolError(id, `${tool} is not available on this endpoint yet.`));
    }
    const missing = missingScopes(tool, caller.scopes);
    if (missing.length) {
      // The step-up (MCP authorization spec): name every scope the client should hold, the ones it has included.
      const scopes = [...new Set([...caller.scopes, ...missing])];
      return done('insufficient_scope', rpcError(403, -32003, `Insufficient scope: ${tool} needs ${missing.join(' ')}`, id, {
        'WWW-Authenticate': challenge(config.resource, { error: 'insufficient_scope', scopes, description: `${tool} needs ${missing.join(' ')}` }),
      }));
    }

    const admission = await deps.limiter.admit(caller, tool, message.params?.arguments, now());
    if (!admission.ok) {
      const { refusal } = admission;
      return done(`limit_${refusal.kind}`, toolError(id, `${refusal.message} (retry after ${refusal.retryAfterSeconds} s)`));
    }
    try {
      let key: { apiKey: string; keyId: string };
      try {
        key = await deps.credentials.resolve(caller, token);
      } catch (error) {
        if (error instanceof GrantRefusedError) {
          // The user disconnected the client, or the grant lapsed: re-authorise. An ordinary event, so not alarmed.
          deps.log({ event: 'hosted-mcp-grant-refused', ...who, error: error.message });
          return done('grant_refused', unauthorized('invalid_token', 'the authorization behind this token has been revoked or has expired'));
        }
        deps.log({ event: 'hosted-mcp-credential-failed', ...who, error: (error as Error).message });
        const text = error instanceof CredentialUnavailableError
          ? `Could not get this connection's DWLF credential (${error.message}).`
          : 'Could not get this connection\'s DWLF credential. Try again shortly; if it persists, reconnect the DWLF connector.';
        return done('credential_failed', toolError(id, text));
      }
      if (now() >= deadlineAt) {
        return done('deadline', toolError(id, `Getting this connection's DWLF credential took too long. Try again.`));
      }
      return done('called', await serve(message, key, caller, deadlineAt));
    } finally {
      await admission.release();
    }
  };

  /** One message, through a fresh server for this caller, under the call deadline for a tool call. */
  async function serve(message: JsonRpcRequest, key: { apiKey: string; keyId: string } | null, caller: Caller, deadlineAt: number): Promise<Response> {
    const controller = new AbortController();
    let revoked = false;
    const client = new DWLFClient({
      apiKey: key?.apiKey,
      baseURL: config.apiBaseUrl,
      timeoutMs: config.upstreamTimeoutMs,
      signal: controller.signal,
      deadlineAt,
      quiet: true,
      onErrorStatus: (status) => {
        if (status === 401) revoked = true;
      },
    });
    const instructions = PROFILE_INSTRUCTIONS.block;
    const server = new McpServer({ name: 'dwlf', version: deps.version }, instructions ? { instructions } : undefined);
    registerAll(filteredServer(server, HOSTED_TOOLS, new Set(), { toolsOnly: true }), client, deps.shared);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let timer: NodeJS.Timeout | undefined;
    try {
      await server.connect(transport);
      // A synthetic request: the body is already read and parsed, and the transport reads only the headers it checks.
      const request = new Request(new URL(config.resource), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      });
      const handled = transport.handleRequest(request, { parsedBody: message });
      if (message.method !== 'tools/call') return await handled;
      const expired = new Promise<'expired'>((resolve) => { timer = setTimeout(() => resolve('expired'), Math.max(0, deadlineAt - now())); });
      const outcome = await Promise.race([handled, expired]);
      if (outcome === 'expired') {
        controller.abort(); // stops the tool's upstream requests, so nothing runs on after we answer
        handled.catch(() => {});
        return toolError(message.id ?? null,
          `This took longer than ${Math.round(config.callDeadlineMs / 1000)} s, so it was stopped. Try a narrower request (a shorter date range, fewer symbols).`);
      }
      return outcome;
    } finally {
      clearTimeout(timer);
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
      if (revoked && key) {
        // The API refused the managed key (revoked or expired at the source): drop it so the next call re-mints.
        await deps.credentials.forget(caller, key.keyId).catch((error) => deps.log({ event: 'hosted-mcp-forget-failed', error: (error as Error).message }));
      }
    }
  }
}
