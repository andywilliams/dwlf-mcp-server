import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerBacktestTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. Run a backtest
  server.tool(
    'dwlf_run_backtest',
    'Trigger a backtest for a strategy. Backtests are async — this returns a requestId. Use dwlf_get_backtest_results to poll for results.',
    {
      strategyId: z.string().describe('Strategy ID to backtest'),
      symbol: z.string().optional().describe('Symbol to backtest against (e.g. BTC, TSLA)'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
    },
    async ({ strategyId, symbol, startDate, endDate }) => {
      try {
        const body: Record<string, unknown> = { strategyId };
        if (symbol) body.symbol = normalizeSymbol(symbol);
        if (startDate) body.startDate = startDate;
        if (endDate) body.endDate = endDate;

        const data = await client.post('/backtests', body);
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

  // 2. Get backtest results
  server.tool(
    'dwlf_get_backtest_results',
    'Get results for a backtest by requestId. If status is not "complete", poll again shortly.',
    {
      requestId: z.string().describe('Backtest request ID'),
    },
    async ({ requestId }) => {
      try {
        const data = await client.get(`/backtests/${requestId}/results`);
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

  // 3. List backtests
  server.tool(
    'dwlf_list_backtests',
    'List all backtests with their status and summary.',
    {},
    async () => {
      try {
        const data = await client.get('/backtests');
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

  // 4. Get backtest summary
  server.tool(
    'dwlf_get_backtest_summary',
    'Get a summary of all backtests — aggregated performance stats.',
    {},
    async () => {
      try {
        const data = await client.get('/backtests/summary');
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
