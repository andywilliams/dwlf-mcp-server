import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';
import { BASIS_DEFINITIONS, BEAT_KIND_DEFINITIONS, CONDITION_STATE_DEFINITIONS, FIRE_KIND_DEFINITIONS, REPLAY_BEAT_KIND_DEFINITIONS, ROUTE_KIND_DEFINITIONS, STATUS_DEFINITIONS, THESIS_GUIDE } from './thesisGuide.js';

/**
 * Theses (thesis alerts, DWLF-855; the guide: thesisGuide.ts, DWLF-891): per symbol, the market events a user is waiting for and why, checked by
 * DWLF once a night after the close. SPT `/v2/theses` owns every rule (validation, arming, the vocabulary, price
 * redaction); these tools translate. Each answer is the backend's JSON unchanged plus an additive `agentHints`
 * block (invariant 2): a one-line `summary`, the `definitions` of the statuses and kinds it contains, and `why`
 * (what the data is). The definitions describe what was observed; none of it is advice.
 */

const WHY = 'A thesis is the user\'s own record of what they are waiting for on a symbol and why. DWLF reports which of its conditions the market has met, from events confirmed after each nightly close. It describes events; it does not say what to do about them.';

const TYPE_HINT = 'Condition types: pivot_confirmed (the next confirmed cycle low/high, optionally inside a level), close_vs_level (a daily/weekly close or intraday trade beyond a level), window_opens, trendline_break, engine_event (a short allow-list), manual. Full parameters and definitions: dwlf_list_thesis_condition_types.';

type Json = Record<string, unknown>;
type Thesis = { thesisId?: string; symbol?: string; title?: string; status?: string; currentStep?: number; steps?: unknown[]; liveness?: { note?: string } };

const countBy = (items: Json[], key: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const i of items) { const k = String(i[key] ?? 'without one'); out[k] = (out[k] || 0) + 1; }
  return out;
};
const describeCounts = (counts: Record<string, number>): string => Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
// SPT owns the vocabulary; a value this version does not know is named, not dropped, so drift shows.
const UNKNOWN = 'Not described by this version of @dwlf/mcp-server (SPT added it): see dwlf_list_thesis_condition_types.';
/** The definition of each distinct value present (nullish values skipped), UNKNOWN for one the table lacks. */
const definitionsFor = (defs: Record<string, string>, values: unknown[]): Record<string, string> =>
  Object.fromEntries([...new Set(values.filter((v) => v !== null && v !== undefined).map(String))].map((k) => [k, defs[k] ?? UNKNOWN]));

const thesisLine = (t: Thesis): string => {
  const steps = Array.isArray(t.steps) ? t.steps.length : 0;
  const where = t.status === 'in_progress' && steps ? `, step ${t.currentStep} of ${steps}` : '';
  return `${t.symbol} "${t.title}" (${t.thesisId}): ${t.status}${where}.${t.liveness?.note ? ` ${t.liveness.note}.` : ''}`;
};

/** The definitions of every status, condition state and fire kind that appears in a thesis view. */
const thesisDefinitions = (theses: Thesis[], fires: Json[] = []) => {
  const conditions = theses.flatMap((t) => [
    ...((t.steps || []) as { conditions?: Json[] }[]).flatMap((s) => s.conditions || []),
    ...(((t as Json).invalidation || []) as Json[]),
  ]);
  return {
    status: definitionsFor(STATUS_DEFINITIONS, theses.map((t) => t.status)),
    conditionState: definitionsFor(CONDITION_STATE_DEFINITIONS, conditions.map((c) => (c.state as Json | undefined)?.status)),
    ...(fires.length ? { fireKind: definitionsFor(FIRE_KIND_DEFINITIONS, fires.map((f) => f.kind)) } : {}),
  };
};

const ok = (data: unknown, agentHints: Json) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ ...(data as Json), agentHints }, null, 2) }],
});

/**
 * A refusal keeps the backend's whole body: a 422 carries the per-condition `checks` that say why, which the shared
 * error message (message only) would drop. `THESES_DISABLED` is a platform switch, not a usage error.
 */
const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const body = axios.isAxiosError(error) ? error.response?.data : undefined;
  const disabled = body && typeof body === 'object' && (body as Json).error === 'THESES_DISABLED';
  const detail = disabled
    ? ' Thesis alerts are not switched on for this platform yet (the theses.enabled setting).'
    : body && typeof body === 'object' ? `\n${JSON.stringify(body, null, 2)}` : '';
  return { content: [{ type: 'text' as const, text: `Error: ${message}${detail}` }], isError: true };
};

// Condition schemas: SPT validates and sets the limits; these tell the agent the shape.
// Loose objects and a catch-all type: a field or type SPT adds later reaches it unchanged (stripping a field would
// change the condition, which re-arms it), so an older MCP version can still revise a newer thesis. Every nested object is loose too.

const symbolField = z.string().optional().describe('Defaults to the thesis symbol. Set it when the chart and the instrument differ (e.g. watch QQQ for a CNX1 trade).');
const timeframe = z.enum(['daily', 'weekly']);
const idField = z.string().optional().describe('Keep the id you read when revising: an unchanged condition keeps its arming and its result. Omit for a new condition.');
const label = z.string().optional().describe('Your short name for the condition (≤120 chars).');

const knownCondition = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('pivot_confirmed'), id: idField, label, symbol: symbolField, timeframe,
    side: z.enum(['low', 'high']),
    after: z.string().optional().describe('YYYY-MM-DD. Only a pivot DATED after this counts: for "the next daily cycle low", set it to the last low you already know of.'),
    level: z.union([
      z.looseObject({ op: z.enum(['above', 'below']), value: z.number().positive(), label: z.string().optional() }),
      z.looseObject({ op: z.literal('inside'), low: z.number().positive(), high: z.number().positive(), label: z.string().optional() }),
    ]).optional().describe('The first such pivot inside the level = met; outside = missed (the thesis is challenged). Compared with the pivot bar\'s intraday low/high.'),
  }),
  z.looseObject({
    type: z.literal('close_vs_level'), id: idField, label, symbol: symbolField,
    basis: z.enum(['daily_close', 'weekly_close', 'intraday']), op: z.enum(['above', 'below']), value: z.number().positive(),
  }),
  z.looseObject({ type: z.literal('window_opens'), id: idField, label, symbol: symbolField, timeframe, side: z.enum(['low', 'high']) }),
  z.looseObject({ type: z.literal('trendline_break'), id: idField, label, symbol: symbolField, timeframe, direction: z.enum(['bullish', 'bearish']) }),
  z.looseObject({
    type: z.literal('engine_event'), id: idField, label, symbol: symbolField, timeframe,
    eventType: z.string().describe('One of the allow-list in dwlf_list_thesis_condition_types (e.g. cycle.low.higher_low).'),
  }),
  z.looseObject({ type: z.literal('manual'), id: idField, label: z.string().describe('What you will mark (required).'), symbol: symbolField }),
]);
const conditionSchema = z.union([
  knownCondition,
  z.looseObject({ type: z.string().describe('A condition type newer than this tool version (see dwlf_list_thesis_condition_types); SPT validates it.') }),
]);

const stepsSchema = z.array(z.looseObject({
  match: z.enum(['any', 'all']).default('any').describe('The step is met when any (or all) of its conditions are.'),
  conditions: z.array(conditionSchema).min(1),
})).min(1).describe('Ordered: step n+1 is checked only after step n is met. Limits: dwlf_list_thesis_condition_types.');
const invalidationSchema = z.array(conditionSchema).describe('Any one of these happening marks the thesis challenged (review it). Optional.');

const textFields = {
  title: z.string().describe('One line: what you are waiting for.'),
  context: z.string().optional().describe('Your assessment, why you are waiting. Replayed verbatim in every alert.'),
  nextStep: z.string().optional().describe('What you intend to look at when it fires (your words).'),
};

/** Upper-cases/dash-normalises every symbol the agent supplied, at thesis and condition level (invariant 1). */
const withSymbols = <T extends Json>(conditions: T[] | undefined): T[] | undefined =>
  conditions?.map((c) => (typeof c.symbol === 'string' ? { ...c, symbol: normalizeSymbol(c.symbol) } : c));
const stepsWithSymbols = (steps: { match: string; conditions: Json[] }[] | undefined) =>
  steps?.map((s) => ({ ...s, conditions: withSymbols(s.conditions) }));

const defined = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const savedSummary = (data: Json, verb: string): string => {
  if (data.unchanged) { return 'Unchanged: an identical thesis with this clientKey already exists; nothing was written.'; }
  const t = data.thesis as Thesis | undefined;
  const delivery = data.delivery as { channel?: unknown; reason?: string } | undefined;
  const where = delivery && !delivery.channel && delivery.reason ? ` Digest: ${delivery.reason}.` : '';
  return t ? `${verb} ${thesisLine(t)}${where}` : verb;
};

/** The dry-run summary only for a reply that says it was one; otherwise say plainly that SPT may have saved it. */
const dryRunSummary = (data: Json, saved: string) => (data.dryRun === true
  ? REVISION_DRY_RUN
  : `This API did not run a dry run (it may not support one for revisions yet), so the change may have been saved. ${saved}`);
const REVISION_DRY_RUN = 'Dry run: nothing was saved. `checks` covers the changed conditions (listed in `changed`): whether each can occur or is already true. `wouldSave` says whether the revision would be accepted.';

/** How to tell a story to the user: what happened and what the thesis needs, never what price will do. */
const STORY_RULE = 'Tell it as what happened and what the thesis needs next, in the beats\' own facts. Never as an expectation or a forecast: a needs-next beat says what would meet a step, not that it will happen.';
/** How to describe the illustrated routes (DWLF-888): illustrations from the engine's numbers, never expectations. */
const ROUTE_RULE = 'Routes (current.routes, and a plan\'s routes as drawn at that save) are ILLUSTRATIONS, not forecasts: describe a meets route as "a shape price could take for the remaining steps to be met" and a challenges route as "one way the thesis could be challenged", always both together, and quote illustration.disclaimer.text. Name a leg\'s numbers from its basis (a window edge, a depth-band percentile, the condition\'s level); never present a route vertex\'s price as a level to aim for or one price will reach, and never say how likely a route is. A plan\'s routes are what that plan illustrated then: never score them against what price did (no hit or miss). No routes: say why, from current.routeNote.';

/** How to tell a replay (DWLF-889): the plan as drawn against what happened, facts only, nothing scored. */
const REPLAY_RULE = 'Replay (replay: true) is the plan as drawn told against what happened, in facts only. Give the date each step was met beside the date its plan had illustrated it as two dates, never as a difference, and never score the illustration: no right, wrong, early, late, accurate, hit or miss. Say a window was redrawn when windows[].redrawn is true. When replay.asDrawn.reconstructed is true, say the plan was reconstructed after the fact, not captured at the time; when a beat has a note (no plan, no checkpoint), say so. replaySummary is the one-sentence account to quote.';

// SPT's body read defensively: an array's object elements (a null one skipped, never a thrown TypeError), else [].
const objectsIn = (v: unknown): Json[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is Json => Boolean(x) && typeof x === 'object') : []);

/** The routes in a line: how many of each kind are drawn, or why none (routeNote). */
const routesLine = (data: Json): string => {
  const current = (data.current && typeof data.current === 'object' ? data.current : {}) as { routes?: Json[]; routeNote?: string | null };
  const routes = objectsIn(current.routes);
  if (!routes.length) { return current.routeNote ? ` ${current.routeNote}` : ''; }
  const count = countBy(routes as Json[], 'kind');
  const words = Object.entries(count).map(([kind, n]) => `${n} ${kind}`).join(', ');
  return ` Illustrated routes (illustrations, not forecasts): ${words}.`;
};

/** One line: how many beats, the last thing that happened, what it needs next, and the plan's note (reconstructed, or none). */
const storyLine = (data: Json, { replayAsked = false }: { replayAsked?: boolean } = {}): string => {
  const s = (data.summary && typeof data.summary === 'object' ? data.summary : {}) as { beats?: number; last?: { sentence?: string } | null; needsNext?: string | null };
  const count = Number.isFinite(s.beats) ? s.beats : Array.isArray(data.beats) ? data.beats.length : null;
  const last = s.last?.sentence ? ` Last: ${s.last.sentence}` : '';
  const next = s.needsNext ? ` Next: ${s.needsNext}` : '';
  const note = data.planNote ? ` Plan: ${String(data.planNote)}` : '';
  return `${data.symbol ?? 'Thesis'} story, ${count ?? 'an unknown number of'} beats.${last}${next}${note}${routesLine(data)}${replayLine(data, replayAsked)}`;
};

/** The replay in a line (DWLF-889): the summary sentence, and whether replay is open (asked for) and against what plan. */
const replayLine = (data: Json, asked: boolean): string => {
  const summary = typeof data.replaySummary === 'string' && data.replaySummary ? ` Summary: ${data.replaySummary}` : '';
  const r = (data.replay && typeof data.replay === 'object' ? data.replay : null) as { available?: boolean; note?: string | null; asDrawn?: { label?: string; reconstructed?: boolean } | null; omitted?: { plans?: number; checkpoints?: number } } | null;
  // Asked for and not returned: an API without replay, never "not open yet".
  if (!r) { return asked ? `${summary} This API did not return a replay (it may not support one yet); that says nothing about the thesis.` : summary; }
  if (r.available !== true) { return `${summary} Replay: ${r.note || 'not open yet.'}`; }
  const label = r.asDrawn?.label ? String(r.asDrawn.label) : null;
  // The caveat is said from the flag, whatever SPT's label says.
  const caveat = r.asDrawn?.reconstructed === true && !/reconstructed/i.test(label || '') ? ' (reconstructed after the fact, not captured at the time)' : '';
  const against = label ? ` against ${label}${caveat}` : (caveat ? ` against a plan${caveat}` : '');
  // SPT's shape (serverless-portfolio-tracker #838, pinned by its tests): { plans: count, checkpoints: count }, present only when one is above 0.
  const omitted = [r.omitted?.plans, r.omitted?.checkpoints].some((n) => Number.isFinite(n) && (n as number) > 0);
  const left = omitted ? ' Some older plan bodies were left out for size (replay.omitted); their beats are kept.' : '';
  return `${summary} Replay${against}${r.note ? `: ${r.note}` : '.'}${left}`;
};

export function registerThesisTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_thesis_guide',
    'Start here for theses (what a user is waiting for on a symbol, checked by DWLF every night after the close). Returns what theses are, what they save the user (decide once; told when it happens; honest knowable-at timing; how close each is), their honest limits (end of day; information, not advice), the rules for building one that DWLF can check exactly, the workflow across the thesis tools, and three worked examples with the exact dwlf_create_thesis payloads. No API call.',
    {},
    async () => ok({ guide: THESIS_GUIDE }, {
      summary: 'The theses guide: what, benefits, limits, rules, workflow and three worked examples.',
      why: 'Read before building a thesis or explaining the feature to the user. The condition types and fields themselves come from dwlf_list_thesis_condition_types.',
    })
  );

  server.tool(
    'dwlf_list_thesis_condition_types',
    `The vocabulary of theses: each condition type with its parameters, a definition, its fields as data (name, kind, required, values, help) and whether it may be an invalidation; the rules (ordered steps, invalidation, arming, nightly checking) and the limits. Only these types exist: DWLF checks exactly what their fields say. Read this before dwlf_create_thesis (dwlf_thesis_guide has worked examples). ${TYPE_HINT}`,
    {},
    async () => {
      try {
        const data = await client.get('/theses/condition-types');
        return ok(data, { summary: 'The six condition types a thesis can wait for, and the rules that apply to all of them.', why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_create_thesis',
    `Save what the user is waiting for on a symbol, and why: ordered steps of conditions, optional invalidation conditions, and the user's own context and next step. DWLF checks it once a night after the close and tells the user when a step is met or it is challenged (a Telegram digest if set up, an in-app notification, and dwlf_list_thesis_fires); nothing known before a condition was saved counts.
Build it tight and detectable: only the listed condition types, each label saying exactly what its fields check. For "the next pivot after one I already know of" use pivot_confirmed with \`after\`. Before the confirming low exists, an invalidation cannot be "a close below the new low": use engine_event cycle.low.break (the latest confirmed low breaks) or a close_vs_level against a level the user already knows. Worked examples: dwlf_thesis_guide.
Use dryRun: true first: it restates every condition in plain words (\`checks\`) and checks each can occur, writing nothing. Show the restatement to the user before saving.
Refusals: 422 CANNOT_OCCUR (a condition can never happen for its symbol), 422 ALREADY_MET (a step condition is already true now; set allowAlreadyMet to save anyway). The refusal's checks are returned.
clientKey makes the call an upsert (re-sending an identical thesis writes nothing; a changed one writes a new revision). ${TYPE_HINT}`,
    {
      symbol: z.string().describe('The thesis symbol, e.g. AMZN, BTC-USD.'),
      ...textFields,
      group: z.string().optional().describe('Optional grouping, e.g. a watchlist name.'),
      steps: stepsSchema,
      invalidation: invalidationSchema.optional(),
      clientKey: z.string().optional().describe('Your stable key for this thesis (e.g. "amzn-dcl-nov"), making re-sends safe.'),
      allowAlreadyMet: z.boolean().optional().describe('Save even if a step condition is already true now.'),
      dryRun: z.boolean().optional().describe('Restate and check only; nothing is saved.'),
    },
    async ({ symbol, title, context, nextStep, group, steps, invalidation, clientKey, allowAlreadyMet, dryRun }) => {
      try {
        const body = defined({
          symbol: normalizeSymbol(symbol), title, context, nextStep, group, clientKey, allowAlreadyMet, source: 'mcp',
          steps: stepsWithSymbols(steps as { match: string; conditions: Json[] }[]), invalidation: withSymbols(invalidation as Json[] | undefined),
        });
        const data = await client.post(dryRun ? '/theses?dryRun=true' : '/theses', body) as Json;
        const summary = dryRun
          ? 'Dry run: nothing was saved. `checks` restates each condition and says whether it can occur or is already true.'
          : savedSummary(data, 'Saved:');
        const theses = data.thesis ? [data.thesis as Thesis] : [];
        return ok(data, { summary, definitions: thesisDefinitions(theses), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_list_theses',
    'The user\'s theses: each with its steps and conditions (pending, met, missed or marked), status (waiting, in_progress, complete, challenged, archived, closed) and liveness (the bar it was last checked against; `stale` when the nightly check has been quiet over 30 hours). A challenged thesis is waiting for the user\'s review. With includeProgress, each active thesis also says how close it is: per pending condition of its current step and per pending invalidation, exact `words` plus fields (a price condition\'s last close and % move to the level; a forming pivot\'s % developed; a weekly window\'s opening date), and `closest`, the one "closest to trigger" choice to sort by (`rank` ascending; `short` for a list). Closes and distances are withheld for keys not entitled to raw prices; the % change since saved is not. With includeStory, each active thesis also carries `storySummary` (the last thing that happened and what it needs next, and `replaySummary`, one sentence of facts, once a step is met or the thesis is complete or challenged; null before).',
    {
      status: z.string().optional().describe('Filter: waiting, in_progress, complete, challenged, archived or closed.'),
      symbol: z.string().optional().describe('Filter by thesis symbol.'),
      group: z.string().optional().describe('Filter by group.'),
      includeProgress: z.boolean().optional().describe('Also say how close each active thesis is to its next condition (and its nearest invalidation), with `closest` to sort by. A few extra reads; leave off for a plain list.'),
      includeStory: z.boolean().optional().describe('Also give each active thesis a one-line `storySummary` { beats, last { date, sentence }, needsNext, replaySummary }: the story dwlf_get_thesis_story tells, in brief (replaySummary null until a step is met or the thesis is complete or challenged; dwlf_get_thesis_story always gives one). A few extra reads.'),
    },
    async ({ status, symbol, group, includeProgress, includeStory }) => {
      try {
        const include = [includeProgress ? 'progress' : null, includeStory ? 'story' : null].filter(Boolean).join(',') || undefined;
        const data = await client.get('/theses', {
          status, symbol: symbol ? normalizeSymbol(symbol) : undefined, group, include,
        }) as Json;
        const theses = (data.theses || []) as Thesis[];
        // With progress: name the closest few, in SPT's own short words and order (closest.rank, compared element by element,
        // ascending). A thesis whose closest has no short or no numeric rank is left out of the line, never an error.
        const rankOf = (t: Json): number[] | null => {
          const c = (t.progress as Json | undefined)?.closest as Json | undefined;
          const rank = c?.rank;
          return c?.short && Array.isArray(rank) && rank.length > 0 && rank.every((v) => Number.isFinite(v)) ? rank as number[] : null;
        };
        const byRank = (a: number[], b: number[]) => {
          for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
            const d = (a[i] ?? 0) - (b[i] ?? 0);
            if (d !== 0) { return d; }
          }
          return 0;
        };
        const ranked = includeProgress
          ? (theses as Json[]).filter((t) => rankOf(t)).sort((a, b) => byRank(rankOf(a) as number[], rankOf(b) as number[]))
          : [];
        const closestLine = ranked.length
          ? ` Closest to trigger: ${ranked.slice(0, 3).map((t) => `${t.symbol} (${((t.progress as Json).closest as Json).short})`).join(', ')}.`
          : '';
        const summary = theses.length
          ? `${theses.length} thes${theses.length === 1 ? 'is' : 'es'}: ${describeCounts(countBy(theses as Json[], 'status'))}.${closestLine}`
          : 'No theses match.';
        return ok(data, { summary, definitions: thesisDefinitions(theses), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_get_thesis',
    'One thesis in full: every condition with its state, the revisions (earlier ones are kept), its fires (what happened, when DWLF could know it) and liveness. Read `currentRevision` here before dwlf_revise_thesis or a review that revises.',
    { thesisId: z.string().describe('Thesis ID') },
    async ({ thesisId }) => {
      try {
        const data = await client.get(`/theses/${encodeURIComponent(thesisId)}`) as Json;
        const t = data.thesis as (Thesis & { fires?: Json[] }) | undefined;
        if (!t) { return ok(data, { summary: 'The response carried no thesis.', why: WHY }); }
        return ok(data, { summary: thesisLine(t), definitions: thesisDefinitions([t], t.fires || []), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_get_thesis_story',
    `One thesis told as a story, in steps ("beats"): what happened (saved, revisions, the cycle windows, the engine events its conditions name, its fires), where it stands now, and what each unmet step needs next. Each beat has a plain \`sentence\`, \`knowableAt\` (when DWLF could first know it), \`checkedAs\` (the condition it speaks to, in its label's words) and \`means\` (what it does to the steps). Also the plan as drawn when a revision was saved (\`plan\`, stored once and never changed; \`planNote\` says when it was reconstructed after the fact or none was captured), \`definitions\`, a \`disclaimer\` and \`deepLink\` (opens the story on the DWLF site at "now"; set its \`story\` query value to a beat's \`id\` to open that beat). \`current.routes\`: illustrated routes past today, one that meets the remaining steps and one per way the thesis could be challenged (both or none), each leg naming the engine numbers it was drawn from (\`basis\`); \`illustration\` carries their disclaimer, watermark and legend. \`replaySummary\` (always present): one sentence of facts (saved, each step met, challenge and revision with its date, the outcome). With replay: true, once a step is met or the thesis has an outcome, \`replay\` tells the plan as drawn against what happened: \`asDrawn\`, \`met\` (where each step was met, beside where its plan had illustrated it), \`windows\` (as drawn vs today), \`beats\`, \`plans\` and \`checkpoints\` (the plan just after each fire). ${STORY_RULE} ${ROUTE_RULE} ${REPLAY_RULE} Engine prices (route vertices included) are withheld for keys not entitled to raw prices.`,
    {
      thesisId: z.string().describe('Thesis ID'),
      revision: z.number().int().positive().optional().describe('Whose plan as drawn to return (1..currentRevision). Default: the current revision.'),
      replay: z.boolean().optional().describe('Also return `replay`: the plan as drawn told against what happened (open once a step is met or the thesis has an outcome). Larger: every plan and checkpoint.'),
    },
    async ({ thesisId, revision, replay }) => {
      try {
        const data = await client.get(`/theses/${encodeURIComponent(thesisId)}/story`, defined({ revision, replay: replay ? 1 : undefined })) as Json;
        const beats = (Array.isArray(data.beats) ? data.beats : []) as Json[];
        const rp = (data.replay && typeof data.replay === 'object' ? data.replay : {}) as Json;
        const replayPlans = [...objectsIn(rp.plans), ...objectsIn(rp.checkpoints)];
        const routes = [...objectsIn((data.current as Json | undefined)?.routes), ...objectsIn((data.plan as Json | undefined)?.routes), ...replayPlans.flatMap((p) => objectsIn(p.routes))];
        const replayBeats = objectsIn(rp.beats);
        const bases = routes.flatMap((r) => objectsIn(r.legs).flatMap((l) => objectsIn(l.basis).map((b) => String(b?.stat ?? '').split('.')[0])));
        const definitions = {
          beatKind: definitionsFor(BEAT_KIND_DEFINITIONS, beats.map((b) => b?.kind)),
          ...(routes.length ? { routeKind: definitionsFor(ROUTE_KIND_DEFINITIONS, routes.map((x) => x?.kind)), basis: definitionsFor(BASIS_DEFINITIONS, bases) } : {}),
          ...(replayBeats.length ? { replayBeatKind: definitionsFor(REPLAY_BEAT_KIND_DEFINITIONS, replayBeats.map((b) => b?.kind)) } : {}),
        };
        return ok(data, { summary: storyLine(data, { replayAsked: replay === true }), definitions, how: `${STORY_RULE} ${ROUTE_RULE} ${REPLAY_RULE}`, why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_revise_thesis',
    `Change a thesis: writes a new revision and keeps the earlier ones. Send expectedRevision (the currentRevision you read; 409 REVISION_CONFLICT if it moved) and only the fields to change. steps/invalidation, when sent, replace the whole list: keep each unchanged condition's id so it keeps its arming and result. A changed or new condition is armed from now (nothing before counts). Same refusals as create (422 CANNOT_OCCUR / ALREADY_MET), for the changed conditions only. Use dryRun: true first: the same check for the revision (only the changed conditions, listed in \`changed\`, are judged; an unchanged condition already met is fine), writing nothing; show it to the user. ${TYPE_HINT}`,
    {
      thesisId: z.string().describe('Thesis ID'),
      expectedRevision: z.number().int().describe('The currentRevision you read.'),
      title: textFields.title.optional(),
      context: textFields.context,
      nextStep: textFields.nextStep,
      steps: stepsSchema.optional(),
      invalidation: invalidationSchema.optional(),
      allowAlreadyMet: z.boolean().optional(),
      dryRun: z.boolean().optional().describe('Check the revision as it would be saved; nothing is written.'),
    },
    async ({ thesisId, expectedRevision, title, context, nextStep, steps, invalidation, allowAlreadyMet, dryRun }) => {
      try {
        const body = defined({
          expectedRevision, title, context, nextStep, allowAlreadyMet, source: 'mcp',
          steps: stepsWithSymbols(steps as { match: string; conditions: Json[] }[] | undefined), invalidation: withSymbols(invalidation as Json[] | undefined),
        });
        const data = await client.patch(`/theses/${encodeURIComponent(thesisId)}${dryRun ? '?dryRun=true' : ''}`, body) as Json;
        const t = data.thesis as Thesis | undefined;
        return ok(data, { summary: dryRun ? dryRunSummary(data, savedSummary(data, 'Revised:')) : savedSummary(data, 'Revised:'), definitions: thesisDefinitions(t ? [t] : []), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_review_thesis',
    `Record the user's answer to a thesis (usually a challenged one): keep (unchanged; clears the challenge), revise (a new revision: send expectedRevision and the fields to change, as dwlf_revise_thesis) or close (ends it, with an outcome). Record the user's own answer; do not choose it for them. For revise, dryRun: true checks the revision first (as dwlf_revise_thesis), writing nothing.`,
    {
      thesisId: z.string().describe('Thesis ID'),
      answer: z.enum(['keep', 'revise', 'close']),
      outcome: z.looseObject({
        kind: z.enum(['acted', 'not_acted', 'note']),
        note: z.string().optional(),
        links: z.array(z.string()).max(5).optional(),
      }).optional().describe('For close: what the user did, in their words.'),
      expectedRevision: z.number().int().optional().describe('For revise: the currentRevision you read.'),
      title: textFields.title.optional(),
      context: textFields.context,
      nextStep: textFields.nextStep,
      steps: stepsSchema.optional(),
      invalidation: invalidationSchema.optional(),
      allowAlreadyMet: z.boolean().optional().describe('For revise: save even if a step condition is already true now.'),
      dryRun: z.boolean().optional().describe('For revise only: check the revision as it would be saved; nothing is written.'),
    },
    async ({ thesisId, answer, outcome, expectedRevision, title, context, nextStep, steps, invalidation, allowAlreadyMet, dryRun }) => {
      try {
        const body = defined({
          answer, outcome, expectedRevision, title, context, nextStep, allowAlreadyMet, source: 'mcp',
          steps: stepsWithSymbols(steps as { match: string; conditions: Json[] }[] | undefined), invalidation: withSymbols(invalidation as Json[] | undefined),
        });
        // A dry run only exists for a revise: keep and close are never sent with it (they would be recorded).
        if (dryRun && answer !== 'revise') {
          return { content: [{ type: 'text' as const, text: 'Error: dryRun applies to answer revise only; keep and close have no dry run. Nothing was sent.' }], isError: true };
        }
        const data = await client.post(`/theses/${encodeURIComponent(thesisId)}/review${dryRun ? '?dryRun=true' : ''}`, body) as Json;
        const t = data.thesis as Thesis | undefined;
        if (dryRun) { return ok(data, { summary: dryRunSummary(data, t ? `Review recorded (revise): ${thesisLine(t)}` : 'Review recorded (revise).'), definitions: thesisDefinitions(t ? [t] : []), why: WHY }); }
        return ok(data, { summary: t ? `Review recorded (${answer}): ${thesisLine(t)}` : `Review recorded (${answer}).`, definitions: thesisDefinitions(t ? [t] : []), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_mark_thesis_condition_met',
    'Mark one of a thesis\'s MANUAL conditions met (once), with an optional note: something only the user can judge (e.g. "the news I was waiting for came out"). The nightly check records it on its next run. Only manual conditions can be marked (400 NOT_A_MANUAL_CONDITION); a second mark is 409 ALREADY_MARKED.',
    {
      thesisId: z.string().describe('Thesis ID'),
      conditionId: z.string().describe('The manual condition\'s id (from dwlf_get_thesis).'),
      note: z.string().optional(),
    },
    async ({ thesisId, conditionId, note }) => {
      try {
        const data = await client.post(`/theses/${encodeURIComponent(thesisId)}/mark-met`, defined({ conditionId, note })) as Json;
        const t = data.thesis as Thesis | undefined;
        return ok(data, { summary: `Marked ${conditionId}.${t ? ` ${thesisLine(t)}` : ''}`, definitions: thesisDefinitions(t ? [t] : []), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_archive_thesis',
    'Archive a thesis: it is kept, with its revisions and fires, in the journal and is no longer checked. To end it with an outcome instead, use dwlf_review_thesis with answer close.',
    { thesisId: z.string().describe('Thesis ID') },
    async ({ thesisId }) => {
      try {
        const data = await client.post(`/theses/${encodeURIComponent(thesisId)}/archive`, {}) as Json;
        return ok(data, { summary: `Archived ${thesisId}: kept, no longer checked.`, why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_delete_thesis',
    'Permanently delete a thesis with its revisions and fires. This cannot be undone; dwlf_archive_thesis keeps the record instead. Confirm with the user first.',
    { thesisId: z.string().describe('Thesis ID') },
    async ({ thesisId }) => {
      try {
        const data = await client.delete(`/theses/${encodeURIComponent(thesisId)}`);
        return ok(data, { summary: `Deleted ${thesisId}, with its revisions and fires.` });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_list_thesis_fires',
    'The feed of thesis fires, oldest first: each time a step was met, a condition was missed, an invalidation was hit or a deciding event was withdrawn, across all the user\'s theses. Pass back the returned `cursor` next time to read only new fires (each fire is read once). The cursor is yours to keep (this server stores nothing): with none, the feed pages from the oldest fire, and the ones the user has not seen are the loud fires with `acknowledgedAt` null. `knowableAt` is when DWLF could first know it; `session` the bar. Closes are withheld for keys not entitled to raw prices. After telling the user, acknowledge with dwlf_ack_thesis_fires.',
    {
      cursor: z.string().optional().describe('The cursor from your last read; omit to start from the oldest.'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 50.'),
    },
    async ({ cursor, limit }) => {
      try {
        const data = await client.get('/theses/fires', { cursor, limit }) as Json;
        const fires = (data.fires || []) as Json[];
        const unacked = fires.filter((f) => f.loud && !f.acknowledgedAt).length;
        const summary = fires.length
          ? `${fires.length} fire(s): ${describeCounts(countBy(fires, 'kind'))}; ${unacked} not yet acknowledged. Keep \`cursor\` for the next read.`
          : 'No new fires. Keep `cursor` for the next read.';
        return ok(data, { summary, definitions: { fireKind: definitionsFor(FIRE_KIND_DEFINITIONS, fires.map((f) => f.kind)) }, why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_ack_thesis_fires',
    'Acknowledge fires the user has seen (up to 100 per call), so the app stops showing them as new. Pass { thesisId, fireId } pairs from dwlf_list_thesis_fires or dwlf_get_thesis.',
    {
      fires: z.array(z.object({ thesisId: z.string(), fireId: z.string() })).min(1).max(100),
    },
    async ({ fires }) => {
      try {
        const data = await client.post('/theses/fires/ack', { fires }) as Json;
        return ok(data, { summary: `Acknowledged ${String(data.acknowledged ?? fires.length)} fire(s).` });
      } catch (error) { return fail(error); }
    }
  );
}
