import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { CredentialId } from './store.js';
import { GrantRefusedError, type KeyMinter, type KeySealer, type MintedKey } from './credentials.js';

/**
 * The deployed adapters behind the hosted MCP's seams (DWLF-622): KMS for the stored keys, and the authorization
 * server's token-exchange and revocation endpoints for minting them (docs/HOSTED-MCP.md §4.2).
 */

// Binds a sealed key to its (issuer, account, client): a record copied anywhere else does not open.
const context = (id: CredentialId) => ({ purpose: 'hosted-mcp-managed-key', issuer: id.issuer, sub: id.sub, clientId: id.clientId });

export class KmsSealer implements KeySealer {
  constructor(private readonly keyId: string, private readonly kms: KMSClient = new KMSClient({})) {}

  async seal(apiKey: string, id: CredentialId) {
    const { CiphertextBlob } = await this.kms.send(new EncryptCommand({
      KeyId: this.keyId, Plaintext: new TextEncoder().encode(apiKey), EncryptionContext: context(id),
    }));
    if (!CiphertextBlob) throw new Error('KMS returned no ciphertext');
    return CiphertextBlob;
  }

  async open(ciphertext: Uint8Array, id: CredentialId) {
    // The context must match the one sealed with, so a record copied to another (sub, client) does not open.
    const { Plaintext } = await this.kms.send(new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: ciphertext, EncryptionContext: context(id) }));
    if (!Plaintext) throw new Error('KMS returned no plaintext');
    return new TextDecoder().decode(Plaintext);
  }
}

export const API_KEY_TOKEN_TYPE = 'urn:dwlf:params:oauth:token-type:api-key';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';

export type ExchangeOptions = {
  tokenExchangeUrl: string;
  revocationUrl: string;
  /** The DWLF API the key is for (RFC 8693 `resource`). */
  apiResource: string;
  clientId: string;
  /** This server's client secret at the authorization server; read when first needed and kept for the process. */
  clientSecret: () => Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** A token-exchange client (RFC 8693), authenticated to the authorization server as a confidential client. */
export class ExchangeMinter implements KeyMinter {
  constructor(private readonly options: ExchangeOptions) {}

  private async post(url: string, form: Record<string, string>) {
    const secret = await this.options.clientSecret();
    const basic = Buffer.from(`${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(secret)}`).toString('base64');
    return (this.options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: `Basic ${basic}` },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
    });
  }

  async exchange(accessToken: string): Promise<MintedKey> {
    const res = await this.post(this.options.tokenExchangeUrl, {
      grant_type: EXCHANGE_GRANT,
      subject_token: accessToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: API_KEY_TOKEN_TYPE,
      resource: this.options.apiResource,
    });
    // The error body is the AS's (RFC 6749 §5.2: `error`, `error_description`); never echo the token.
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const code = typeof body?.error === 'string' ? body.error : '';
    // RFC 6749 §5.2 / RFC 8693 §2.2.2: the grant behind the token is gone. The client re-authorises; nobody is paged.
    if (res.status === 400 && (code === 'invalid_grant' || code === 'invalid_token')) throw new GrantRefusedError(code);
    if (!res.ok) throw new Error(`token exchange refused: HTTP ${res.status} ${code}`.trim());
    const { access_token: apiKey, issued_token_type: type, key_id: keyId, scope, expires_in: expiresIn } = body ?? {};
    if (type !== API_KEY_TOKEN_TYPE || typeof apiKey !== 'string' || !apiKey || typeof keyId !== 'string' || !keyId || typeof scope !== 'string'
      || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('token exchange answered without a managed key (access_token, issued_token_type, key_id, scope, expires_in)');
    }
    return { apiKey, keyId, scopes: scope.split(' ').filter(Boolean), expiresAt: Date.now() + expiresIn * 1000 };
  }

  async revoke(apiKey: string) {
    const res = await this.post(this.options.revocationUrl, { token: apiKey, token_type_hint: API_KEY_TOKEN_TYPE });
    if (!res.ok) throw new Error(`revocation refused: HTTP ${res.status}`);
  }
}

/** Reads a SecureString parameter once per process; a failed read is retried on the next call, never cached. */
export function ssmSecret(name: string, ssm: SSMClient = new SSMClient({})): () => Promise<string> {
  let value: Promise<string> | null = null;
  return () => {
    value ??= ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true })).then((r) => {
      const v = r.Parameter?.Value;
      if (!v) throw new Error(`SSM parameter ${name} is empty`);
      return v;
    });
    return value.catch((error) => {
      value = null;
      throw error;
    });
  };
}
