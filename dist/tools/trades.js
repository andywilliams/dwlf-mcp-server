import { z } from 'zod';
import { normalizeSymbol } from '../client.js';
export function registerTradeTools(server, client) {
    // 1. List trades
    server.tool('dwlf_list_trades', 'List trades from the trade journal. Filter by status (open/closed) or symbol.', {
        status: z.enum(['open', 'closed']).optional().describe('Filter by trade status'),
        symbol: z.string().optional().describe('Filter by symbol (e.g. BTC, TSLA)'),
    }, async ({ status, symbol }) => {
        try {
            const params = {};
            if (status)
                params.status = status;
            if (symbol)
                params.symbol = normalizeSymbol(symbol);
            const data = await client.get('/trades', params);
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
    // 2. Get trade details
    server.tool('dwlf_get_trade', 'Get full details for a specific trade including notes, executions, and events.', {
        tradeId: z.string().describe('Trade ID'),
    }, async ({ tradeId }) => {
        try {
            const data = await client.get(`/trades/${tradeId}`);
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
    // 3. Create trade
    server.tool('dwlf_create_trade', 'Log a new trade in the journal. Specify symbol, direction, entry price, and optional stop loss / take profit.', {
        symbol: z.string().describe('Trading symbol (e.g. BTC, TSLA, RIOT)'),
        direction: z.enum(['long', 'short']).describe('Trade direction'),
        entryPrice: z.number().describe('Entry price'),
        positionSize: z.number().optional().describe('Position size (quantity)'),
        initialStop: z.number().optional().describe('Stop loss price'),
        initialTakeProfit: z.number().optional().describe('Take profit price'),
        timeframe: z.string().optional().describe('Timeframe (e.g. 1d, 4h, 1h)'),
        reasonText: z.string().optional().describe('Trade reasoning / thesis'),
        isPaperTrade: z.boolean().optional().describe('Whether this is a paper trade (default: false)'),
        assetType: z.enum(['crypto', 'equity', 'forex']).optional().describe('Asset type'),
    }, async ({ symbol, direction, entryPrice, positionSize, initialStop, initialTakeProfit, timeframe, reasonText, isPaperTrade, assetType }) => {
        try {
            const body = {
                assetSymbol: normalizeSymbol(symbol),
                direction,
                entryPrice,
                entryAt: new Date().toISOString(),
            };
            if (positionSize !== undefined)
                body.positionSize = positionSize;
            if (initialStop !== undefined)
                body.initialStop = initialStop;
            if (initialTakeProfit !== undefined)
                body.initialTakeProfit = initialTakeProfit;
            if (timeframe)
                body.timeframe = timeframe;
            if (reasonText)
                body.reasonText = reasonText;
            if (isPaperTrade !== undefined)
                body.isPaperTrade = isPaperTrade;
            if (assetType)
                body.assetType = assetType;
            const data = await client.post('/trades', body);
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
    // 4. Close trade
    server.tool('dwlf_close_trade', 'Close an open trade by specifying the exit price.', {
        tradeId: z.string().describe('Trade ID to close'),
        exitPrice: z.number().describe('Exit price'),
        exitAt: z.string().optional().describe('Exit timestamp (ISO 8601, defaults to now)'),
    }, async ({ tradeId, exitPrice, exitAt }) => {
        try {
            const body = { exitPrice };
            if (exitAt)
                body.exitAt = exitAt;
            const data = await client.post(`/trades/${tradeId}/close`, body);
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
    // 5. Add trade note
    server.tool('dwlf_add_trade_note', 'Add a note to an existing trade — observations, adjustments, lessons learned.', {
        tradeId: z.string().describe('Trade ID'),
        content: z.string().describe('Note content'),
    }, async ({ tradeId, content }) => {
        try {
            const data = await client.post(`/trades/${tradeId}/notes`, { content });
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
    // 6. Get trade notes
    server.tool('dwlf_get_trade_notes', 'Get all notes for a trade — observations, updates, and lessons recorded during the trade.', {
        tradeId: z.string().describe('Trade ID'),
    }, async ({ tradeId }) => {
        try {
            const data = await client.get(`/trades/${tradeId}/notes`);
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
    // 7. List trade plans
    server.tool('dwlf_list_trade_plans', 'List trade plan templates — reusable frameworks for entering trades.', {}, async () => {
        try {
            const data = await client.get('/trade-plans');
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
    // 7. Get trade state
    server.tool('dwlf_get_trade_state', 'Get the current state of a trade — including execution history and adjustments.', {
        tradeId: z.string().describe('Trade ID'),
    }, async ({ tradeId }) => {
        try {
            const data = await client.get(`/trades/${tradeId}/state`);
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
//# sourceMappingURL=trades.js.map