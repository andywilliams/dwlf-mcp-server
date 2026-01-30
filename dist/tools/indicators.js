import { z } from 'zod';
export function registerIndicatorTools(server, client) {
    // 1. Get computed chart indicators
    server.tool('dwlf_get_indicators', 'Get computed technical indicators for a symbol (RSI, MACD, moving averages, Bollinger Bands, etc.). Returns current indicator values and states.', {
        symbol: z
            .string()
            .describe('Trading symbol (e.g., BTC, AAPL, GOLD)'),
        interval: z
            .enum(['1d', '4h', '1h'])
            .optional()
            .describe('Chart interval (default: 1d)'),
    }, async ({ symbol, interval }) => {
        try {
            const data = await client.get(`/chart-indicators/${symbol}`, {
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
            .describe('Trading symbol (e.g., BTC, AAPL, GOLD)'),
    }, async ({ symbol }) => {
        try {
            const data = await client.get(`/trendlines/${symbol}`);
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