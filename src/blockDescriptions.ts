import { z } from 'zod';

/**
 * Block-profile tool wording (DWLF-835; Andy, 12-Nov-2026 17:53). Block describes conditions, never calls, and
 * its profile has no strategies, strategy signals or backtests. A shared tool whose `full` description speaks of
 * strategy entries/exits, stop-losses, backtests or "triggers" gets its Block wording here; `profiledServer` sends it
 * in place of the shared one when the profile is `block`. The shared description, which retail still uses, is unchanged.
 * Parameters say things too, so a tool can also have its Block input schema (BLOCK_SCHEMAS: strategy-only parameters
 * removed, wording changed) and, where its OUTPUT would carry strategy nodes, a Block handler (BLOCK_HANDLERS).
 * A test reads what the built server actually lists under `--profile block` and keeps all of it free of that
 * vocabulary and of references to tools Block hides.
 */
type Shape = Record<string, z.ZodTypeAny>;
type Handler = (args: Record<string, unknown>, extra: unknown) => unknown;

/**
 * A one-phrase change to the shared description. It throws when the phrase is gone, so an edit to the shared wording
 * cannot silently drop the Block change (the profile test builds every Block description).
 */
const swap = (from: string, to: string) => (shared: string): string => {
  if (!shared.includes(from)) { throw new Error(`Block wording: the shared description no longer contains ${JSON.stringify(from)}`); }
  return shared.replace(from, to);
};
/**
 * What a Block agent must not do with a market reading (WP7, the 12-Nov input point 6). Appended to the read tools whose
 * shared description does not already say it in its own words; the profile test checks every one of them carries it.
 */
export const READING_NOTE = 'What this returns describes the market or the chain as of its date: it is not a signal, a forecast or a ' +
  'recommendation, so never present it as a reason to buy or sell.';
export const NOTED_TOOLS = Object.freeze(['dwlf_get_events', 'dwlf_get_price_picture', 'dwlf_get_indicators', 'dwlf_get_regime',
  'dwlf_get_support_resistance', 'dwlf_get_trendlines', 'dwlf_get_market_data', 'dwlf_get_quote']);
// A noted tool whose shared wording also needs a phrase changed: the phrase change, then the note.
const NOTED_PHRASES: Readonly<Record<string, (shared: string) => string>> = {
  dwlf_get_quote: swap(' Ideal for marking a trade/skip to current price or pricing an arbitrary symbol.', ' Use it to price any tracked symbol.'),
  dwlf_get_indicators: swap('For momentum, band and cross signals use', 'For momentum, band and cross events use'),
};
const noted = (name: string) => (shared: string): string => `${(NOTED_PHRASES[name] ?? String)(shared)} ${READING_NOTE}`;

/** A string replaces the shared description; a function rewrites it (for a one-phrase change). */
export const BLOCK_DESCRIPTIONS: Readonly<Record<string, string | ((shared: string) => string)>> = Object.freeze({
  dwlf_update_subscription:
    'Update an existing alert subscription (PATCH). Only the fields you supply change; everything else is kept. ' +
    'Most used: toggle `enabled` to pause/resume without losing the subscription\'s history. Editable fields: enabled, ' +
    'symbols, timeframes, channels, quietHours, dedupeWindowMinutes, and customEventId (custom_event subscriptions ' +
    'only). `eventTypeId` is NOT patchable: switching what an alert listens for means delete + recreate.',
  dwlf_get_ranges: swap(' "at the TOP of the range — think twice about entering here",', ' "at the TOP of the range",'),
  ...Object.fromEntries(NOTED_TOOLS.map((name) => [name, noted(name)])),
  dwlf_get_custom_event_notifications: (shared: string) => `${shared} A fire records that a condition the user defined held on that ` +
    'date: it is the output of their own rule, not a DWLF signal or recommendation.',
  dwlf_create_subscription:
    'Create an alert subscription: get told when an event fires. Two shapes, distinguished by `eventTypeId`:\n' +
    '  - any event id (e.g. `onchain.mvrv.cross_above_1`, `cycle.low.confirmed`, `swing_low_break`): fires when that event is recorded;\n' +
    '  - `custom_event`: requires `customEventId`; fires when that custom event fires.\n\n' +
    '`symbols` controls scope: an array of symbols, or `[\'*\']` for every symbol the account follows. `timeframes` accepts ' +
    '`[\'1d\']`, `[\'1w\']`, or `[\'*\']` for any. `channels` is an array of delivery destinations, currently ' +
    '`{ type: \'telegram\', destination: { chatId: <id> }, enabled: true }`. An alert says what happened and when; it is ' +
    'not a recommendation. A plan limits how many alerts an account may have, and which event families it may alert on.',
  dwlf_describe_strategy_nodes:
    'Describe the nodes a custom event is built from: condition nodes (what each one checks, its parameters and their ' +
    'engine defaults) and the logic gates that combine them (and/or/not/then). Optional `nodeType` filters to one node; ' +
    '`category: "condition"` or `"logic"` lists one kind in full. Indicator/event condition nodes come from the platform\'s node catalogue (GET /v2/node-types, cached up to 15 ' +
    'minutes; an unfiltered call lists them by name, ask by nodeType or category "condition" for detail), marked ' +
    '`source: "catalogue"` with `label`, `direction`, `timeframes` (the only ones the node fires on) and ' +
    '`catalogueCategory`. When `honoredByExecutor: false` on a param, the listed `default` is the only value the engine ' +
    'uses; `honoredByExecutor: null` means not verified (the parameter reaches the compiled event; its effect is not ' +
    'checked here). A node with `engineIgnored` is one the engine cannot evaluate: do not use it. `engineIgnores` is the raw rule ' +
    'list ({ id } or { prefix }, with a reason). `catalogueError` means the catalogue could not be read and only the ' +
    'static nodes are listed.',
  dwlf_create_custom_event:
    '⚠️ Create a new custom event (a condition you define, recorded each time it holds). WORKFLOW: 1) create (saving ' +
    'compiles it; a graph that will not compile is refused with 400) → 2) MUST call dwlf_activate_event_symbols (or the ' +
    'event will never fire) → 3) dwlf_evaluate_custom_event to fill its history. Until symbols are activated the event ' +
    'exists but the evaluation engine does not see it, so it records nothing. Activate symbols straight after creating it.',
  dwlf_evaluate_custom_event:
    '⚠️ Trigger an on-demand evaluation run for a custom event: the step BETWEEN activating symbols and reading its fires. ' +
    'Without it the event only evaluates on the daily run, and its history is not filled until then. Returns ' +
    '{ requestId, status: "pending" }; poll dwlf_get_evaluation_status(requestId) until status is "completed", then read ' +
    'the fires via dwlf_get_events(type: "custom_event"). Consumes one EVALUATION quota. By default only the most recent ' +
    '~400 candles (~14 months of daily data) are evaluated, so older history has NO fires: to fill a longer history pass ' +
    '`lookbackDays` covering it (e.g. 2200 for ~5-6 years).',
  dwlf_activate_event_symbols:
    '⚠️ REQUIRED STEP after creating a custom event: activate (enable) symbols for it. An event does NOT evaluate until ' +
    'symbols are activated: the daily run skips it and it records no fires. If an event shows no fires, check this step ' +
    'first (dwlf_get_event_symbols shows its `health`). Call straight after creating an event.',
  dwlf_get_evaluation_status:
    'Get the status and result summary of an evaluation by requestId. Poll this after dwlf_evaluate_custom_event until ' +
    'status === "completed". ⚠️ `summary.totalItems` / `summary.processedItems` count evaluation-JOB items (one per ' +
    'custom event), NOT the symbols inside the job: an evaluation across 37 symbols shows `totalItems: 1, ' +
    'processedItems: 1` when done. When the request named symbols this tool adds `symbolsRequested: <count>` beside the ' +
    'summary. When status is "completed", read the fires via dwlf_get_events(type: "custom_event").',
  dwlf_register_agent:
    'Programmatically register a new DWLF account: no browser or Google sign-in required. Returns an API key ' +
    'immediately. Email verification unlocks the compute features (custom event evaluations). Useful for onboarding ' +
    'flows where an agent registers itself.',
  dwlf_get_cycle_setups:
    'The cycle screener: across the symbols DWLF tracks, which have their WEEKLY cycle timing window open, and whether a ' +
    'DAILY cycle pivot has confirmed inside it, for lows and highs alike. Stages: `confirmed_setup` (weekly window open ' +
    'AND a daily pivot confirmed within 15 days), `awaiting_confirmation` (daily pivot provisional, confidence % ' +
    'included), `window_open` (window open, no daily pivot yet). Each row: weekly window position (early/mid/late + ' +
    'days since the last pivot), `weekly.timing`, the daily pivot\'s price/confidence/age, last close and % from the ' +
    'pivot. The counts per side describe how many symbols are in each state; they are a description, not a forecast. ' +
    '`weekly.timing` is the STORED weekly window, the same edges the chart draws: `earliest`, `opens`, `closes`, ' +
    '`hardMax` (dated edges), `phase` (upcoming | open | overdue | missed), `n`, `calibration`, `verification` (always ' +
    '`unverified` while the detection gate stands failed), `rulerAgreesWithState`, `generation` and `projectionHash`; ' +
    'null when no window is stored for the series. ⚠️ A symbol whose weekly window is not yet open is ABSENT from every ' +
    'list: for its window dates call `dwlf_get_cycle_windows`. DEPTH (`depth: true`): each row also carries `depth`, ' +
    'its weekly window\'s price band from past cycles\' moves (the same object `dwlf_get_cycle_windows` returns), and ' +
    '`depth.reading.position` places the last weekly close: `in-zone` (inside the p25–p75 of past moves), `shallow` / ' +
    '`deep` / `beyond`, or `not-reached`. It is context, not a target, and it does not change the stage or the order. ' +
    'A missing band says why in `depthUnavailable`. Everything here is a dated state of the cycle engine, not a call.',
});

const BLOCK_EVENT_TYPE_ID = 'What fires the alert: an event id (e.g. `onchain.mvrv.cross_above_1`, `cycle.low.confirmed`), or ' +
  '`custom_event` with `customEventId`.';
const withoutStrategyParams = (shape: Shape, eventTypeId?: z.ZodTypeAny): Shape => {
  const { strategyId: _a, mode: _b, riskPerTradeOverride: _c, accountBalanceOverride: _d, maxConcurrentTradesOverride: _e,
    ...rest } = shape;
  void _a; void _b; void _c; void _d; void _e;
  return eventTypeId && rest.eventTypeId ? { ...rest, eventTypeId } : rest;
};

/** Block input schemas: each takes the shared shape and returns Block's. */
export const BLOCK_SCHEMAS: Readonly<Record<string, (shared: Shape) => Shape>> = Object.freeze({
  dwlf_create_subscription: (shared: Shape) => withoutStrategyParams(shared, z.string().describe(BLOCK_EVENT_TYPE_ID)),
  dwlf_update_subscription: (shared: Shape) => withoutStrategyParams(shared),
  dwlf_evaluate_custom_event: (shared: Shape) => ({
    ...shared,
    lookbackDays: z.number().int().positive().optional().describe('How many days of history to (re)evaluate, overriding the ' +
      'default ~400-candle (~14-month) window. Set it to cover the whole history you want the event\'s fires for.'),
  }),
  dwlf_get_cycle_windows: (shared: Shape) => ({
    ...shared,
    side: z.enum(['low', 'high']).optional().describe('Omit for both sides. `low` = the next cycle-low window; `high` = the next cycle-high window.'),
  }),
  dwlf_get_evaluation_status: (shared: Shape) => ({
    ...shared,
    requestId: z.string().describe('Evaluation request ID returned by dwlf_evaluate_custom_event'),
  }),
  dwlf_describe_strategy_nodes: (shared: Shape) => ({
    ...shared,
    nodeType: z.string().optional().describe('Return only this one node (a condition or a logic gate, by its node type id).'),
    category: z.enum(['condition', 'logic']).optional().describe('`condition` (indicator and event conditions) or `logic` (the and/or/not/then gates that combine them).'),
  }),
});

/** Block handlers: each wraps the shared one. The node catalogue answers with condition nodes only. */
type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean };
// What a Block custom event is built from: condition nodes and the logic gates that combine them (and/or/not/then).
// Entry signals, stop-losses, take-profits, exits and cancellations are strategy nodes, which Block does not have.
const BLOCK_NODE_CATEGORIES = new Set(['condition', 'logic']);
export const BLOCK_HANDLERS: Readonly<Record<string, (shared: Handler) => Handler>> = Object.freeze({
  // The shared answer (brief by default, in full for a category or a nodeType), with strategy nodes taken out. A
  // nodeType lookup that finds only a strategy node is refused rather than described.
  dwlf_describe_strategy_nodes: (shared: Handler) => async (args, extra) => {
    const res = (await shared(args, extra)) as ToolResult;
    if (res.isError) { return res; }
    let parsed: { count?: number; nodes?: { category?: string }[] } & Record<string, unknown>;
    try { parsed = JSON.parse(res.content?.[0]?.text ?? '{}'); } catch { return res; }
    const nodes = (parsed.nodes ?? []).filter((n) => BLOCK_NODE_CATEGORIES.has(String(n.category)));
    if (args.nodeType && nodes.length === 0) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: `Not a custom-event node: ${String(args.nodeType)}`,
        hint: 'Block custom events are built from condition nodes and logic gates; call with no arguments to list them.' }, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ...parsed, count: nodes.length, nodes }, null, 2) }] };
  },
});
