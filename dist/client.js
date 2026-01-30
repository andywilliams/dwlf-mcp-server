import axios from 'axios';
/**
 * Normalize symbol input to DWLF's expected format (e.g. BTC-USD).
 *
 * Accepts:
 *   BTC, BTC/USD, BTC-USD, btc, btc/usd, BTCUSD
 * Returns:
 *   BTC-USD (crypto) or AAPL (stocks — no suffix needed)
 *
 * Crypto assets get "-USD" appended when no quote currency is present.
 * Known stock/ETF tickers pass through unchanged.
 */
const KNOWN_STOCKS = new Set([
    'NVDA', 'TSLA', 'META', 'AAPL', 'AMZN', 'GOOG', 'GOOGL', 'MSFT',
    'SLV', 'GDXJ', 'SILJ', 'AGQ', 'GLD', 'GDX', // ETFs/metals
    'MARA', 'RIOT', 'BTBT', 'CIFR', 'IREN', 'CLSK', // crypto-adjacent stocks
]);
export function normalizeSymbol(input) {
    let s = input.trim().toUpperCase();
    // Already has separator: BTC/USD → BTC-USD, BTC-USD stays
    if (s.includes('/')) {
        return s.replace('/', '-');
    }
    if (s.includes('-')) {
        return s;
    }
    // Known stock ticker — pass through as-is
    if (KNOWN_STOCKS.has(s)) {
        return s;
    }
    // Detect concatenated pair: BTCUSD, ETHUSD, SOLUSD etc.
    const pairMatch = s.match(/^([A-Z]{2,5})(USD|USDT|EUR|GBP|BTC|ETH)$/);
    if (pairMatch) {
        return `${pairMatch[1]}-${pairMatch[2]}`;
    }
    // Bare crypto symbol: BTC → BTC-USD
    return `${s}-USD`;
}
export class DWLFClient {
    http;
    constructor() {
        const baseURL = process.env.DWLF_API_URL || 'https://api.dwlf.co.uk';
        const apiKey = process.env.DWLF_API_KEY;
        if (!apiKey) {
            console.error('Warning: DWLF_API_KEY not set. Authenticated endpoints will fail.');
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
}
//# sourceMappingURL=client.js.map