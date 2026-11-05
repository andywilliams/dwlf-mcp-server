import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { HostedConfig } from './config.js';
import { HOSTED_SCOPES } from './scopes.js';

/**
 * The OAuth 2.1 resource-server half of the hosted MCP (DWLF-622; docs/HOSTED-MCP.md §2, §4). This server only
 * VERIFIES access tokens; the authorization server issues them. A token is accepted only when it is:
 * - a JWT access token (`typ: at+jwt`, RFC 9068), signed ES256 by a key in the issuer's JWKS;
 * - from the configured issuer, and audience-bound to this server's canonical URI (RFC 8707): a token minted for
 *   any other resource, including DWLF's own API, is refused, which is what stops token passthrough;
 * - in date, and naming a subject (`sub`, the SPT account) and a client (`client_id`, RFC 9068 §2.2).
 * Every refusal is a 401 with the same body; the reason goes to the log, never to the caller.
 */

export type Caller = {
  /** The authorization server that issued the token: part of the account's identity (a `sub` is only unique per issuer). */
  issuer: string;
  /** The account the token acts for, as that issuer names it. */
  sub: string;
  /** The OAuth client acting for it. */
  clientId: string;
  scopes: ReadonlySet<string>;
  /** Seconds since the epoch. */
  expiresAt: number;
};

export type TokenVerifier = (token: string) => Promise<Caller>;

export class InvalidTokenError extends Error {}

/** A verifier against the issuer's published keys (fetched lazily, cached and re-fetched on an unknown `kid` by jose). */
export function createTokenVerifier(
  config: Pick<HostedConfig, 'issuer' | 'jwksUri' | 'resource'>,
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUri), { timeoutDuration: 3000, cooldownDuration: 30000 }),
): TokenVerifier {
  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ['ES256'],
        typ: 'at+jwt',
        requiredClaims: ['sub', 'exp', 'iat', 'client_id'],
        clockTolerance: 30,
      }));
    } catch (error) {
      throw new InvalidTokenError(error instanceof Error ? error.message : String(error));
    }
    const { iss, sub, client_id: clientId, scope, exp } = payload as { iss?: string; sub?: unknown; client_id?: unknown; scope?: unknown; exp?: number };
    if (typeof sub !== 'string' || !sub) throw new InvalidTokenError('sub is not a non-empty string');
    if (typeof clientId !== 'string' || !clientId) throw new InvalidTokenError('client_id is not a non-empty string');
    if (scope !== undefined && typeof scope !== 'string') throw new InvalidTokenError('scope is not a string');
    const scopes = new Set((scope ?? '').split(' ').filter(Boolean));
    return { issuer: iss as string, sub, clientId, scopes, expiresAt: exp as number };
  };
}

/** The bearer token in an Authorization header, or null. The scheme is case-insensitive (RFC 7235). */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+([A-Za-z0-9\-._~+/]+=*)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** RFC 9728 §3.1: the metadata lives at the well-known path with the resource's path appended. */
export function metadataPath(resource: string): string {
  const { pathname } = new URL(resource);
  return `/.well-known/oauth-protected-resource${pathname === '/' ? '' : pathname}`;
}

export function metadataUrl(resource: string): string {
  return new URL(metadataPath(resource), resource).toString();
}

/** RFC 9728 Protected Resource Metadata. */
export function protectedResourceMetadata(config: Pick<HostedConfig, 'resource' | 'issuer' | 'resourceName'>) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: HOSTED_SCOPES,
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['ES256'],
    resource_name: config.resourceName,
    resource_documentation: 'https://block.dwlf.co.uk/docs/agents',
  };
}

const quoted = (value: string) => `"${value.replace(/["\\]/g, '')}"`;

/**
 * The `WWW-Authenticate` value for a 401 (no or invalid token) or a 403 (`insufficient_scope`, the step-up).
 * Always carries `resource_metadata`, so a client can discover the authorization server (MCP authorization spec).
 */
export function challenge(
  resource: string,
  options: { error?: 'invalid_token' | 'insufficient_scope'; scopes?: readonly string[]; description?: string } = {},
): string {
  const parts = [`resource_metadata=${quoted(metadataUrl(resource))}`];
  if (options.error) parts.push(`error=${quoted(options.error)}`);
  if (options.scopes?.length) parts.push(`scope=${quoted(options.scopes.join(' '))}`);
  if (options.description) parts.push(`error_description=${quoted(options.description)}`);
  return `Bearer ${parts.join(', ')}`;
}
