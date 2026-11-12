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

/** A string replaces the shared description; a function rewrites it (for a one-phrase change). */
export const BLOCK_DESCRIPTIONS: Readonly<Record<string, string | ((shared: string) => string)>> = Object.freeze({
  dwlf_update_subscription:
    'Update an existing alert subscription (PATCH). Only the fields you supply change; everything else is kept. ' +
    'Most used: toggle `enabled` to pause/resume without losing the subscription\'s history. Editable fields: enabled, ' +
    'symbols, timeframes, channels, quietHours, dedupeWindowMinutes, and customEventId (custom_event subscriptions ' +
    'only). `eventTypeId` is NOT patchable: switching what an alert listens for means delete + recreate.',
  dwlf_get_ranges: (shared: string) => shared.replace(' "at the TOP of the range — think twice about entering here",', ' "at the TOP of the range",'),
  dwlf_create_subscription:
    'Create an alert subscription: get told when an event fires. Two shapes, distinguished by `eventTypeId`:\n' +
    '  - any event id (e.g. `onchain.mvrv.cross_above_1`, `cycle.low.confirmed`, `swing_low_break`): fires when that event is recorded;\n' +
    '  - `custom_event`: requires `customEventId`; fires when that custom event fires.\n\n' +
    '`symbols` controls scope: an array of symbols, or `[\'*\']` for every symbol the account follows. `timeframes` accepts ' +
    '`[\'1d\']`, `[\'1w\']`, or `[\'*\']` for any. `channels` is an array of delivery destinations, currently ' +
    '`{ type: \'telegram\', destination: { chatId: <id> }, enabled: true }`. An alert says what happened and when; it is ' +
    'not a recommendation. A plan limits how many alerts an account may have, and which event families it may alert on.',
  dwlf_describe_strategy_nodes:
    'Describe the condition nodes a custom event is built from: what each one checks, its parameters and their engine ' +
    'defaults. Optional `nodeType` filters to one node; `category: "condition"` lists the indicator and event condition ' +
    'nodes. Indicator/event condition nodes come from the platform\'s node catalogue (GET /v2/node-types, cached up to 15 ' +
    'minutes; an unfiltered call lists them by name, ask by nodeType or category "condition" for detail), marked ' +
    '`source: "catalogue"` with `label`, `direction`, `timeframes` (the only ones the node fires on) and ' +
    '`catalogueCategory`. When `honoredByExecutor: false` on a param, the listed `default` is the only value the engine ' +
    'uses; `honoredByExecutor: null` means not verified (the parameter reaches the compiled event; its effect is not ' +
    'checked here). A node with `engineIgnored` is one the engine cannot evaluate: do not use it. `engineIgnores` is the raw rule ' +
    'list ({ id } or { prefix }, with a reason). `catalogueError` means the catalogue could not be read and only the ' +
    'static nodes are listed.',
  dwlf_create_custom_event:
    '⚠️ Create a new custom event (a condition you define, recorded each time it holds). WORKFLOW: 1) create → 2) compile ' +
    '→ 3) MUST call dwlf_activate_event_symbols (or the event will never fire) → 4) dwlf_evaluate_custom_event to fill ' +
    'its history. Until symbols are activated the event exists but the evaluation engine does not see it, so it records ' +
    'nothing. Activate symbols straight after creating it.',
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
    'first. Call straight after compiling an event.',
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
  dwlf_get_evaluation_status: (shared: Shape) => ({
    ...shared,
    requestId: z.string().describe('Evaluation request ID returned by dwlf_evaluate_custom_event'),
  }),
  dwlf_describe_strategy_nodes: (shared: Shape) => ({
    ...shared,
    nodeType: z.string().optional().describe('Return only this one condition node (by its node type id).'),
    category: z.enum(['condition']).optional().describe('Condition nodes are the only category in Block.'),
  }),
});

/** Block handlers: each wraps the shared one. The node catalogue answers with condition nodes only. */
type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean };
export const BLOCK_HANDLERS: Readonly<Record<string, (shared: Handler) => Handler>> = Object.freeze({
  // A nodeType lookup ignores `category`, so a non-condition node (a stop-loss, a take-profit, an entry signal) is
  // refused after the lookup rather than described.
  dwlf_describe_strategy_nodes: (shared: Handler) => async (args, extra) => {
    const res = (await shared({ ...args, category: 'condition' }, extra)) as ToolResult;
    if (!args.nodeType || res.isError) { return res; }
    let nodes: { category?: string }[] = [];
    try { nodes = (JSON.parse(res.content?.[0]?.text ?? '{}') as { nodes?: { category?: string }[] }).nodes ?? []; } catch { nodes = []; }
    if (nodes.length && nodes.every((n) => n.category === 'condition')) { return res; }
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: `Not a condition node: ${String(args.nodeType)}`,
      hint: 'Block custom events are built from condition nodes; call with category "condition" (or no arguments) to list them.' }, null, 2) }] };
  },
});
