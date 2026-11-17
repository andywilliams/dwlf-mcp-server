import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * Thesis alerts, "Waiting for" (DWLF-855): per symbol, the market events a user is waiting for and why, checked by
 * DWLF once a night after the close. SPT `/v2/theses` owns every rule (validation, arming, the vocabulary, price
 * redaction); these tools translate. Each answer is the backend's JSON unchanged plus an additive `agentHints`
 * block (invariant 2): a one-line `summary`, the `definitions` of the statuses and kinds it contains, and `why`
 * (what the data is). The definitions describe what was observed; none of it is advice.
 */

const STATUS_DEFINITIONS = {
  waiting: 'No step met yet. The first step is being checked.',
  in_progress: 'One or more steps met, in order. `currentStep` is the step being checked now.',
  complete: 'Every step met.',
  challenged: 'An invalidation condition was hit, or a step condition was missed. A thesis does not end on its own: the user answers with a review (keep, revise or close).',
  archived: 'Kept in the journal, no longer checked.',
  closed: 'Closed by the user through a review, with an outcome.',
} as const;

const CONDITION_STATE_DEFINITIONS = {
  pending: 'Not decided yet.',
  met: 'Decided: the event happened as described (`at`, `knowableAt` say when DWLF could know it).',
  missed: 'Decided: the event happened outside the condition (e.g. the pivot printed outside its level).',
  marked: 'A manual condition the user marked met; the nightly check records it on its next run.',
} as const;

const FIRE_KIND_DEFINITIONS = {
  step_met: 'A step\'s conditions were met (any or all, as the step says).',
  condition_missed: 'A step condition was decided outside its level; the thesis is challenged.',
  invalidation_hit: 'An invalidation condition happened; the thesis is challenged.',
  source_failed: 'The event that decided a condition is no longer in the engine\'s data (it was withdrawn).',
} as const;

const WHY = 'A thesis is the user\'s own record of what they are waiting for on a symbol and why. DWLF reports which of its conditions the market has met, from events confirmed after each nightly close. It describes events; it does not say what to do about them.';

const TYPE_HINT = 'Condition types: pivot_confirmed (the next confirmed cycle low/high, optionally inside a level), close_vs_level (a daily/weekly close or intraday trade beyond a level), window_opens, trendline_break, engine_event (a short allow-list), manual. Full parameters and definitions: dwlf_list_thesis_condition_types.';

type Json = Record<string, unknown>;
type Thesis = { thesisId?: string; symbol?: string; title?: string; status?: string; currentStep?: number; steps?: unknown[]; liveness?: { note?: string } };

const countBy = (items: Json[], key: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const i of items) { const k = String(i[key] ?? 'unknown'); out[k] = (out[k] || 0) + 1; }
  return out;
};
const describeCounts = (counts: Record<string, number>): string => Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
// SPT owns the vocabulary; a value this version does not know is named, not dropped, so drift shows.
const UNKNOWN = 'Not described by this version of @dwlf/mcp-server (SPT added it): see dwlf_list_thesis_condition_types.';
const pick = (defs: Record<string, string>, keys: string[]): Record<string, string> =>
  Object.fromEntries([...new Set(keys)].filter((k) => k !== 'undefined').map((k) => [k, defs[k] ?? UNKNOWN]));

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
    status: pick(STATUS_DEFINITIONS, theses.map((t) => String(t.status))),
    conditionState: pick(CONDITION_STATE_DEFINITIONS, conditions.map((c) => String((c.state as Json | undefined)?.status))),
    ...(fires.length ? { fireKind: pick(FIRE_KIND_DEFINITIONS, fires.map((f) => String(f.kind))) } : {}),
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
    ? ' Thesis alerts are not switched on for this platform yet (the theses.enabled setting); nothing was saved.'
    : body && typeof body === 'object' ? `\n${JSON.stringify(body, null, 2)}` : '';
  return { content: [{ type: 'text' as const, text: `Error: ${message}${detail}` }], isError: true };
};

// ── condition schemas (SPT validates and sets the limits; these tell the agent the shape) ──
// Loose objects and a catch-all type: a field or type SPT adds later reaches it unchanged (stripping a field would
// change the condition, which re-arms it), so an older MCP version can still revise a newer thesis.────────────────────────────────────────

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
      z.object({ op: z.enum(['above', 'below']), value: z.number().positive(), label: z.string().optional() }),
      z.object({ op: z.literal('inside'), low: z.number().positive(), high: z.number().positive(), label: z.string().optional() }),
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

const stepsSchema = z.array(z.object({
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

export function registerThesisTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_list_thesis_condition_types',
    `The vocabulary of thesis alerts ("Waiting for"): each condition type with its parameters and a definition, the rules (ordered steps, invalidation, arming, nightly checking) and the limits. Read this before dwlf_create_thesis. ${TYPE_HINT}`,
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
    `Save what the user is waiting for on a symbol, and why ("Waiting for", DWLF-855): ordered steps of conditions, optional invalidation conditions, and the user's own context. DWLF checks it once a night after the close and sends one Telegram digest per run when something happens; nothing known before a condition was saved counts.
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
    'The user\'s theses ("Waiting for"): each with its steps and conditions (pending, met, missed or marked), status (waiting, in_progress, complete, challenged, archived, closed) and liveness (the bar it was last checked against; `stale` when the nightly check has been quiet over 30 hours). A challenged thesis is waiting for the user\'s review. Closes are withheld for keys not entitled to raw prices; the % change is not.',
    {
      status: z.string().optional().describe('Filter: waiting, in_progress, complete, challenged, archived or closed.'),
      symbol: z.string().optional().describe('Filter by thesis symbol.'),
      group: z.string().optional().describe('Filter by group.'),
    },
    async ({ status, symbol, group }) => {
      try {
        const data = await client.get('/theses', { status, symbol: symbol ? normalizeSymbol(symbol) : undefined, group }) as Json;
        const theses = (data.theses || []) as Thesis[];
        const summary = theses.length
          ? `${theses.length} thes${theses.length === 1 ? 'is' : 'es'}: ${describeCounts(countBy(theses as Json[], 'status'))}.`
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
        const t = data.thesis as Thesis & { fires?: Json[] };
        return ok(data, { summary: thesisLine(t), definitions: thesisDefinitions([t], t.fires || []), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_revise_thesis',
    `Change a thesis: writes a new revision and keeps the earlier ones. Send expectedRevision (the currentRevision you read; 409 REVISION_CONFLICT if it moved) and only the fields to change. steps/invalidation, when sent, replace the whole list: keep each unchanged condition's id so it keeps its arming and result. A changed or new condition is armed from now (nothing before counts). Same refusals as create (422 CANNOT_OCCUR / ALREADY_MET). ${TYPE_HINT}`,
    {
      thesisId: z.string().describe('Thesis ID'),
      expectedRevision: z.number().int().describe('The currentRevision you read.'),
      title: textFields.title.optional(),
      context: textFields.context,
      nextStep: textFields.nextStep,
      steps: stepsSchema.optional(),
      invalidation: invalidationSchema.optional(),
      allowAlreadyMet: z.boolean().optional(),
    },
    async ({ thesisId, expectedRevision, title, context, nextStep, steps, invalidation, allowAlreadyMet }) => {
      try {
        const body = defined({
          expectedRevision, title, context, nextStep, allowAlreadyMet, source: 'mcp',
          steps: stepsWithSymbols(steps as { match: string; conditions: Json[] }[] | undefined), invalidation: withSymbols(invalidation as Json[] | undefined),
        });
        const data = await client.patch(`/theses/${encodeURIComponent(thesisId)}`, body) as Json;
        const t = data.thesis as Thesis | undefined;
        return ok(data, { summary: savedSummary(data, 'Revised:'), definitions: thesisDefinitions(t ? [t] : []), why: WHY });
      } catch (error) { return fail(error); }
    }
  );

  server.tool(
    'dwlf_review_thesis',
    `Record the user's answer to a thesis (usually a challenged one): keep (unchanged; clears the challenge), revise (a new revision: send expectedRevision and the fields to change, as dwlf_revise_thesis) or close (ends it, with an outcome). Record the user's own answer; do not choose it for them.`,
    {
      thesisId: z.string().describe('Thesis ID'),
      answer: z.enum(['keep', 'revise', 'close']),
      outcome: z.object({
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
    },
    async ({ thesisId, answer, outcome, expectedRevision, title, context, nextStep, steps, invalidation }) => {
      try {
        const body = defined({
          answer, outcome, expectedRevision, title, context, nextStep, source: 'mcp',
          steps: stepsWithSymbols(steps as { match: string; conditions: Json[] }[] | undefined), invalidation: withSymbols(invalidation as Json[] | undefined),
        });
        const data = await client.post(`/theses/${encodeURIComponent(thesisId)}/review`, body) as Json;
        const t = data.thesis as Thesis | undefined;
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
        const data = await client.post(`/theses/${encodeURIComponent(thesisId)}/archive`) as Json;
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
        return ok(data, { summary, definitions: { fireKind: pick(FIRE_KIND_DEFINITIONS, fires.map((f) => String(f.kind))) }, why: WHY });
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
