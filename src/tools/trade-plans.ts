import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerTradePlanTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. Get trade plan
  server.tool(
    'dwlf_get_trade_plan',
    'Get full details for a specific trade plan by ID.',
    {
      planId: z.string().describe('Trade plan ID'),
    },
    async ({ planId }) => {
      try {
        const data = await client.get(`/trade-plans/${planId}`);
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

  // 2. Create trade plan
  server.tool(
    'dwlf_create_trade_plan',
    'Create a new trade plan with entry, stop loss, and take profit levels.',
    {
      symbol: z.string().describe('Trading symbol (e.g. BTC, TSLA)'),
      direction: z.enum(['long', 'short']).describe('Trade direction'),
      entryPrice: z.number().describe('Planned entry price'),
      stopLoss: z.number().describe('Stop loss price'),
      takeProfit: z.number().describe('Take profit price'),
      strategy: z.string().optional().describe('Strategy name or description'),
      notes: z.string().optional().describe('Additional notes'),
      quantity: z.number().optional().describe('Planned position size'),
      timeframe: z.string().optional().describe('Timeframe (e.g. 1d, 4h, 1h)'),
    },
    async ({ symbol, direction, entryPrice, stopLoss, takeProfit, strategy, notes, quantity, timeframe }) => {
      try {
        const body: Record<string, unknown> = {
          symbol: normalizeSymbol(symbol),
          direction,
          entryPrice,
          stopLoss,
          takeProfit,
        };
        if (strategy) body.strategy = strategy;
        if (notes) body.notes = notes;
        if (quantity !== undefined) body.quantity = quantity;
        if (timeframe) body.timeframe = timeframe;

        const data = await client.post('/trade-plans', body);
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

  // 3. Update trade plan
  server.tool(
    'dwlf_update_trade_plan',
    'Update an existing trade plan by ID. All fields except planId are optional (partial update).',
    {
      planId: z.string().describe('Trade plan ID'),
      symbol: z.string().optional().describe('Trading symbol'),
      direction: z.enum(['long', 'short']).optional().describe('Trade direction'),
      entryPrice: z.number().optional().describe('Planned entry price'),
      stopLoss: z.number().optional().describe('Stop loss price'),
      takeProfit: z.number().optional().describe('Take profit price'),
      strategy: z.string().optional().describe('Strategy name or description'),
      notes: z.string().optional().describe('Additional notes'),
      quantity: z.number().optional().describe('Planned position size'),
      timeframe: z.string().optional().describe('Timeframe'),
      status: z.string().optional().describe('Plan status'),
    },
    async ({ planId, symbol, direction, entryPrice, stopLoss, takeProfit, strategy, notes, quantity, timeframe, status }) => {
      try {
        const body: Record<string, unknown> = {};
        if (symbol) body.symbol = normalizeSymbol(symbol);
        if (direction) body.direction = direction;
        if (entryPrice !== undefined) body.entryPrice = entryPrice;
        if (stopLoss !== undefined) body.stopLoss = stopLoss;
        if (takeProfit !== undefined) body.takeProfit = takeProfit;
        if (strategy) body.strategy = strategy;
        if (notes) body.notes = notes;
        if (quantity !== undefined) body.quantity = quantity;
        if (timeframe) body.timeframe = timeframe;
        if (status) body.status = status;

        const data = await client.put(`/trade-plans/${planId}`, body);
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

  // 4. Delete trade plan
  server.tool(
    'dwlf_delete_trade_plan',
    'Delete a trade plan by ID.',
    {
      planId: z.string().describe('Trade plan ID'),
    },
    async ({ planId }) => {
      try {
        const data = await client.delete(`/trade-plans/${planId}`);
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
