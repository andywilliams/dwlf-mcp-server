import axios from 'axios';
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
export function normalizeSymbol(input) {
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
    http;
    constructor() {
        const baseURL = process.env.DWLF_API_URL || 'https://api.dwlf.co.uk';
        const apiKey = process.env.DWLF_API_KEY;
        if (!apiKey) {
            console.error('Warning: DWLF_API_KEY not set. Authenticated endpoints will fail.\n' +
                'For AI agents: Use the same API key from /v2/agent/register in your MCP config.\n' +
                'See docs/AGENT-ONBOARDING.md for setup instructions.');
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
    async get(path, params) {
        // Filter out undefined params
        const cleanParams = {};
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    cleanParams[key] = value;
                }
            }
        }
        const config = {
            params: Object.keys(cleanParams).length > 0 ? cleanParams : undefined,
        };
        const response = await this.http.get(path, config);
        return response.data;
    }
    async post(path, data) {
        const response = await this.http.post(path, data);
        return response.data;
    }
    async put(path, data) {
        const response = await this.http.put(path, data);
        return response.data;
    }
    async delete(path) {
        const response = await this.http.delete(path);
        return response.data;
    }
}
//# sourceMappingURL=client.js.map