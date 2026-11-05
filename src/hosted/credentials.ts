import type { Caller } from './auth.js';
import type { CredentialId, CredentialRecord, HostedStore } from './store.js';
import { credentialKey } from './store.js';

/**
 * The on-behalf-of credential (DWLF-622; docs/HOSTED-MCP.md §4.2). The OAuth access token is for this server only and
 * is never sent to the DWLF API (token passthrough is forbidden). Instead each (account, client) has a MANAGED API
 * KEY, minted by the authorization server through a token exchange (RFC 8693) with exactly the grant's scopes, stored
 * KMS-encrypted, and used for every call this client makes for this account. So SPT's per-key limits, licensing,
 * metering and scopes apply unchanged, and "what did this agent do" is one usage query.
 *
 * The key follows the grant: when the token's scopes differ from the key's (a step-up, or a narrowed grant), a new key
 * is exchanged for and swapped in under a conditional write on the record's version, then the old key is revoked.
 * Two requests racing to re-mint: one write wins and the loser revokes the key it just got (no orphaned live key).
 */

/** A managed key as the AS returns it. It expires at SPT when the grant would (`expiresAt`, epoch ms). */
export type MintedKey = { apiKey: string; keyId: string; scopes: readonly string[]; expiresAt: number };

/** The authorization server's side of the contract (docs/HOSTED-MCP.md §4.2). */
export interface KeyMinter {
  /** Exchanges the caller's access token for a managed key with exactly its scopes. */
  exchange(accessToken: string): Promise<MintedKey>;
  /** Revokes a managed key (RFC 7009). Idempotent. */
  revoke(apiKey: string): Promise<void>;
}

/** Envelope encryption for a stored key, bound to its (sub, client) by the KMS encryption context. */
export interface KeySealer {
  seal(apiKey: string, id: CredentialId): Promise<Uint8Array>;
  open(ciphertext: Uint8Array, id: CredentialId): Promise<string>;
}

export class CredentialUnavailableError extends Error {}

const sameScopes = (a: readonly string[], b: ReadonlySet<string>) => a.length === b.size && a.every((s) => b.has(s));

/** How long an opened key is kept in this instance's memory, to spare a KMS call per request. */
const OPEN_CACHE_MS = 5 * 60 * 1000;
const OPEN_CACHE_MAX = 1000;

export class UpstreamCredentials {
  private readonly opened = new Map<string, { version: number; keyId: string; apiKey: string; at: number }>();

  constructor(
    private readonly store: HostedStore,
    private readonly minter: KeyMinter,
    private readonly sealer: KeySealer,
    private readonly log: (entry: Record<string, unknown>) => void,
    private readonly clock: () => number = Date.now,
  ) {}

  /** The managed key for this caller, minting or re-minting it when the grant's scopes have changed. */
  async resolve(caller: Caller, accessToken: string): Promise<{ apiKey: string; keyId: string }> {
    const id = { issuer: caller.issuer, sub: caller.sub, clientId: caller.clientId };
    const record = await this.store.getCredential(id);
    if (record && sameScopes(record.scopes, caller.scopes)) return { apiKey: await this.openRecord(record), keyId: record.keyId };

    const minted = await this.minter.exchange(accessToken);
    if (!(minted.expiresAt > this.clock())) {
      await this.revokeQuietly(minted.apiKey, 'minted-already-expired');
      throw new CredentialUnavailableError('the authorization server minted a key that has already expired');
    }
    // A key is never broader than the live grant. Refuse one that is, and revoke it.
    if (minted.scopes.some((s) => !caller.scopes.has(s))) {
      await this.revokeQuietly(minted.apiKey, 'minted-broader-than-grant');
      throw new CredentialUnavailableError('the authorization server minted a key broader than the grant');
    }
    const next: CredentialRecord = {
      ...id,
      keyId: minted.keyId,
      ciphertext: await this.sealer.seal(minted.apiKey, id),
      scopes: [...minted.scopes].sort(),
      version: (record?.version ?? 0) + 1,
      updatedAt: this.clock(),
      expiresAt: minted.expiresAt,
    };
    const won = await this.store.putCredential(next, record?.version ?? null);
    if (!won) {
      // Another request swapped a key in first. Ours is surplus: revoke it, and use theirs if it fits this grant.
      await this.revokeQuietly(minted.apiKey, 'lost-mint-race');
      const winner = await this.store.getCredential(id);
      if (winner && sameScopes(winner.scopes, caller.scopes)) return { apiKey: await this.openRecord(winner), keyId: winner.keyId };
      throw new CredentialUnavailableError('the managed key changed during this request; retry');
    }
    this.remember(next, minted.apiKey);
    if (record) {
      // The old key is retired only after the new one is in place; a failure here leaves it to the AS's revocation.
      try {
        await this.revokeQuietly(await this.openRecord(record), 'replaced');
      } catch (error) {
        this.log({ event: 'hosted-mcp-key-revoke-failed', reason: 'replaced', keyId: record.keyId, error: (error as Error).message });
      }
    }
    this.log({ event: 'hosted-mcp-key-minted', keyId: minted.keyId, replaced: record?.keyId ?? null, scopes: next.scopes });
    return { apiKey: minted.apiKey, keyId: minted.keyId };
  }

  /** The DWLF API refused this key (revoked or expired at the source): drop the record so the next call re-mints. */
  async forget(caller: Caller, keyId: string): Promise<void> {
    const id = { issuer: caller.issuer, sub: caller.sub, clientId: caller.clientId };
    this.opened.delete(credentialKey(id));
    await this.store.deleteCredential(id, keyId);
    this.log({ event: 'hosted-mcp-key-forgotten', keyId });
  }

  private async openRecord(record: CredentialRecord): Promise<string> {
    const cacheKey = credentialKey(record);
    const hit = this.opened.get(cacheKey);
    if (hit && hit.version === record.version && hit.keyId === record.keyId && this.clock() - hit.at < OPEN_CACHE_MS) return hit.apiKey;
    const apiKey = await this.sealer.open(record.ciphertext, record);
    this.remember(record, apiKey);
    return apiKey;
  }

  private remember(record: CredentialRecord, apiKey: string) {
    if (this.opened.size >= OPEN_CACHE_MAX) this.opened.delete(this.opened.keys().next().value as string);
    this.opened.set(credentialKey(record), { version: record.version, keyId: record.keyId, apiKey, at: this.clock() });
  }

  private async revokeQuietly(apiKey: string, reason: string) {
    try {
      await this.minter.revoke(apiKey);
    } catch (error) {
      this.log({ event: 'hosted-mcp-key-revoke-failed', reason, error: (error as Error).message });
    }
  }
}
