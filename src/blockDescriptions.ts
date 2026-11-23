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
/** Several one-phrase changes, applied in order (each throws like `swap` when its phrase is gone). */
const swaps = (...pairs: [string, string][]) => (shared: string): string => pairs.reduce((text, [from, to]) => swap(from, to)(text), shared);
/**
 * What a Block agent must not do with a market reading (WP7, the 12-Nov input point 6). Appended to the read tools whose
 * shared description does not already say it in its own words; the profile test checks every one of them carries it.
 */
// Worded in the shared list's own allowed phrases (block-site ops/wording-banned.json `allowPhrases`), so the wording
// gate (test/wording.test.mjs) passes it without an exemption.
export const READING_NOTE = 'What this tool gives describes the market or the chain as of its date. It is not a forecast and not a ' +
  'recommendation, and nothing here is scored as a predictor: never turn it into buy, sell or hold recommendations.';
export const NOTED_TOOLS = Object.freeze(['dwlf_get_events', 'dwlf_get_price_picture', 'dwlf_get_indicators', 'dwlf_get_regime',
  'dwlf_get_support_resistance', 'dwlf_get_trendlines', 'dwlf_get_market_data', 'dwlf_get_quote']);
// A noted tool whose shared wording also needs a phrase changed: the phrase change, then the note.
const NOTED_PHRASES: Readonly<Record<string, (shared: string) => string>> = {
  dwlf_get_quote: swap(' Ideal for marking a trade/skip to current price or pricing an arbitrary symbol.', ' Use it to price any tracked symbol.'),
  dwlf_get_indicators: swaps(
    ['For momentum, band and cross signals use', 'For momentum, band and cross events use'],
    ['`rsi.exit.*` / `rsi.midline.*` for RSI(14)', '`rsi.*` for RSI(14) moves back inside 70 / 30 and closes across 50'],
  ),
  // Block reads an event id inside a sentence as words (dwlf-block-api's charter), so its wording names id families
  // and leaves each id to dwlf_explain_event; retail keeps the engine's ids in the shared text.
  dwlf_get_events: swaps(
    ['RSI(14): `rsi.exit.overbought` / `rsi.exit.oversold` (back inside 70 / 30), `rsi.midline.bullish` / `rsi.midline.bearish` (a close across 50). ',
      'RSI(14) (`rsi.*`): a move back inside 70 / 30, and a close across 50. '],
    ['Divergence: `rsi.divergence.*` and `dss.divergence.*`, each `{regular,hidden}.{bullish,bearish}` (e.g. `rsi.divergence.regular.bullish`), ' +
      'compare price with RSI(14) or DSS at consecutive confirmed daily cycle lows (bullish) or highs (bearish). ',
    'Divergence (`rsi.divergence.*` and `dss.divergence.*`, regular or hidden, at lows or at highs; dwlf_explain_event names each id) ' +
      'compares price with RSI(14) or DSS at two consecutive confirmed daily cycle lows, or at two highs. '],
    ['ADX / DMI (daily, Wilder 14): `adx.trend.started.bullish` / `.bearish` (ADX rises to 25; side from the DIs), `adx.trend.faded` ' +
      '(ADX falls below 20: ranging again), `adx.di.cross.bullish` / `.bearish` (DIs cross while ADX >= 20); ',
    'ADX / DMI (daily, Wilder 14; `adx.*`): a trend start, one id per side (ADX rises to 25; side from the DIs), `adx.trend.faded` ' +
      '(ADX falls below 20: ranging again), and a DI cross, one id per side (DIs cross while ADX >= 20); '],
  ),
};
const noted = (name: string) => (shared: string): string => `${(NOTED_PHRASES[name] ?? String)(shared)} ${READING_NOTE}`;

/** A string replaces the shared description; a function rewrites it (for a one-phrase change). */
export const BLOCK_DESCRIPTIONS: Readonly<Record<string, string | ((shared: string) => string)>> = Object.freeze({
  dwlf_update_subscription:
    'Update an existing alert subscription (PATCH). Only the fields you supply change; everything else is kept. ' +
    'Most used: toggle `enabled` to pause/resume without losing the subscription\'s history. Editable fields: enabled, ' +
    'symbols, timeframes, channels, quietHours, dedupeWindowMinutes, and customEventId (custom_event subscriptions ' +
    'only). `eventTypeId` is NOT patchable: switching what an alert listens for means delete + recreate.',
  dwlf_get_ranges: swap('"at the BOTTOM of a range" (near_floor — significant alongside a daily cycle low), "at the TOP of the range — ' +
    'think twice about entering here",', '"near the floor of a range" (near_floor, read alongside a confirmed daily cycle low), "near the ' +
    'ceiling of the range",'),
  dwlf_get_divergences: swaps(
    ['Bullish = measured at lows, bearish = at highs.', 'The `direction` parameter says where it was measured: one value for lows, the other for highs.'],
    ['`direction` (bullish | bearish)', '`direction` (one of its two values: the first measured at lows, the second at highs)'],
  ),
  ...Object.fromEntries(NOTED_TOOLS.map((name) => [name, noted(name)])),
  dwlf_get_custom_event_notifications: (shared: string) => `${shared} A fire records that a condition the user defined held on that ` +
    'date: it is the output of their own rule, not a DWLF call.',
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
    'compiles it; a graph that does not compile is refused with 400) → 2) call dwlf_activate_event_symbols next (without ' +
    'it the event never fires) → 3) dwlf_evaluate_custom_event to fill its history. Until symbols are activated the event ' +
    'exists but the evaluation engine does not see it, so it records nothing. Activate symbols straight after creating it.',
  dwlf_evaluate_custom_event:
    '⚠️ Trigger an on-demand evaluation run for a custom event: the step BETWEEN activating symbols and reading its fires. ' +
    'Without it the event only evaluates on the daily run, and its history is not filled until then. It answers ' +
    'with { requestId, status: "pending" }; poll dwlf_get_evaluation_status(requestId) until status is "completed", then read ' +
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
    'Programmatically register a new DWLF account: no browser or Google sign-in required. It works only while DWLF ' +
    'sign-up is open. DWLF is in private beta, and while sign-up is closed this answers with a 403 saying so: tell your ' +
    'human, and don\'t retry. When open, it issues an API key immediately, and email verification unlocks the compute ' +
    'features (custom event evaluations).',
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
    'its weekly window\'s price band from past cycles\' moves (the same object `dwlf_get_cycle_windows` gives), and ' +
    '`depth.reading.position` places the last weekly close: `in-zone` (inside the p25–p75 of past moves), `shallow` / ' +
    '`deep` / `beyond`, or `not-reached`. It is context (no targets), and it does not change the stage or the order. ' +
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
  // The values stay the engine's (identifiers); the words around them are Block's.
  dwlf_get_divergences: (shared: Shape) => ({
    ...shared,
    direction: z.enum(['bullish', 'bearish']).optional().describe('Where it was measured: the first value at lows, the second at highs.'),
  }),
  dwlf_get_evaluation_status: (shared: Shape) => ({
    ...shared,
    requestId: z.string().describe('Evaluation request ID returned by dwlf_evaluate_custom_event'),
  }),
  dwlf_describe_strategy_nodes: (shared: Shape) => ({
    ...shared,
    nodeType: z.string().optional().describe('Give only this one node (a condition or a logic gate, by its node type id).'),
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
