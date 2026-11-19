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
      'with `types` (exact event type ids, e.g. `onchain.sth_sopr.lose`; dwlf_describe_onchain_events finds them) and `from` / `to`; with a key, ' +
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
      '`sth-realized-price` or `mvrv` (dwlf_describe_onchain_events lists every series). ' +
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

  registerCatalogueTools(server, client);
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The catalogue narrowed to `keep` (D4: the scoped selection exception). Every top-level field stays as served except
 * `items` (whole items, in upstream order) and `definitions` (the selected items' own entries, whole). Nothing is
 * rewritten; the release gate's selection check holds it to that (eval/envelope.mjs `selectionFailures`).
 */
const narrowCatalogue = (catalogue: Json, keep: (item: Json) => boolean): Json => {
  const items = (Array.isArray(catalogue.items) ? catalogue.items : []).filter((i): i is Json => isObject(i) && keep(i));
  const ids = new Set(items.map((i) => String(i.id)));
  const definitions = isObject(catalogue.definitions)
    ? Object.fromEntries(Object.entries(catalogue.definitions).filter(([k]) => ids.has(k))) : catalogue.definitions;
  return { ...catalogue, items, definitions };
};

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const CATALOGUE_TTL_MS = 15 * 60 * 1000;

function registerCatalogueTools(server: McpServer, client: BlockApiClient): void {
  // The catalogue is 355 KB and changes slowly: kept 15 minutes per client, as the SPT catalogues are. A failed read is
  // never kept, so the next call tries again.
  let cached: { at: number; body: Json } | null = null;
  const catalogueOf = async (): Promise<Json> => {
    if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) { return cached.body; }
    const body = await client.get<Json>('/catalogue');
    cached = { at: Date.now(), body };
    return body;
  };
  server.tool(
    'dwlf_describe_onchain_events',
    'What DWLF Block serves, from its catalogue: every event type (on-chain `onchain.*`, cycles, indicators, levels, ' +
      'COT) and every daily series, with its family, the plan that reads it, how often it has fired and when it last ' +
      'did (names and counts, never values). No arguments gives each family with its counts; `family`, `search` (words ' +
      'in the id, name or definition) or `eventType` (one exact id) gives those items whole, with their definitions. ' +
      'The catalogue-wide `summary` covers every item; each item\'s own `summary` describes that item. For ' +
      'one event type\'s recent occurrences use dwlf_explain_event; for a series\' values, dwlf_get_series. ' + ENVELOPE,
    {
      family: z.string().optional().describe('One family, e.g. "cost-basis", "mining", "cycles", "indicators".'),
      search: z.string().optional().describe('Words to find in an id, name or definition, e.g. "hash ribbon".'),
      eventType: z.string().optional().describe('One exact id, e.g. "onchain.sth_sopr.lose".'),
    },
    async ({ family, search, eventType }) => {
      try {
        const catalogue = await catalogueOf();
        if (!family && !search && !eventType) {
          const families: Record<string, { eventTypes: number; series: number; locked: number }> = {};
          for (const item of Array.isArray(catalogue.items) ? catalogue.items : []) {
            if (!isObject(item)) { continue; }
            const f = (families[String(item.family)] ??= { eventTypes: 0, series: 0, locked: 0 });
            if (item.kind === 'series') { f.series += 1; } else { f.eventTypes += 1; }
            if (item.locked === true) { f.locked += 1; }
          }
          return reply({ ...narrowCatalogue(catalogue, () => false), families });
        }
        // Search reads what describes the item (its id, name and own definition), never its `summary`, which on the
        // Free view is plan wording ("needs the Free plan", "locked") shared by hundreds of items.
        const wanted = search ? words(search) : [];
        const definitions = isObject(catalogue.definitions) ? catalogue.definitions : {};
        const narrowed = narrowCatalogue(catalogue, (item) => (!family || item.family === family)
          && (!eventType || item.id === eventType)
          && (!wanted.length || wanted.every((w) => words(`${item.id} ${item.name ?? ''} ${definitions[String(item.id)] ?? ''}`).includes(w))));
        if (!(narrowed.items as Json[]).length) {
          const known = [...new Set((Array.isArray(catalogue.items) ? catalogue.items : []).filter(isObject).map((i) => String(i.family)))].sort();
          return { content: [{ type: 'text' as const, text: `Nothing in the Block catalogue matches${family ? ` family "${family}"` : ''}${search ? ` "${search}"` : ''}${eventType ? ` id "${eventType}"` : ''}. Families: ${known.join(', ')}. Call with no arguments for each family's counts.` }], isError: true };
        }
        return reply(narrowed);
      } catch (error) { return failure(error); }
    },
  );

  server.tool(
    'dwlf_explain_event',
    'One event type from DWLF Block\'s catalogue, by exact id: its definition, family, the plan that reads it, how ' +
      'often it has fired and when it last did, plus `occurrences`: its events over the view (without a key, the last ' +
      '30 days; narrow with `from` / `to`; with a key, always pass `from`, since a longer history comes back in one ' +
      'answer), as the Block API gave them. If the occurrences could not be read, ' +
      '`occurrencesUnavailable` says why instead: never read that as "it has not fired". Use ' +
      'dwlf_describe_onchain_events to find an id. ' + ENVELOPE,
    {
      eventType: z.string().min(1).describe('One exact event type id, e.g. "onchain.sth_sopr.lose".'),
      from: z.string().regex(DAY).optional().describe('The first day of occurrences to include, YYYY-MM-DD.'),
      to: z.string().regex(DAY).optional().describe('The last day of occurrences to include, YYYY-MM-DD.'),
    },
    async ({ eventType, from, to }) => {
      try {
        const catalogue = await catalogueOf();
        const narrowed = narrowCatalogue(catalogue, (item) => item.id === eventType);
        const [item] = narrowed.items as Json[];
        if (!item) {
          return { content: [{ type: 'text' as const, text: `No event type "${eventType}" in the Block catalogue. Find one with dwlf_describe_onchain_events.` }], isError: true };
        }
        if (item.kind === 'series') {
          return { content: [{ type: 'text' as const, text: `"${eventType}" is a series, not an event type: read it with dwlf_get_series.` }], isError: true };
        }
        try {
          return reply({ ...narrowed, occurrences: await client.get('/events', { types: eventType, from, to }) });
        } catch (error) {
          // The definition still answers; the occurrences read failing is said, never read as "it has not fired".
          return reply({ ...narrowed, occurrencesUnavailable: error instanceof BlockApiError ? error.message : String(error) });
        }
      } catch (error) { return failure(error); }
    },
  );
}
