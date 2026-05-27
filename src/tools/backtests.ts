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
    '⚠️ Run a strategy backtest (async). Returns requestId → poll with dwlf_get_backtest_results. PREREQUISITES: 1) Strategy MUST have symbols activated (dwlf_activate_strategy_symbols) or backtest returns 0 trades. 2) Requires 200+ daily candles: startDate must be 10+ months before endDate. If backtest returns 0 trades, check: a) Are symbols activated? b) Is date range long enough? c) Do event conditions actually match historical data? Optional capital/risk params (initialCapital, riskPerTrade, maxConcurrentTrades, portfolioMode, allowSymbolPyramiding) override backend defaults — set portfolioMode=true together with maxConcurrentTrades to model shared-capital concurrency across symbols; set allowSymbolPyramiding=true to permit more than one concurrent open position per symbol, and maxPositionsPerSymbol to bound that (e.g. 3) so per-symbol concentration stays capped. Set disableTakeProfit=true for exit-signal-only strategies (no tp node) so the backend does NOT force a fallback take-profit that would exit early.',
    {
      strategyId: z.string().describe('Strategy ID to backtest'),
      symbols: z.array(z.string()).optional().describe('Symbols to backtest against (e.g. ["BTC", "TSLA"]). Defaults to strategy assets.'),
      symbol: z.string().optional().describe('Single symbol shorthand (e.g. BTC, TSLA). Use "symbols" for multiple.'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
      initialCapital: z.number().positive().optional().describe('Starting account size in USD (default 10000).'),
      riskPerTrade: z.number().gt(0).lte(1).optional().describe('Risk per trade as a decimal, e.g. 0.005 = 0.5% (default 0.02).'),
      maxConcurrentTrades: z.number().int().positive().optional().describe('Concurrency cap for portfolio mode (default 3). Pair with portfolioMode=true.'),
      portfolioMode: z.boolean().optional().describe('Opt into shared-capital simulation across symbols (default false). Combine with maxConcurrentTrades to cap simultaneous open positions.'),
      allowSymbolPyramiding: z.boolean().optional().describe('Opt into >1 concurrent open position per symbol in portfolio mode (default false = one position per symbol). Note: global maxConcurrentTrades still caps total positions, but per-symbol concentration is unbounded unless maxPositionsPerSymbol is set.'),
      maxPositionsPerSymbol: z.number().int().positive().optional().describe('Bound concurrent open positions per symbol when allowSymbolPyramiding=true (e.g. 3). Default unlimited. No effect when allowSymbolPyramiding is false (cap is 1 then).'),
      disableTakeProfit: z.boolean().optional().describe('Suppress the implicit fallback take-profit (default false). When a strategy has NO take-profit node the backend otherwise force-applies a 3xATR fallback TP, which exits exit-signal-only strategies early. Set true to truly ride the exit graph (e.g. exit on cycle high / trendline break).'),
    },
    async ({ strategyId, symbols, symbol, startDate, endDate, initialCapital, riskPerTrade, maxConcurrentTrades, portfolioMode, allowSymbolPyramiding, maxPositionsPerSymbol, disableTakeProfit }) => {
      try {
        const body: Record<string, unknown> = { strategyId };
        if (symbols && symbols.length > 0) {
          body.symbols = symbols.map(normalizeSymbol);
        } else if (symbol) {
          body.symbols = [normalizeSymbol(symbol)];
        }
        if (startDate) body.startDate = startDate;
        if (endDate) body.endDate = endDate;
        if (initialCapital !== undefined) body.initialCapital = initialCapital;
        if (riskPerTrade !== undefined) body.riskPerTrade = riskPerTrade;
        if (maxConcurrentTrades !== undefined) body.maxConcurrentTrades = maxConcurrentTrades;
        if (portfolioMode !== undefined) body.portfolioMode = portfolioMode;
        if (allowSymbolPyramiding !== undefined) body.allowSymbolPyramiding = allowSymbolPyramiding;
        if (maxPositionsPerSymbol !== undefined) body.maxPositionsPerSymbol = maxPositionsPerSymbol;
        if (disableTakeProfit !== undefined) body.disableTakeProfit = disableTakeProfit;

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
  //
  // Default `summary=true` because the full payload (per-symbol equity curves,
  // per-bar trades, rejected signals) is 1-3 MB on a real multi-symbol multi-year
  // run and torches context budget when an agent only wanted "did Sharpe go up?".
  // Pass `summary: false` explicitly to pull the full S3-merged response —
  // intended for chart rendering, deep dives, or saving to disk.
  server.tool(
    'dwlf_get_backtest_results',
    'Get results for a backtest by requestId. If status is not "complete", poll again shortly. ' +
      'DEFAULTS TO SUMMARY MODE: returns DDB-level per-symbol stats (totalReturn, totalTrades, ' +
      'winningTrades, sharpe, maxDrawdown, finalEquity) and the portfolio-level aggregate metrics ' +
      'object, with all bulky fields stripped (per-symbol trades, equityCurve, signals, ' +
      'monthlyReturns; request-level portfolioEquityCurve, portfolioTrades, portfolioRejectedSignals). ' +
      'Summary is ~1-3 KB vs ~1-3 MB full — use it for headline metric checks, leaderboard-style ' +
      'comparisons, and "did it work" sanity passes. ' +
      'Pass `summary: false` to get the full payload (per-trade rows, equity curves, signals) — ' +
      'needed for plotting, per-trade analysis, or feeding into another tool. ' +
      '⚠️ When summary=false, the MCP transport will dump the response to disk and ask you to extract ' +
      'via subagent — budget for that. ' +
      '📡 For background polling without burning context window: the REST URL is ' +
      '`GET https://api.dwlf.co.uk/v2/backtests/{requestId}/results?summary=true`.',
    {
      requestId: z.string().describe('Backtest request ID'),
      summary: z
        .boolean()
        .optional()
        .describe('Default true — return the lightweight summary view. Set false to pull the full S3-merged payload (~1-3 MB).'),
    },
    async ({ requestId, summary }) => {
      try {
        // Default-on summary mode: explicit `summary: false` opts into the
        // heavy full payload. Anything else (undefined, true) goes summary.
        const wantSummary = summary !== false;
        const data = await client.get(
          `/backtests/${requestId}/results`,
          wantSummary ? { summary: 'true' } : undefined
        );
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

  // 3b. Delete a backtest
  server.tool(
    'dwlf_delete_backtest',
    'Permanently delete a backtest request and its associated result data by requestId. Use to clean up stale or invalid runs (e.g. results computed before an engine bug was fixed). Idempotent — deleting an already-deleted requestId returns success.',
    {
      requestId: z.string().describe('Backtest request ID to delete'),
    },
    async ({ requestId }) => {
      try {
        const data = await client.delete(`/backtests/${requestId}`);
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

  // 3c. Cancel a backtest — state transition, preserves the record.
  //
  // pending → clean cancel (worker checks status before running, skips).
  // running → best-effort cancel (result marked cancelled; mid-run
  //   computation isn't interrupted). Response carries bestEffort:true.
  // terminal (completed / failed / cancelled) → 409 with actual status
  //   so callers can branch without a follow-up GET.
  //
  // Use this rather than dwlf_delete_backtest when you want to halt
  // without scrubbing the audit trail.
  server.tool(
    'dwlf_cancel_backtest',
    'Cancel a queued or running backtest by requestId. Pending requests cancel cleanly (worker skips). Running requests get a best-effort cancel — result is marked cancelled but mid-run computation isn\'t interrupted; the response\'s `bestEffort: true` flag indicates this. Terminal states (completed / failed / already-cancelled) return 409 with the actual status. Use this rather than `dwlf_delete_backtest` when you want to halt without scrubbing the audit trail.',
    {
      requestId: z.string().describe('Backtest request ID to cancel'),
    },
    async ({ requestId }) => {
      try {
        const data = await client.post(`/backtests/${requestId}/cancel`, {});
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
        
        // Use `!= null` rather than a truthy check — `profitableSimsPct === 0`
        // is a meaningful (worst-case) value that should still produce the
        // "🔴 POOR robustness" interpretation, not be silently skipped.
        if (results.aggregatePerformance?.profitableSimsPct != null) {
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
