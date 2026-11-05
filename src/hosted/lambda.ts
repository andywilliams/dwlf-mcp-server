import { DWLFClient } from '../client.js';
import { createCatalogueLoader } from '../data/nodeCatalogue.js';
import { createExplainIndexLoader } from '../tools/onchain-catalogue.js';
import { createTokenVerifier } from './auth.js';
import { ExchangeMinter, KmsSealer, ssmSecret } from './aws.js';
import { loadHostedSettings, type HostedConfig } from './config.js';
import { UpstreamCredentials } from './credentials.js';
import { createHostedHandler } from './handler.js';
import { CallLimiter } from './limits.js';
import { DynamoStore } from './store.js';

/**
 * The hosted MCP's Lambda entry (DWLF-622), behind an API Gateway REST API (regional, so WAF attaches; infra/).
 * Everything that is the same for every caller is built once per instance; everything caller-specific is built per
 * request inside the handler. With HOSTED_MCP_ENABLED off this builds nothing and answers 404 to everything.
 */

export type ProxyEvent = {
  httpMethod: string;
  path: string;
  headers?: Record<string, string | undefined> | null;
  multiValueQueryStringParameters?: Record<string, string[] | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
};

export type ProxyResult = { statusCode: number; headers: Record<string, string>; body: string };

/**
 * One bare JSON line per event, written to stdout directly. Lambda's text log format prefixes `console.*` lines with
 * a timestamp, request id and level, which stops CloudWatch's JSON metric filters (`{ $.event = … }`, the stack's log
 * alarms) from matching; raw stdout lines are not prefixed.
 */
export const logLine = (entry: Record<string, unknown>, write: (line: string) => void = (l) => { process.stdout.write(l); }) =>
  write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
const log = (entry: Record<string, unknown>) => logLine(entry);

/**
 * API Gateway's proxy event → a Request on the CANONICAL origin. The Host header the caller sent is never used to
 * build the URL, so a forged Host can't change which resource the request is for.
 */
export function toRequest(event: ProxyEvent, canonical: string): Request {
  const url = new URL(event.path, canonical);
  for (const [k, values] of Object.entries(event.multiValueQueryStringParameters ?? {})) {
    for (const v of values ?? []) url.searchParams.append(k, v);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) if (v !== undefined) headers.set(k, v);
  const hasBody = event.body != null && event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD';
  const body = hasBody ? (event.isBase64Encoded ? Buffer.from(event.body as string, 'base64') : event.body as string) : undefined;
  return new Request(url, { method: event.httpMethod, headers, body });
}

export async function toResult(response: Response): Promise<ProxyResult> {
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  return { statusCode: response.status, headers, body: await response.text() };
}

function buildDeps(config: HostedConfig) {
  const store = new DynamoStore(config.tableName);
  const minter = new ExchangeMinter({
    tokenExchangeUrl: config.tokenExchangeUrl,
    revocationUrl: config.revocationUrl,
    apiResource: `${config.apiBaseUrl}/v2`,
    clientId: config.exchangeClientId,
    clientSecret: ssmSecret(config.exchangeClientSecretParam),
  });
  // The node catalogue and the explain index are public and the same for everyone: one loader each per instance, on a
  // client with NO key, so they never run on (or bill) any caller's account.
  const catalogueClient = new DWLFClient({ apiKey: undefined, baseURL: config.apiBaseUrl, timeoutMs: 5000, quiet: true });
  return {
    verify: createTokenVerifier(config),
    credentials: new UpstreamCredentials(store, minter, new KmsSealer(config.kmsKeyId), log),
    limiter: new CallLimiter(store, config.limits, config.callDeadlineMs + 5000, log),
    // Both read public, caller-independent data (the node catalogue, the explain index), on the keyless client.
    shared: {
      catalogue: createCatalogueLoader((path) => catalogueClient.get(path)),
      explainIndex: createExplainIndexLoader((path) => catalogueClient.get(path)),
    },
    // Set by the stack from package.json at deploy time (the bundle has no package.json beside it).
    version: process.env.HOSTED_MCP_VERSION ?? 'unknown',
    log,
  };
}

const settings = loadHostedSettings(process.env);
const handle = createHostedHandler(settings, settings.enabled ? buildDeps(settings) : undefined);
const canonical = settings.enabled ? settings.resource : 'https://localhost/';

export async function handler(event: ProxyEvent): Promise<ProxyResult> {
  try {
    return await toResult(await handle(toRequest(event, canonical)));
  } catch (error) {
    log({ event: 'hosted-mcp-unhandled', error: (error as Error).message });
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }) };
  }
}
