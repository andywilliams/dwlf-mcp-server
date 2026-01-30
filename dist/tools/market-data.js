import { z } from 'zod';
import { normalizeSymbol } from '../client.js';
export function registerMarketDataTools(server, client) {
    // 1. Get OHLCV candle data
    server.tool('dwlf_get_market_data', 'Get OHLCV candle data for a trading symbol. Returns open, high, low, close, volume over time.', {
        symbol: z
            .string()
            .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
        interval: z
            .enum(['1d', '4h', '1h'])
            .optional()
            .describe('Candle interval (default: 1d)'),
        limit: z
            .number()
            .optional()
            .describe('Number of candles to return (default: 50)'),
    }, async ({ symbol, interval, limit }) => {
        try {
            const sym = normalizeSymbol(symbol);
            const data = await client.get(`/market-data/${sym}`, {
                interval,
                limit,
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
                        text: `Error fetching market data for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 2. List all symbols
    server.tool('dwlf_list_symbols', 'List all available trading symbols with metadata. Use this to discover what symbols are available on DWLF.', {}, async () => {
        try {
            const data = await client.get('/market-data/symbols');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching symbols: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 3. Get support/resistance levels
    server.tool('dwlf_get_support_resistance', 'Get support and resistance levels for a trading symbol. These are key price levels where buying/selling pressure is expected.', {
        symbol: z
            .string()
            .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
    }, async ({ symbol }) => {
        try {
            const sym = normalizeSymbol(symbol);
            const data = await client.get(`/support-resistance/${sym}`);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching support/resistance for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 4. Get indicator events
    server.tool('dwlf_get_events', 'Get indicator events (crossovers, breakouts, divergences, etc.) for a symbol. Events represent significant technical analysis occurrences.', {
        symbol: z
            .string()
            .optional()
            .describe('Filter by trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers'),
        type: z
            .string()
            .optional()
            .describe('Filter by event type (e.g., crossover, breakout, divergence)'),
        limit: z
            .number()
            .optional()
            .describe('Number of events to return (default: 20)'),
    }, async ({ symbol, type, limit }) => {
        try {
            const sym = symbol ? normalizeSymbol(symbol) : undefined;
            const data = await client.get('/events', { symbol: sym, type, limit });
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching events: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=market-data.js.map