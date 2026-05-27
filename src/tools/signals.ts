import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';

export function registerSignalTools(server: McpServer, client: DWLFClient) {
  // 1. Get active trade signals
  server.tool(
    'dwlf_get_active_signals',
    'Get currently active trade signals. These are open positions or pending entries that DWLF is tracking.',
    {},
    async () => {
      try {
        const data = await client.get('/user/trade-signals/active');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
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
    }
  );

  // 2. Get recent trade signals
  //
  // Previously this tool only exposed `limit` and hit /user/trade-signals/recent
  // which has a hard-coded 5-day cutoff. Anything older than 5 days was invisible
  // through MCP — bit me on 2026-05-27 when verifying historical CYC fires that
  // landed on 2026-05-21 (just outside the window) appeared to be "missing" until
  // I queried via curl with explicit date filters. Now switches to the general
  // /user/trade-signals endpoint when any filter is supplied (or always, since
  // the general endpoint is a strict superset with the same default ordering).
  server.tool(
    'dwlf_get_recent_signals',
    'Get user trade signals — strategy fires recorded by the daily evaluator. Shows signal history ' +
      'with entry/exit prices, R-multiple targets, contextHash, current P&L if filled. ' +
      'Filters compose: `symbol` (single), `strategy` (full strategy field, e.g. `visual_strategy_X`), ' +
      'and `fromDate`/`toDate` (ISO YYYY-MM-DD) OR `days` (last N). Without any filter the default ' +
      'cutoff is the most-recent N signals up to `limit`. Use this rather than the older `/recent` ' +
      'endpoint variant — that one has a hard-coded 5-day window that silently hides older fires.',
    {
      symbol: z
        .string()
        .optional()
        .describe('Filter to a single trading symbol (e.g. BTC-USD, IREN). Slashes and hyphens both accepted.'),
      strategy: z
        .string()
        .optional()
        .describe('Filter to a single strategy. Pass the full strategy field as stored — usually `visual_strategy_<id>` (note the visual_ prefix that the cron writes).'),
      fromDate: z
        .string()
        .optional()
        .describe('Inclusive lower bound on signal date, ISO YYYY-MM-DD. Pair with toDate for a precise window.'),
      toDate: z
        .string()
        .optional()
        .describe('Inclusive upper bound on signal date, ISO YYYY-MM-DD.'),
      days: z
        .number()
        .optional()
        .describe('Convenience: signals from the last N days. Combine with `symbol`/`strategy` to scope tightly.'),
      limit: z
        .number()
        .optional()
        .describe('Max signals to return (default: 50, max ~500). Returned newest-first.'),
      sortOrder: z
        .enum(['asc', 'desc'])
        .optional()
        .describe('Date sort order (default: desc → newest first).'),
    },
    async ({ symbol, strategy, fromDate, toDate, days, limit, sortOrder }) => {
      try {
        // If `days` is supplied without explicit dates, expand it server-side via
        // fromDate so the backend handler (which accepts fromDate/toDate but not
        // a freeform `days`) does the right thing. Keep it client-side simple.
        let effectiveFromDate = fromDate;
        let effectiveToDate = toDate;
        if (days !== undefined && !fromDate && !toDate) {
          const today = new Date();
          const from = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
          effectiveToDate = today.toISOString().slice(0, 10);
          effectiveFromDate = from.toISOString().slice(0, 10);
        }
        const data = await client.get('/user/trade-signals', {
          symbol,
          strategy,
          fromDate: effectiveFromDate,
          toDate: effectiveToDate,
          limit,
          sortOrder,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
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
    }
  );

  // 3. Get signal performance stats
  server.tool(
    'dwlf_get_signal_stats',
    'Get signal performance statistics — win rate, average P&L, total signals, and performance breakdown.',
    {},
    async () => {
      try {
        const data = await client.get('/user/trade-signals/stats');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
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
    }
  );
}
