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
    server.tool('dwlf_get_events', 'Get indicator events (cycle lows/highs, crossovers, breakouts, divergences, etc.). ' +
        'Filter by a single `symbol` or a `symbols` watchlist, by `type` (e.g. `cycle.low.confirmed`), ' +
        'by `timeframe` (1d / 4h / 1h — without this the response is dominated by hourly noise), ' +
        'and by time window via `days` or explicit `fromDate` / `toDate`.', {
        symbol: z
            .string()
            .optional()
            .describe('Filter by a single trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers'),
        symbols: z
            .array(z.string())
            .optional()
            .describe('Filter by multiple symbols at once. Each accepts the same shapes as `symbol`. ' +
            'Use this for watchlist queries (e.g. "what cycle lows fired across my watchlist today").'),
        type: z
            .string()
            .optional()
            .describe('Filter by event type (e.g. `cycle.low.confirmed`, `cycle.high.confirmed`, ' +
            '`bullish_reversal`, `dss_breakout`).'),
        timeframe: z
            .enum(['1w', '1d', '4h', '1h'])
            .optional()
            .describe('Filter by candle timeframe. Strongly recommended — without it the API returns ' +
            'mostly hourly events and daily-bar fires get truncated past the limit. ' +
            'Use `1w` to query weekly cycle events (e.g. for multi-timeframe DCL analysis).'),
        days: z
            .number()
            .optional()
            .describe('Restrict to events fired in the last N days (e.g. `5` for the last 5 days).'),
        fromDate: z
            .string()
            .optional()
            .describe('Inclusive lower bound on event date, ISO `YYYY-MM-DD`. Mutually useful with `toDate`.'),
        toDate: z
            .string()
            .optional()
            .describe('Inclusive upper bound on event date, ISO `YYYY-MM-DD`.'),
        uniquePerSymbol: z
            .boolean()
            .optional()
            .describe('If true, return only the most recent event per symbol (useful for "latest fire" snapshots).'),
        limit: z
            .number()
            .optional()
            .describe('Number of events to return (default: 20).'),
        customEventId: z
            .string()
            .optional()
            .describe('Filter to fires of a specific custom event by its event definition ID. ' +
            'Only honoured when `type` is `custom_event`. Combine with `symbol` / `symbols` ' +
            'to scope to a single asset, or omit to see fires across the watchlist.'),
        eventName: z
            .string()
            .optional()
            .describe('Filter custom event fires by their human-readable name (e.g. `bullish_reversal_1`). ' +
            'Only honoured when `type` is `custom_event`. Useful when you know the name but not the ID.'),
    }, async ({ symbol, symbols, type, timeframe, days, fromDate, toDate, uniquePerSymbol, limit, customEventId, eventName }) => {
        try {
            const sym = symbol ? normalizeSymbol(symbol) : undefined;
            const symsCsv = symbols && symbols.length > 0
                ? symbols.map((s) => normalizeSymbol(s)).join(',')
                : undefined;
            const data = await client.get('/events', {
                symbol: sym,
                symbols: symsCsv,
                type,
                timeframe,
                days,
                fromDate,
                toDate,
                // Backend reads `uniquePerSymbol === 'true'`, so serialise to string.
                uniquePerSymbol: uniquePerSymbol === undefined ? undefined : String(uniquePerSymbol),
                limit,
                customEventId,
                eventName,
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
                        text: `Error fetching events: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=market-data.js.map