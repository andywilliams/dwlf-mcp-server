import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerTradeTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. List trades
  server.tool(
    'dwlf_list_trades',
    'List trades from the trade journal. Filter by status (open/closed) or symbol.',
    {
      status: z.enum(['open', 'closed']).optional().describe('Filter by trade status'),
      symbol: z.string().optional().describe('Filter by symbol (e.g. BTC, TSLA)'),
    },
    async ({ status, symbol }) => {
      try {
        const params: Record<string, unknown> = {};
        if (status) params.status = status;
        if (symbol) params.symbol = normalizeSymbol(symbol);

        const data = await client.get('/trades', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 2. Get trade details
  server.tool(
    'dwlf_get_trade',
    'Get full details for a specific trade including notes, executions, and events.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.get(`/trades/${tradeId}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 3. Create trade
  server.tool(
    'dwlf_create_trade',
    'Log a new trade in the journal. Specify symbol, direction, entry price, and optional stop loss / take profit.',
    {
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
    },
    async ({ symbol, direction, entryPrice, positionSize, initialStop, initialTakeProfit, timeframe, reasonText, isPaperTrade, assetType }) => {
      try {
        const body: Record<string, unknown> = {
          assetSymbol: normalizeSymbol(symbol),
          direction,
          entryPrice,
          entryAt: new Date().toISOString(),
        };
        if (positionSize !== undefined) body.positionSize = positionSize;
        if (initialStop !== undefined) body.initialStop = initialStop;
        if (initialTakeProfit !== undefined) body.initialTakeProfit = initialTakeProfit;
        if (timeframe) body.timeframe = timeframe;
        if (reasonText) body.reasonText = reasonText;
        if (isPaperTrade !== undefined) body.isPaperTrade = isPaperTrade;
        if (assetType) body.assetType = assetType;

        const data = await client.post('/trades', body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 4. Close trade
  server.tool(
    'dwlf_close_trade',
    'Close an open trade by specifying the exit price.',
    {
      tradeId: z.string().describe('Trade ID to close'),
      exitPrice: z.number().describe('Exit price'),
      exitAt: z.string().optional().describe('Exit timestamp (ISO 8601, defaults to now)'),
    },
    async ({ tradeId, exitPrice, exitAt }) => {
      try {
        const body: Record<string, unknown> = { exitPrice };
        if (exitAt) body.exitAt = exitAt;

        const data = await client.post(`/trades/${tradeId}/close`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 5. Add trade note
  server.tool(
    'dwlf_add_trade_note',
    'Add a note to an existing trade — observations, adjustments, lessons learned.',
    {
      tradeId: z.string().describe('Trade ID'),
      content: z.string().describe('Note content'),
    },
    async ({ tradeId, content }) => {
      try {
        const data = await client.post(`/trades/${tradeId}/notes`, { content });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 6. Get trade notes
  server.tool(
    'dwlf_get_trade_notes',
    'Get all notes for a trade — observations, updates, and lessons recorded during the trade.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.get(`/trades/${tradeId}/notes`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 7. List trade plans
  server.tool(
    'dwlf_list_trade_plans',
    'List trade plan templates — reusable frameworks for entering trades.',
    {},
    async () => {
      try {
        const data = await client.get('/trade-plans');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 7. Update trade
  server.tool(
    'dwlf_update_trade',
    'Update an existing trade by ID. All fields except tradeId are optional (partial update).',
    {
      tradeId: z.string().describe('Trade ID'),
      symbol: z.string().optional().describe('Trading symbol'),
      direction: z.enum(['long', 'short']).optional().describe('Trade direction'),
      entryPrice: z.number().optional().describe('Entry price'),
      stopLoss: z.number().optional().describe('Stop loss price'),
      takeProfit: z.number().optional().describe('Take profit price'),
      quantity: z.number().optional().describe('Position size'),
      notes: z.string().optional().describe('Trade notes'),
      tags: z.array(z.string()).optional().describe('Tags for the trade'),
      isPaperTrade: z.boolean().optional().describe('Whether this is a paper trade'),
    },
    async ({ tradeId, symbol, direction, entryPrice, stopLoss, takeProfit, quantity, notes, tags, isPaperTrade }) => {
      try {
        const body: Record<string, unknown> = {};
        if (symbol) body.symbol = normalizeSymbol(symbol);
        if (direction) body.direction = direction;
        if (entryPrice !== undefined) body.entryPrice = entryPrice;
        if (stopLoss !== undefined) body.stopLoss = stopLoss;
        if (takeProfit !== undefined) body.takeProfit = takeProfit;
        if (quantity !== undefined) body.quantity = quantity;
        if (notes) body.notes = notes;
        if (tags) body.tags = tags;
        if (isPaperTrade !== undefined) body.isPaperTrade = isPaperTrade;

        const data = await client.put(`/trades/${tradeId}`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 8. Delete trade
  server.tool(
    'dwlf_delete_trade',
    'Delete a trade by ID.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.delete(`/trades/${tradeId}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 9. Position size calculator
  server.tool(
    'dwlf_position_size',
    'Calculate recommended position size based on account size, risk percentage, entry price, and stop loss.',
    {
      accountSize: z.number().describe('Total account size in currency'),
      riskPercent: z.number().describe('Risk percentage (e.g. 1 for 1%)'),
      entryPrice: z.number().describe('Planned entry price'),
      stopLoss: z.number().describe('Stop loss price'),
      symbol: z.string().optional().describe('Trading symbol for context'),
    },
    async ({ accountSize, riskPercent, entryPrice, stopLoss, symbol }) => {
      try {
        const body: Record<string, unknown> = {
          accountSize,
          riskPercent,
          entryPrice,
          stopLoss,
        };
        if (symbol) body.symbol = normalizeSymbol(symbol);

        const data = await client.post('/tools/position-size', body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 10. Get trade state
  server.tool(
    'dwlf_get_trade_state',
    'Get the current state of a trade — including execution history and adjustments.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.get(`/trades/${tradeId}/state`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
