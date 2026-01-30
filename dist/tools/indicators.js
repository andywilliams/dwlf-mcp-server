import { z } from 'zod';
import { normalizeSymbol } from '../client.js';
export function registerIndicatorTools(server, client) {
    // 1. Get computed chart indicators
    server.tool('dwlf_get_indicators', 'Get computed technical indicators for a symbol (RSI, MACD, moving averages, Bollinger Bands, etc.). Returns current indicator values and states.', {
        symbol: z
            .string()
            .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
        interval: z
            .enum(['1d', '4h', '1h'])
            .optional()
            .describe('Chart interval (default: 1d)'),
    }, async ({ symbol, interval }) => {
        try {
            const sym = normalizeSymbol(symbol);
            const data = await client.get(`/chart-indicators/${sym}`, {
                interval,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching indicators for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 2. Get detected trendlines
    server.tool('dwlf_get_trendlines', 'Get automatically detected trendlines for a symbol. Returns trend direction, slope, and key touch points.', {
        symbol: z
            .string()
            .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
    }, async ({ symbol }) => {
        try {
            const sym = normalizeSymbol(symbol);
            const data = await client.get(`/trendlines/${sym}`);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching trendlines for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=indicators.js.map