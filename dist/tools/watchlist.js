import { z } from 'zod';
import { normalizeSymbol } from '../client.js';
export function registerWatchlistTools(server, client) {
    // 1. Get watchlist
    server.tool('dwlf_get_watchlist', "Get the user's watchlist — symbols they're actively monitoring.", {}, async () => {
        try {
            const data = await client.get('/watchlist');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching watchlist: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 2. Add symbol to watchlist
    server.tool('dwlf_add_to_watchlist', "Add a trading symbol to the user's watchlist for monitoring.", {
        symbol: z
            .string()
            .describe('Trading symbol to add — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
    }, async ({ symbol }) => {
        try {
            const sym = normalizeSymbol(symbol);
            const data = await client.post('/watchlist', { symbol: sym });
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error adding ${symbol} to watchlist: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 3. Get briefing list
    server.tool('dwlf_get_briefing_list', "Get the user's BRIEFING LIST — symbols they want in the daily briefing but are NOT " +
        'actively watching (Mag7, macro/dollar like UUP, sector bellwethers). Distinct from the ' +
        'watchlist: the daily briefing (dwlf_get_daily_briefing) covers watchlist UNION briefing ' +
        'list, while the watchlist alone drives the active/Today views. An empty briefing list ' +
        'means the briefing is just the watchlist. The whole-universe layer is the cycle screener ' +
        '(dwlf_get_cycle_setups); the briefing list is the curated middle tier.', {}, async () => {
        try {
            const data = await client.get('/briefing-list');
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error fetching briefing list: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
    // 4. Add symbol to briefing list
    server.tool('dwlf_add_to_briefing_list', 'Add a symbol to the BRIEFING LIST — briefed daily but not actively watched. Use for ' +
        "wider-universe context the user wants the structural read on without cluttering their " +
        'watchlist (e.g. UUP for the dollar, AAPL/AVGO/NVDA for Mag7).', {
        symbol: z
            .string()
            .describe('Trading symbol to add — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
    }, async ({ symbol }) => {
        try {
            const sym = normalizeSymbol(symbol);
            const data = await client.post('/briefing-list', { symbol: sym });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error adding ${symbol} to briefing list: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
    // 5. Remove symbol from briefing list
    server.tool('dwlf_remove_from_briefing_list', "Remove a symbol from the user's briefing list.", {
        symbol: z
            .string()
            .describe('Trading symbol to remove — accepts BTC/USD, BTC-USD, or stock tickers'),
    }, async ({ symbol }) => {
        try {
            const sym = normalizeSymbol(symbol);
            // Pass via ?symbol= (the backend supports the query fallback) so pair
            // symbols containing "/" don't break the path route.
            const data = await client.delete('/briefing-list', { symbol: sym });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error removing ${symbol} from briefing list: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=watchlist.js.map