import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';

// Subscription CRUD — these mirror the REST endpoints at /v2/subscriptions/*.
// Previously agents had to drop to raw curl for every subscription operation
// (list / create / update / delete), which broke the "everything via MCP"
// principle. These tools close that gap.
//
// A subscription connects an event source (a custom event, a built-in indicator
// event like cycle.low.confirmed, or a strategy.entry.triggered) to one or more
// delivery channels (currently Telegram). When the source fires for a watched
// symbol the dispatcher creates a planned Trade and sends the channel message.
//
// Three subscription shapes are supported, distinguished by eventTypeId:
//   - `strategy.entry.triggered` — fires when a visual strategy's entry
//     conditions match (requires strategyId). Mode `confirm` or `auto`.
//   - `custom_event` — fires when a specific custom event fires (requires
//     customEventId). No mode (always emits).
//   - any indicator event id, e.g. `cycle.low.confirmed`, `cycle.high.window.early`,
//     `swing_low_break` — fires on the raw indicator event. No mode.
export function registerSubscriptionTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. List subscriptions
  server.tool(
    'dwlf_list_subscriptions',
    "List all subscriptions on the account, including their enabled state, event source, channels, and filters. " +
      "Use to verify what's wired up before creating duplicates, or to find a subscriptionId for update/delete.",
    {},
    async () => {
      try {
        const data = await client.get('/subscriptions');
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

  // 2. Create subscription
  server.tool(
    'dwlf_create_subscription',
    "Create a new subscription. Three shapes are supported, distinguished by `eventTypeId`:\n" +
      "  - `strategy.entry.triggered` — requires `strategyId`; pair with `mode: 'confirm'` " +
      "or `'auto'`. Confirm-mode creates a planned Trade for review; auto-mode opens it directly.\n" +
      "  - `custom_event` — requires `customEventId`. Fires when that custom event fires.\n" +
      "  - any indicator event id (e.g. `cycle.low.confirmed`, `cycle.high.window.early`, " +
      "`swing_low_break`). Fires on the raw indicator event.\n\n" +
      "`symbols` controls scope: an array of symbols, or `['*']` for a wildcard across the whole account universe. " +
      "`timeframes` accepts `['1d']`, `['1w']`, or `['*']` for any. " +
      "`channels` is an array of delivery destinations — currently `{ type: 'telegram', destination: { chatId: <id> }, enabled: true }`.",
    {
      eventTypeId: z
        .string()
        .describe("Event source: `strategy.entry.triggered`, `custom_event`, or an indicator event id like `cycle.low.confirmed`."),
      strategyId: z
        .string()
        .optional()
        .describe("Required when eventTypeId is `strategy.entry.triggered`."),
      customEventId: z
        .string()
        .optional()
        .describe("Required when eventTypeId is `custom_event`."),
      mode: z
        .enum(['confirm', 'auto'])
        .optional()
        .describe("Only meaningful for strategy.entry.triggered. `confirm` = planned Trade for review, `auto` = trade opens directly. Defaults to `confirm`."),
      symbols: z
        .array(z.string())
        .describe("Symbols to scope to. Use ['*'] for wildcard across the account universe."),
      timeframes: z
        .array(z.string())
        .optional()
        .describe("Timeframes to scope to, e.g. ['1d'], ['1w'], or ['*']. Defaults to ['*']."),
      channels: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Delivery channels, e.g. [{ type: 'telegram', destination: { chatId: <number> }, enabled: true }]."),
      enabled: z
        .boolean()
        .optional()
        .describe("Whether the subscription is active. Defaults to true."),
      riskPerTradeOverride: z.number().optional(),
      accountBalanceOverride: z.number().optional(),
      maxConcurrentTradesOverride: z.number().optional(),
      quietHours: z.record(z.string(), z.unknown()).optional(),
      dedupeWindowMinutes: z.number().optional(),
    },
    async (input) => {
      try {
        const body: Record<string, unknown> = {
          eventTypeId: input.eventTypeId,
          symbols: input.symbols,
          channels: input.channels,
          timeframes: input.timeframes ?? ['*'],
          enabled: input.enabled ?? true,
        };
        if (input.strategyId !== undefined) body.strategyId = input.strategyId;
        if (input.customEventId !== undefined) body.customEventId = input.customEventId;
        if (input.mode !== undefined) body.mode = input.mode;
        if (input.riskPerTradeOverride !== undefined) body.riskPerTradeOverride = input.riskPerTradeOverride;
        if (input.accountBalanceOverride !== undefined) body.accountBalanceOverride = input.accountBalanceOverride;
        if (input.maxConcurrentTradesOverride !== undefined) body.maxConcurrentTradesOverride = input.maxConcurrentTradesOverride;
        if (input.quietHours !== undefined) body.quietHours = input.quietHours;
        if (input.dedupeWindowMinutes !== undefined) body.dedupeWindowMinutes = input.dedupeWindowMinutes;

        const data = await client.post('/subscriptions', body);
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

  // 3. Update subscription (PATCH)
  server.tool(
    'dwlf_update_subscription',
    "Update an existing subscription (PATCH). Only the fields you supply are changed; everything else is preserved. " +
      "Most-used: toggle `enabled` to pause/resume without losing the subscription's history. " +
      "⚠️ Backend PATCH currently only accepts a subset of fields (enabled, strategyId, mode, " +
      "risk/accountBalance/maxConcurrentTrades overrides). Editing symbols/timeframes/channels still requires delete+recreate " +
      "(separate sptr PR tracks widening this allowlist). If your update silently doesn't take effect, that's why.",
    {
      subscriptionId: z.string().describe("The subscriptionId returned by create or list."),
      enabled: z.boolean().optional().describe("Toggle active/paused without deleting."),
      strategyId: z.string().optional(),
      mode: z.enum(['confirm', 'auto']).optional(),
      riskPerTradeOverride: z.number().optional(),
      accountBalanceOverride: z.number().optional(),
      maxConcurrentTradesOverride: z.number().optional(),
    },
    async ({ subscriptionId, ...patch }) => {
      try {
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) body[k] = v;
        }
        if (Object.keys(body).length === 0) {
          return {
            content: [{ type: 'text', text: 'Error: at least one updatable field is required.' }],
            isError: true,
          };
        }
        const data = await client.patch(`/subscriptions/${subscriptionId}`, body);
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

  // 4. Delete subscription
  server.tool(
    'dwlf_delete_subscription',
    "Permanently delete a subscription. Hard delete — also removes any pending dispatcher state. " +
      "If you just want to pause it, use `dwlf_update_subscription` with `enabled: false` instead so the history is preserved.",
    {
      subscriptionId: z.string().describe("The subscriptionId to delete."),
    },
    async ({ subscriptionId }) => {
      try {
        const data = await client.delete(`/subscriptions/${subscriptionId}`);
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
