import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';

export function registerEvaluationTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. Trigger evaluation for a custom event (the missing step in the
  // create → compile → activate → evaluate → results workflow). Without
  // this, custom events only evaluate on the daily cron schedule.
  server.tool(
    'dwlf_evaluate_custom_event',
    '⚠️ Trigger an on-demand evaluation run for a specific custom event. This is the workflow step BETWEEN activating symbols and querying fires — without it, the custom event only evaluates on the daily cron and historical data is not backfilled until then. Returns { requestId, status: "pending" } — poll dwlf_get_evaluation_status(requestId) until status is "completed", then query fires via dwlf_get_events(type: "custom_event"). Consumes one EVALUATION quota. IMPORTANT: by default only the most recent ~400 candles (~14 months of daily data) are backfilled; older history produces NO fires and any backtest spanning it silently sees zero entries before that window. To backfill the full history a backtest needs, pass lookbackDays covering the whole backtest range (e.g. 2200 for a ~5-6yr window).',
    {
      eventId: z.string().describe('Custom event ID to evaluate'),
      lookbackDays: z.number().int().positive().optional().describe('How many days of history to (re)evaluate, overriding the default ~400-candle (~14-month) backfill window. Set this to at least the span of any backtest that gates on this event (e.g. 2200 ≈ 6 years) or its early period will have zero fires. Larger-than-history values are safe — evaluation just starts from the earliest available candle.'),
      idempotencyKey: z.string().optional().describe('Optional client-supplied idempotency key — if a request with this key already exists for this account, the existing requestId is returned instead of creating a new one'),
    },
    async ({ eventId, lookbackDays, idempotencyKey }) => {
      try {
        const body: Record<string, unknown> = {
          type: 'events',
          mode: 'selected',
          selectedItems: [{ type: 'event', id: eventId }],
        };
        if (lookbackDays !== undefined) body.lookbackDays = lookbackDays;
        if (idempotencyKey) body.idempotencyKey = idempotencyKey;
        const data = await client.post('/evaluations', body);
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

  // 2. Trigger evaluation for a strategy — parallel to the event one
  // above, in case the agent wants to backtest a visual strategy by
  // running its evaluation pipeline rather than dwlf_run_backtest. Same
  // shape, different `type` field.
  server.tool(
    'dwlf_evaluate_strategy',
    'Trigger an on-demand evaluation run for a specific visual strategy. Parallels dwlf_evaluate_custom_event but for strategies. Returns { requestId, status: "pending" } — poll dwlf_get_evaluation_status until completed. Consumes one EVALUATION quota. Same backfill caveat as dwlf_evaluate_custom_event: defaults to ~400 candles (~14 months); pass lookbackDays to cover a longer history.',
    {
      strategyId: z.string().describe('Visual strategy ID to evaluate'),
      lookbackDays: z.number().int().positive().optional().describe('How many days of history to (re)evaluate, overriding the default ~400-candle (~14-month) window. Set to at least the span of any dependent backtest. Larger-than-history values are safe.'),
      idempotencyKey: z.string().optional().describe('Optional client-supplied idempotency key'),
    },
    async ({ strategyId, lookbackDays, idempotencyKey }) => {
      try {
        const body: Record<string, unknown> = {
          type: 'strategies',
          mode: 'selected',
          selectedItems: [{ type: 'strategy', id: strategyId }],
        };
        if (lookbackDays !== undefined) body.lookbackDays = lookbackDays;
        if (idempotencyKey) body.idempotencyKey = idempotencyKey;
        const data = await client.post('/evaluations', body);
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

  // 3. Get a single evaluation's status — the polling primitive that
  // completes the workflow. Status values: "pending", "running",
  // "completed", "failed".
  server.tool(
    'dwlf_get_evaluation_status',
    'Get the status and result summary of a specific evaluation by requestId. Poll this after calling dwlf_evaluate_custom_event or dwlf_evaluate_strategy until status === "completed". Returns the request shape including processedItems counts. When status is "completed", the evaluation has finished — query the fires it produced via dwlf_get_events(type: "custom_event") or dwlf_get_recent_signals (for strategies).',
    {
      requestId: z.string().describe('Evaluation request ID returned by dwlf_evaluate_custom_event / dwlf_evaluate_strategy'),
    },
    async ({ requestId }) => {
      try {
        const data = await client.get(`/evaluations/${requestId}`);
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

  // 4. List recent evaluations — useful for finding old requestIds the
  // agent may want to inspect, or for spotting in-flight evaluations
  // before triggering a duplicate.
  server.tool(
    'dwlf_list_evaluations',
    'List recent evaluation requests for the account with their status and summary. Useful for finding the requestId of a previous evaluation, or for checking whether one is already in-flight before triggering another.',
    {
      limit: z.number().optional().describe('Maximum number of evaluations to return (server default applies if omitted)'),
      status: z.enum(['pending', 'running', 'completed', 'failed']).optional().describe('Filter by status'),
    },
    async ({ limit, status }) => {
      try {
        const data = await client.get('/evaluations', { limit, status });
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
