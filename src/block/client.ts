import { createHash } from 'node:crypto';
import axios, { type AxiosInstance } from 'axios';

/**
 * The Block API client (DWLF-876, docs/design/block-repoint.md D3), for `--profile block` on the `block-api` backend.
 * Charter invariant 3 (scoped 19-Nov): the second and last authenticated client, the sole `Authorization` assignment
 * for its one host. With no key it reads the public routes (`/public/v1/*`, the Free view); with a key (a personal
 * `dwlfk_` key once keys ship) it reads `/v1/*` with `Bearer`. One client per caller: `options` overrides the
 * environment, so a hosted host can build one per request (D7). The key is never logged.
 *
 * `recorder` (hosted-auth H11): a per-request observer told of each refusal or failure, so a hosted entry can turn a
 * revoked key into an HTTP 401 after the tool has answered. The stdio server passes none, so its output is unchanged.
 * This file is the only code that parses the Block API's error format: the refusal is classified here, and the fields
 * H4 needs later (the permission named, whether the plan allows it) are added here, additively, in hosted-auth step 7.
 * It reports each upstream refusal, not what the tool made of it: H11's rule reads the status alone (a Block 401 means
 * the credential no longer works, whichever read hit it, even one a tool absorbs, like dwlf_explain_event's occurrences).
 */
export interface UpstreamRefusal {
  /** The HTTP status, or null when the Block API was unreachable. */
  status: number | null;
  /** Block's own error code (`error` in its body), when the body is Block's; null otherwise. */
  code: string | null;
  /** True when the body is Block's own `{ error, message }`; false for anything else (an edge's or a proxy's answer). */
  blockBody: boolean;
}
export type UpstreamRecorder = (refusal: UpstreamRefusal) => void;

export class BlockApiError extends Error {
  constructor(readonly status: number | null, readonly body: unknown, message: string) {
    super(message);
    this.name = 'BlockApiError';
  }
}

/** The Block API base this process reads: `baseURL`, else `BLOCK_API_URL`, else production; no trailing slash. */
export const blockApiBase = (baseURL?: string): string =>
  (baseURL || process.env.BLOCK_API_URL || 'https://api.block.dwlf.co.uk').replace(/\/+$/, '');

export class BlockApiClient {
  private http: AxiosInstance;
  private recorder?: UpstreamRecorder;
  readonly signedIn: boolean;
  /** Names this client's view for a cache: the credential's SHA-256 (hex), or `public` without one. Never the credential. */
  readonly viewKey: string;

  constructor(options: { apiKey?: string; baseURL?: string; timeoutMs?: number; recorder?: UpstreamRecorder } = {}) {
    this.recorder = options.recorder;
    const base = blockApiBase(options.baseURL);
    const raw = 'apiKey' in options ? options.apiKey : process.env.DWLF_BLOCK_KEY;
    const apiKey = raw?.trim() ? raw.trim() : undefined;
    this.signedIn = Boolean(apiKey);
    this.viewKey = apiKey ? createHash('sha256').update(apiKey).digest('hex') : 'public';
    this.http = axios.create({
      baseURL: `${base}${apiKey ? '/v1' : '/public/v1'}`,
      headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      timeout: options.timeoutMs ?? 30000,
    });
  }

  /** GET a route below the view's prefix (`/conditions`, `/events`, …). Undefined params are dropped. */
  async get<T = unknown>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const query = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
    try {
      return (await this.http.get<T>(path, { params: query })).data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const body: unknown = error.response.data;
        const fields = body !== null && typeof body === 'object' ? body as { error?: unknown; message?: unknown } : {};
        const blockBody = typeof fields.error === 'string' && typeof fields.message === 'string';
        this.record({ status: error.response.status, code: blockBody ? fields.error as string : null, blockBody });
        // The Block API's own error body is the agent's answer (its code, message, requiredPlan, pricingUrl): kept whole.
        throw new BlockApiError(error.response.status, body, `Block API ${error.response.status}: ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body)}`);
      }
      this.record({ status: null, code: null, blockBody: false });
      throw new BlockApiError(null, null, `Block API unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Tells the recorder, if any. A recorder that throws never changes the tool's answer. */
  private record(refusal: UpstreamRefusal): void {
    try { this.recorder?.(refusal); } catch { /* the observer's failure is not the call's */ }
  }
}
