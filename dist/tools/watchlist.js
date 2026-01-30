import { z } from 'zod';
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
            .describe('Trading symbol to add (e.g., BTC, AAPL, GOLD)'),
    }, async ({ symbol }) => {
        try {
            const data = await client.post('/watchlist', { symbol });
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
}
//# sourceMappingURL=watchlist.js.map