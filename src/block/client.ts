import axios, { type AxiosInstance } from 'axios';

/**
 * The Block API client (DWLF-876, docs/design/block-repoint.md D3), for `--profile block` on the `block-api` backend.
 * Charter invariant 3 (scoped 19-Nov): the second and last authenticated client, the sole `Authorization` assignment
 * for its one host. With no key it reads the public routes (`/public/v1/*`, the Free view); with a key (a personal
 * `dwlfk_` key once keys ship) it reads `/v1/*` with `Bearer`. One client per caller: `options` overrides the
 * environment, so a hosted host can build one per request (D7). The key is never logged.
 */
export class BlockApiError extends Error {
  constructor(readonly status: number | null, readonly body: unknown, message: string) {
    super(message);
    this.name = 'BlockApiError';
  }
}

export class BlockApiClient {
  private http: AxiosInstance;
  readonly signedIn: boolean;

  constructor(options: { apiKey?: string; baseURL?: string; timeoutMs?: number } = {}) {
    const base = (options.baseURL || process.env.BLOCK_API_URL || 'https://api.block.dwlf.co.uk').replace(/\/+$/, '');
    const raw = 'apiKey' in options ? options.apiKey : process.env.DWLF_BLOCK_KEY;
    const apiKey = raw?.trim() ? raw.trim() : undefined;
    this.signedIn = Boolean(apiKey);
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
        // The Block API's own error body is the agent's answer (its code, message, requiredPlan, pricingUrl): kept whole.
        throw new BlockApiError(error.response.status, body, `Block API ${error.response.status}: ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body)}`);
      }
      throw new BlockApiError(null, null, `Block API unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
