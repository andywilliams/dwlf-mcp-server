/**
 * The hosted MCP's configuration (DWLF-622; docs/HOSTED-MCP.md). Read once per process from the environment.
 *
 * `HOSTED_MCP_ENABLED` is the flag, and it is OFF unless it is exactly "true": with it off, every path answers 404
 * and nothing else is read or validated, so the stack can be deployed dark. With it on, a missing or malformed
 * setting is a startup error, never a default that quietly widens what the endpoint accepts.
 */

export type HostedLimits = {
  /** `tools/call` per (sub, client_id) per minute, before SPT's own per-account plan limits. */
  callsPerMinute: number;
  /** The same tool with the same arguments per (sub, client_id) per minute: an agent loop. */
  repeatsPerMinute: number;
  /** In-flight `tools/call` per account (all its clients), across every Lambda instance. */
  maxInFlight: number;
};

export type HostedConfig = {
  enabled: true;
  /** The canonical URI of this MCP server: the audience every access token must carry (RFC 8707). */
  resource: string;
  /** The authorization server's issuer identifier (`iss`), exactly as it publishes it (RFC 8414). */
  issuer: string;
  /** Where its signing keys are published. */
  jwksUri: string;
  /** The DWLF API base URL (no /v2), which every tool calls with the account's managed key. */
  apiBaseUrl: string;
  /** The credential + limit table, and the KMS key that encrypts each stored managed key. */
  tableName: string;
  kmsKeyId: string;
  /** The authorization server's token-exchange and revocation endpoints (docs/HOSTED-MCP.md §4.2). */
  tokenExchangeUrl: string;
  revocationUrl: string;
  /** This server's own client id at the authorization server, and the SSM parameter holding its secret. */
  exchangeClientId: string;
  exchangeClientSecretParam: string;
  /** Scopes the 401 challenge asks for by default; the rest are stepped up to. */
  defaultScopes: readonly string[];
  limits: HostedLimits;
  /** The host's deadline for one `tools/call`, and each upstream request's timeout (below it). */
  callDeadlineMs: number;
  upstreamTimeoutMs: number;
  maxBodyBytes: number;
  resourceName: string;
};

export type HostedSettings = { enabled: false } | HostedConfig;

const DEFAULT_LIMITS: HostedLimits = { callsPerMinute: 60, repeatsPerMinute: 10, maxInFlight: 4 };

type Env = Record<string, string | undefined>;

const required = (env: Env, name: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Hosted MCP: ${name} is required when HOSTED_MCP_ENABLED=true.`);
  return value;
};

const httpsUrl = (env: Env, name: string): string => {
  const value = required(env, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Hosted MCP: ${name} must be an absolute URL (got "${value}").`);
  }
  if (url.protocol !== 'https:') throw new Error(`Hosted MCP: ${name} must be https (got "${value}").`);
  return value;
};

const positiveInt = (env: Env, name: string, fallback: number): number => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Hosted MCP: ${name} must be a positive integer (got "${raw}").`);
  return n;
};

export function loadHostedSettings(env: Env): HostedSettings {
  if (env.HOSTED_MCP_ENABLED !== 'true') return { enabled: false };

  const resource = httpsUrl(env, 'HOSTED_MCP_RESOURCE');
  // RFC 8707 resource indicators: an absolute URI with no fragment. Compared byte for byte against `aud`.
  if (new URL(resource).hash) throw new Error('Hosted MCP: HOSTED_MCP_RESOURCE must not carry a fragment.');
  const callDeadlineMs = positiveInt(env, 'HOSTED_MCP_CALL_DEADLINE_MS', 24000);
  const upstreamTimeoutMs = positiveInt(env, 'HOSTED_MCP_UPSTREAM_TIMEOUT_MS', 20000);
  if (upstreamTimeoutMs >= callDeadlineMs) {
    throw new Error('Hosted MCP: HOSTED_MCP_UPSTREAM_TIMEOUT_MS must be below HOSTED_MCP_CALL_DEADLINE_MS.');
  }

  return {
    enabled: true,
    resource,
    issuer: httpsUrl(env, 'HOSTED_MCP_ISSUER'),
    jwksUri: httpsUrl(env, 'HOSTED_MCP_JWKS_URI'),
    apiBaseUrl: httpsUrl(env, 'HOSTED_MCP_API_BASE_URL'),
    tableName: required(env, 'HOSTED_MCP_TABLE'),
    kmsKeyId: required(env, 'HOSTED_MCP_KMS_KEY_ID'),
    tokenExchangeUrl: httpsUrl(env, 'HOSTED_MCP_TOKEN_EXCHANGE_URL'),
    revocationUrl: httpsUrl(env, 'HOSTED_MCP_REVOCATION_URL'),
    exchangeClientId: required(env, 'HOSTED_MCP_EXCHANGE_CLIENT_ID'),
    exchangeClientSecretParam: required(env, 'HOSTED_MCP_EXCHANGE_CLIENT_SECRET_PARAM'),
    defaultScopes: ['markets:read', 'events:read'],
    limits: {
      callsPerMinute: positiveInt(env, 'HOSTED_MCP_CALLS_PER_MINUTE', DEFAULT_LIMITS.callsPerMinute),
      repeatsPerMinute: positiveInt(env, 'HOSTED_MCP_REPEATS_PER_MINUTE', DEFAULT_LIMITS.repeatsPerMinute),
      maxInFlight: positiveInt(env, 'HOSTED_MCP_MAX_IN_FLIGHT', DEFAULT_LIMITS.maxInFlight),
    },
    callDeadlineMs,
    upstreamTimeoutMs,
    maxBodyBytes: 256 * 1024,
    resourceName: 'DWLF Block',
  };
}
