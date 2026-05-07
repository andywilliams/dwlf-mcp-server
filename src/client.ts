import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

/**
 * Normalize symbol input to DWLF's expected format.
 *
 * Accepts:
 *   BTC, BTC/USD, BTC-USD, btc, btc/usd, BTCUSD, PAAS, AAPL, etc.
 * Returns:
 *   BTC-USD (paired assets) or PAAS / AAPL (stocks — no suffix needed)
 *
 * Stocks/ETFs pass through unchanged. Only known paired assets (crypto and
 * commodity FX like XAU/XAG) get the "-USD" suffix appended.
 *
 * Previous implementation used a KNOWN_STOCKS allow-list, which meant any
 * unknown stock ticker got "-USD" appended and the API rejected it (PAAS, DRD,
 * HMY, NEM, SPY, etc. all failed). The KNOWN_PAIRED list is much narrower
 * and stable — far less maintenance burden than tracking every stock symbol.
 */
const KNOWN_PAIRED = new Set([
  // Crypto majors and common alts
  'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK', 'UNI', 'AAVE', 'AVAX', 'MATIC',
  'XRP', 'DOGE', 'LTC', 'BCH', 'ATOM', 'FIL', 'NEAR', 'ALGO', 'ICP', 'TRX',
  'XLM', 'XMR', 'INJ', 'OP', 'ARB', 'TIA', 'SEI', 'PEPE', 'SHIB', 'BNB',
  'TON', 'APT', 'SUI', 'STX', 'KAS', 'RNDR', 'FTM', 'HBAR', 'CRO', 'VET',
  // Commodity / FX pairs that DWLF treats with the same shape
  'XAU', 'XAG', 'XPT', 'XPD',
  'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD',
]);

export function normalizeSymbol(input: string): string {
  let s = input.trim().toUpperCase();

  // Already has separator: BTC/USD → BTC-USD, BTC-USD stays.
  if (s.includes('/')) {
    return s.replace('/', '-');
  }
  if (s.includes('-')) {
    return s;
  }

  // Detect concatenated pair: BTCUSD, ETHUSD, etc. Only treat as a pair if
  // the base is in the known-paired list, so a stock like "JPYUSD" (doesn't
  // exist) or oddly-shaped tickers don't get falsely split.
  const pairMatch = s.match(/^([A-Z]{2,5})(USD|USDT|EUR|GBP|BTC|ETH)$/);
  if (pairMatch && KNOWN_PAIRED.has(pairMatch[1])) {
    return `${pairMatch[1]}-${pairMatch[2]}`;
  }

  // Bare paired-asset symbol: BTC → BTC-USD, XAU → XAU-USD.
  if (KNOWN_PAIRED.has(s)) {
    return `${s}-USD`;
  }

  // Default: stock or ETF ticker — pass through as-is.
  return s;
}

export class DWLFClient {
  private http: AxiosInstance;

  constructor() {
    const baseURL = process.env.DWLF_API_URL || 'https://api.dwlf.co.uk';
    const apiKey = process.env.DWLF_API_KEY;

    if (!apiKey) {
      console.error(
        'Warning: DWLF_API_KEY not set. Authenticated endpoints will fail.\n' +
        'For AI agents: Use the same API key from /v2/agent/register in your MCP config.\n' +
        'See docs/AGENT-ONBOARDING.md for setup instructions.'
      );
    }

    this.http = axios.create({
      baseURL: `${baseURL}/v2`,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `ApiKey ${apiKey}` } : {}),
      },
      timeout: 30000,
    });
  }

  /**
   * Build an Axios request config that strips `undefined` values from query
   * params. Returns `{}` when there are no params so axios doesn't append
   * `?` to the URL. Shared by `get` and `delete` — keep them consistent.
   */
  private buildParamsConfig(params?: Record<string, unknown>): AxiosRequestConfig {
    if (!params) return {};
    const cleanParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        cleanParams[key] = value;
      }
    }
    return Object.keys(cleanParams).length > 0 ? { params: cleanParams } : {};
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.http.get<T>(path, this.buildParamsConfig(params));
    return response.data;
  }

  async post<T = unknown>(
    path: string,
    data?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.http.post<T>(path, data);
    return response.data;
  }

  async put<T = unknown>(
    path: string,
    data?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.http.put<T>(path, data);
    return response.data;
  }

  async delete<T = unknown>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.http.delete<T>(path, this.buildParamsConfig(params));
    return response.data;
  }
}
