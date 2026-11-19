import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BlockApiClient, BlockApiError } from './client.js';

/**
 * The launch-set tools on the Block API (DWLF-876, docs/design/block-repoint.md D2–D4). Registered by
 * `registerBlockApiTools`, only on the `block-api` backend of `--profile block` (charter invariant 6, scoped 19-Nov),
 * under the same names as their SPT versions. Each gives the Block API's body verbatim (invariant 2: the envelope is
 * the answer, never unwrapped). Their release-gate snapshots live in eval/snapshots/ (block-eval.md §0).
 */

// How an agent reads every answer here. Worded within the shared banned-terms list (check 7).
const ENVELOPE =
  'The answer is the Block envelope: lead with its `summary`; each item has its own `summary`, `why` (the reasons, ' +
  'in plain words), `chartUrl` (the chart to show your human) and `knowableAt` (when it became known: date a fact by ' +
  'that, never by the time of your request). `definitions` explains each term used. An item with `locked: true` is ' +
  'of a family this view does not read: say what it is and when, and that `requiredPlan` reads it (`pricingUrl`); ' +
  'never guess its value. A refusal comes back as an error, `Block API <status>: <body>`, whose body says why ' +
  '(`error`, `message`, and for a plan refusal `requiredPlan` and `pricingUrl`). It describes the market or the chain as of its date. It is not a forecast and not a ' +
  'recommendation: never turn it into buy, sell or hold recommendations.';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const reply = (body: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] });
const failure = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof BlockApiError ? error.message : `Block API call failed: ${error instanceof Error ? error.message : String(error)}` }],
  isError: true,
});

export function registerBlockApiTools(server: McpServer, client: BlockApiClient): void {
  server.tool(
    'dwlf_get_conditions',
    'Where Bitcoin is now against its own history, from DWLF Block: the cost-basis ladder (realised prices: what ' +
      'holders paid), the on-chain bands, and the cycle readings, each as one item. For BITCOIN, call this first. ' +
      ENVELOPE,
    {},
    async () => {
      try { return reply(await client.get('/conditions')); } catch (error) { return failure(error); }
    },
  );

  server.tool(
    'dwlf_get_events',
    'Events on Bitcoin from DWLF Block (DWLF\'s own data, BTCOC/USD, daily): on-chain events (`onchain.*`), cycle ' +
      'pivots and indicator events, one item per event. Without a key the view covers the last 30 days. Narrow it ' +
      'with `types` (exact event type ids, e.g. `onchain.sth_sopr.lose`) and `from` / `to`; with a key, ' +
      'always pass `from`, since a longer history comes back in one answer. ' + ENVELOPE,
    {
      types: z.array(z.string()).max(20).optional()
        .describe('Only these event types: exact ids, at most 20 (e.g. ["onchain.sth_sopr.lose"]).'),
      from: z.string().regex(DAY).optional().describe('The first day to include, YYYY-MM-DD.'),
      to: z.string().regex(DAY).optional().describe('The last day to include, YYYY-MM-DD.'),
    },
    async ({ types, from, to }) => {
      try { return reply(await client.get('/events', { types: types?.length ? types.join(',') : undefined, from, to })); } catch (error) { return failure(error); }
    },
  );

  server.tool(
    'dwlf_get_series',
    'One daily Bitcoin series from DWLF Block (DWLF\'s own data), by id: for example `price-close`, `realized-price`, ' +
      '`sth-realized-price` or `mvrv`. ' +
      'Without a key the view covers the last 365 days. The item\'s `from` is its first point; `historyFrom` is set ' +
      'only when the series\' own history, not the view or your `from`, is what limits it (no earlier day exists), ' +
      'and is null otherwise. ' + ENVELOPE,
    {
      id: z.string().min(1).describe('The series id, e.g. "mvrv".'),
      from: z.string().regex(DAY).optional().describe('The first day to include, YYYY-MM-DD.'),
    },
    async ({ id, from }) => {
      try { return reply(await client.get(`/series/${encodeURIComponent(id)}`, { from })); } catch (error) { return failure(error); }
    },
  );
}
