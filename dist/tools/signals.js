import { z } from 'zod';
export function registerSignalTools(server, client) {
    // 1. Get active trade signals
    server.tool('dwlf_get_active_signals', 'Get currently active trade signals. These are open positions or pending entries that DWLF is tracking.', {}, async () => {
        try {
            const data = await client.get('/user/trade-signals/active');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching active signals: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 2. Get recent trade signals
    server.tool('dwlf_get_recent_signals', 'Get recent trade signals including completed ones. Shows signal history with entry/exit prices, P&L, and outcomes.', {
        limit: z
            .number()
            .optional()
            .describe('Number of recent signals to return (default: 20)'),
    }, async ({ limit }) => {
        try {
            const data = await client.get('/user/trade-signals/recent', { limit });
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching recent signals: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 3. Get signal performance stats
    server.tool('dwlf_get_signal_stats', 'Get signal performance statistics — win rate, average P&L, total signals, and performance breakdown.', {}, async () => {
        try {
            const data = await client.get('/user/trade-signals/stats');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching signal stats: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=signals.js.map