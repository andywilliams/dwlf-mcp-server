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
      symbols: z.array(z.string()).optional().describe('Symbols to backtest against (e.g. ["BTC", "TSLA"]). Defaults to strategy assets.'),
      symbol: z.string().optional().describe('Single symbol shorthand (e.g. BTC, TSLA). Use "symbols" for multiple.'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
    },
    async ({ strategyId, symbols, symbol, startDate, endDate }) => {
      try {
        const body: Record<string, unknown> = { strategyId };
        if (symbols && symbols.length > 0) {
          body.symbols = symbols.map(normalizeSymbol);
        } else if (symbol) {
          body.symbols = [normalizeSymbol(symbol)];
        }
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

  // 5. Run synthetic backtest (Monte Carlo)
  server.tool(
    'dwlf_run_synthetic_backtest',
    'Run Monte Carlo synthetic validation for a strategy. Tests strategy against statistically realistic generated price paths to assess robustness. Returns requestId for polling.',
    {
      strategyId: z.string().describe('Strategy ID to test'),
      baseSymbol: z.string().describe('Real symbol to derive statistical properties from (e.g. "BTC-USD", "AAPL")'),
      simulations: z.number().optional().default(200).describe('Number of price paths to generate (50-1000, default 200)'),
      durationDays: z.number().optional().default(365).describe('How long each simulated path runs in days (30-1095, default 365)'),
      timeframe: z.string().optional().default('daily').describe('Candle timeframe (daily, 4h, 1h, default daily)'),
      scenarios: z.array(z.enum(['normal', 'high_volatility', 'crash', 'rally'])).optional().default(['normal']).describe('Scenario modifiers to test'),
      startingPrice: z.number().optional().describe('Starting price for paths (defaults to latest close of baseSymbol)'),
      seed: z.number().optional().describe('Random seed for reproducible results (optional)')
    },
    async ({ strategyId, baseSymbol, simulations = 200, durationDays = 365, timeframe = 'daily', scenarios = ['normal'], startingPrice, seed }) => {
      try {
        const body: Record<string, unknown> = {
          strategyId,
          baseSymbol: normalizeSymbol(baseSymbol),
          simulations: Math.max(50, Math.min(1000, simulations)),
          durationDays: Math.max(30, Math.min(1095, durationDays)),
          timeframe,
          scenarios
        };
        
        if (startingPrice !== undefined) body.startingPrice = startingPrice;
        if (seed !== undefined) body.seed = seed;

        const data = await client.post('/backtests/synthetic', body);
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

  // 6. Get synthetic backtest results
  server.tool(
    'dwlf_get_synthetic_backtest_results',
    'Get results for a synthetic backtest by requestId. Returns distribution stats, robustness metrics, and profitableSimsPct. Poll until status is "completed".',
    {
      requestId: z.string().describe('Synthetic backtest request ID (starts with "syn_")'),
    },
    async ({ requestId }) => {
      try {
        const data = await client.get(`/backtests/synthetic/${requestId}/results`);
        
        // Add interpretation context to help agents understand the results
        const results = data as any;
        let interpretation = '';
        
        if (results.aggregatePerformance?.profitableSimsPct) {
          const profitablePct = results.aggregatePerformance.profitableSimsPct * 100;
          if (profitablePct >= 80) {
            interpretation = `🟢 EXCELLENT robustness (${profitablePct.toFixed(0)}% profitable) - Strategy performs well across most market conditions.`;
          } else if (profitablePct >= 65) {
            interpretation = `🔵 GOOD robustness (${profitablePct.toFixed(0)}% profitable) - Strategy shows solid consistency.`;
          } else if (profitablePct >= 55) {
            interpretation = `🟡 MODERATE robustness (${profitablePct.toFixed(0)}% profitable) - Strategy may be sensitive to market conditions.`;
          } else {
            interpretation = `🔴 POOR robustness (${profitablePct.toFixed(0)}% profitable) - Strategy may be curve-fitted or unreliable.`;
          }
        }
        
        const responseText = interpretation 
          ? `${interpretation}\n\n${JSON.stringify(data, null, 2)}`
          : JSON.stringify(data, null, 2);
          
        return {
          content: [{ type: 'text', text: responseText }],
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
