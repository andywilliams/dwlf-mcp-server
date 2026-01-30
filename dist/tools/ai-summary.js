import { z } from 'zod';
import { normalizeSymbol } from '../client.js';
export function registerAISummaryTools(server, client) {
    // 1. AI Dashboard
    server.tool('dwlf_ai_dashboard', 'Get a complete account overview in a single call: watchlist with prices, active signals, open trades, portfolios, strategies, and recent events. Ideal for "what\'s going on?" queries. Requires markets:read permission; other sections degrade gracefully based on permissions.', {}, async () => {
        try {
            const data = await client.get('/ai/dashboard');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
    // 2. AI Symbol Brief
    server.tool('dwlf_ai_symbol_brief', 'Get a condensed single-symbol view: latest price with change, recent candles, key indicators, S/R levels, recent events, and active signals. Perfect for "how\'s BTC doing?" queries.', {
        symbol: z.string().describe('Symbol to get brief for (e.g. BTC, TSLA, NVDA)'),
    }, async ({ symbol }) => {
        try {
            const normalized = normalizeSymbol(symbol);
            const data = await client.get(`/ai/symbol-brief/${normalized}`);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
    // 3. AI Strategy Performance
    server.tool('dwlf_ai_strategy_performance', 'Get all strategies with signal stats and performance metrics in a single call: total signals, active signals, win rate, avg R/R, total P&L, and per-strategy breakdowns.', {}, async () => {
        try {
            const data = await client.get('/ai/strategy-performance');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=ai-summary.js.map