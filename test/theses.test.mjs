import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerThesisTools } from '../dist/tools/theses.js';
import { registerAll } from '../dist/register.js';
import { BLOCK_TOOLS } from '../dist/profiles.js';

// DWLF-855: thesis alerts ("Waiting for"). The tools translate to SPT /v2/theses and add `agentHints` only.
const setup = (reply = () => ({})) => {
  const calls = [];
  const tools = new Map();
  const server = { tool: (name, desc, schema, fn) => { tools.set(name, { desc, schema, fn }); } };
  const record = (method) => async (path, a) => { calls.push({ method, path, a }); return reply(method, path, a); };
  const client = { get: record('get'), post: record('post'), patch: record('patch'), delete: record('delete') };
  registerThesisTools(server, client);
  const call = async (name, args = {}) => {
    const res = await tools.get(name).fn(args);
    return { res, body: res.isError ? null : JSON.parse(res.content[0].text) };
  };
  return { calls, tools, call };
};

const thesis = (over = {}) => ({
  thesisId: 't1', symbol: 'AMZN', title: 'Next DCL above 220', status: 'challenged', currentStep: 1,
  steps: [{ match: 'any', conditions: [{ id: 'c1', type: 'pivot_confirmed', state: { status: 'missed' } }] }],
  invalidation: [], liveness: { note: 'Last evaluated against the bar of 2026-11-16' }, ...over,
});

test('create: symbols normalised at thesis and condition level, source mcp, undefined fields dropped', async () => {
  const { calls, call } = setup(() => ({ thesis: thesis({ status: 'waiting' }), checks: [], delivery: { channel: 'telegram' } }));
  await call('dwlf_create_thesis', {
    symbol: 'btc/usd', title: 'x',
    steps: [{ match: 'any', conditions: [{ type: 'close_vs_level', symbol: 'qqq', basis: 'daily_close', op: 'above', value: 1 }] }],
  });
  assert.equal(calls[0].path, '/theses');
  assert.deepEqual(calls[0].a, {
    symbol: 'BTC-USD', title: 'x', source: 'mcp',
    steps: [{ match: 'any', conditions: [{ type: 'close_vs_level', symbol: 'QQQ', basis: 'daily_close', op: 'above', value: 1 }] }],
  });
});

test('★ dryRun goes to ?dryRun=true and says nothing was saved; the backend body is passed through whole', async () => {
  const backend = { thesis: null, checks: [{ conditionId: 'c1', restatement: 'r', canOccur: true }] };
  const { calls, call } = setup(() => backend);
  const { body } = await call('dwlf_create_thesis', { symbol: 'AMZN', title: 'x', steps: [], dryRun: true });
  assert.equal(calls[0].path, '/theses?dryRun=true');
  assert.equal('dryRun' in calls[0].a, false);
  const { agentHints, ...rest } = body;
  assert.deepEqual(rest, backend);
  assert.match(agentHints.summary, /nothing was saved/);
});

test('★ a 422 refusal keeps the backend body (the checks say why); THESES_DISABLED says the switch is off', async () => {
  const axiosError = (status, data) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
  let error = axiosError(422, { error: 'CANNOT_OCCUR', message: 'no', checks: [{ conditionId: 'c1', canOccur: false, reason: 'not a symbol with cycles' }] });
  const { tools } = setup(() => { throw error; });
  const create = tools.get('dwlf_create_thesis').fn;
  let res = await create({ symbol: 'AMZN', title: 'x', steps: [] });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not a symbol with cycles/);
  error = axiosError(404, { error: 'THESES_DISABLED' });
  res = await create({ symbol: 'AMZN', title: 'x', steps: [] });
  assert.match(res.content[0].text, /not switched on/);
});

test('list: summary counts statuses; definitions cover only the statuses and condition states present', async () => {
  const { calls, call } = setup(() => ({ theses: [thesis(), thesis({ thesisId: 't2', status: 'waiting', steps: [] })], count: 2 }));
  const { body } = await call('dwlf_list_theses', { symbol: 'xau/usd' });
  assert.deepEqual(calls[0].a, { status: undefined, symbol: 'XAU-USD', group: undefined, include: undefined });
  assert.equal(body.agentHints.summary, '2 theses: 1 challenged, 1 waiting.');
  assert.deepEqual(Object.keys(body.agentHints.definitions.status).sort(), ['challenged', 'waiting']);
  assert.deepEqual(Object.keys(body.agentHints.definitions.conditionState), ['missed']);
  assert.match(body.agentHints.why, /does not say what to do/);
});

test('★ includeProgress asks SPT for progress and names the closest few in SPT\'s order and words (DWLF-884)', async () => {
  const p = (rank, short) => ({ current: [], invalidation: [], nearestPct: null, closest: { kind: 'x', rank, short } });
  const { calls, call } = setup(() => ({ theses: [
    thesis({ thesisId: 'a', symbol: 'GDX', status: 'waiting', progress: p([2, 10], 'window in 10d') }),
    thesis({ thesisId: 'b', symbol: 'WULF', status: 'waiting', progress: p([0, 16.06], '16.06% to a level') }),
    thesis({ thesisId: 'c', symbol: 'SMCI', status: 'waiting', progress: p([1, -33], 'pivot provisional 33%') }),
    thesis({ thesisId: 'd', symbol: 'CAT', status: 'waiting', progress: p([3, 0], null) }),
  ], count: 4 }));
  const { body } = await call('dwlf_list_theses', { includeProgress: true });
  assert.equal(calls[0].a.include, 'progress');
  assert.equal(body.agentHints.summary, '4 theses: 4 waiting. Closest to trigger: WULF (16.06% to a level), SMCI (pivot provisional 33%), GDX (window in 10d).');
  assert.equal(body.theses[1].progress.closest.short, '16.06% to a level', 'SPT\'s body passes through whole');
});

test('includeProgress: ties go to the second rank element; a malformed closest is left out of the line, never an error', async () => {
  const p = (rank, short = 'x') => ({ current: [], invalidation: [], closest: { kind: 'x', rank, short } });
  const { call } = setup(() => ({ theses: [
    thesis({ thesisId: 'a', symbol: 'FAR', status: 'waiting', progress: p([0, 9], '9% to a level') }),
    thesis({ thesisId: 'b', symbol: 'NEAR', status: 'waiting', progress: p([0, 2], '2% to a level') }),
    thesis({ thesisId: 'c', symbol: 'BAD', status: 'waiting', progress: p(null, 'odd') }),
    thesis({ thesisId: 'd', symbol: 'NAN', status: 'waiting', progress: p(['x', 1], 'odd') }),
  ], count: 4 }));
  const { res, body } = await call('dwlf_list_theses', { includeProgress: true });
  assert.equal(res.isError, undefined);
  assert.match(body.agentHints.summary, /Closest to trigger: NEAR \(2% to a level\), FAR \(9% to a level\)\.$/);
});

test('get / revise / review / mark / archive / delete reach their routes, ids encoded', async () => {
  const { calls, call } = setup(() => ({ thesis: thesis() }));
  await call('dwlf_get_thesis', { thesisId: 'a/b' });
  await call('dwlf_revise_thesis', { thesisId: 't1', expectedRevision: 2, title: 'y' });
  await call('dwlf_review_thesis', { thesisId: 't1', answer: 'close', outcome: { kind: 'not_acted' } });
  await call('dwlf_review_thesis', { thesisId: 't1', answer: 'revise', expectedRevision: 2, allowAlreadyMet: true, nextStep: 'z' });
  await call('dwlf_mark_thesis_condition_met', { thesisId: 't1', conditionId: 'm1' });
  await call('dwlf_archive_thesis', { thesisId: 't1' });
  await call('dwlf_delete_thesis', { thesisId: 't1' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'get /theses/a%2Fb', 'patch /theses/t1', 'post /theses/t1/review', 'post /theses/t1/review', 'post /theses/t1/mark-met', 'post /theses/t1/archive', 'delete /theses/t1',
  ]);
  assert.deepEqual(calls[1].a, { expectedRevision: 2, title: 'y', source: 'mcp' });
  assert.deepEqual(calls[2].a, { answer: 'close', outcome: { kind: 'not_acted' }, source: 'mcp' });
  assert.deepEqual(calls[3].a, { answer: 'revise', expectedRevision: 2, nextStep: 'z', allowAlreadyMet: true, source: 'mcp' });
  assert.deepEqual(calls[5].a, {});
});

test('get: agentHints from the thesis and its fires; a body without a thesis still reaches the agent', async () => {
  let reply = { thesis: thesis({ fires: [{ kind: 'condition_missed' }] }) };
  const { call } = setup(() => reply);
  let { body } = await call('dwlf_get_thesis', { thesisId: 't1' });
  assert.match(body.agentHints.summary, /^AMZN "Next DCL above 220" \(t1\): challenged\./);
  assert.deepEqual(Object.keys(body.agentHints.definitions.fireKind), ['condition_missed']);
  reply = { thesis: null };
  ({ body } = await call('dwlf_get_thesis', { thesisId: 't1' }));
  assert.equal(body.thesis, null);
});

test('fires: cursor passed through; summary counts kinds and unacknowledged loud fires', async () => {
  const fires = [{ kind: 'step_met', loud: true, acknowledgedAt: null }, { kind: 'invalidation_hit', loud: true, acknowledgedAt: '2026-11-17' }];
  const { calls, call } = setup(() => ({ fires, cursor: 'c2' }));
  const { body } = await call('dwlf_list_thesis_fires', { cursor: 'c1' });
  assert.deepEqual(calls[0].a, { cursor: 'c1', limit: undefined });
  assert.equal(body.cursor, 'c2');
  assert.match(body.agentHints.summary, /^2 fire\(s\): 1 step_met, 1 invalidation_hit; 1 not yet acknowledged/);
  assert.deepEqual(Object.keys(body.agentHints.definitions.fireKind), ['step_met', 'invalidation_hit']);
});

test('★ the wording describes events, never advises (the SPT digest\'s word list)', async () => {
  const ADVICE = /\b(buy|sell|entry|enter|exit|stop|target|risk|reward|should|recommend|opportunity)\b/i;
  const { tools, call } = setup((m, path) => (path === '/theses/fires'
    ? { fires: ['step_met', 'condition_missed', 'invalidation_hit', 'source_failed'].map((kind) => ({ kind })) }
    : { theses: ['waiting', 'in_progress', 'complete', 'challenged', 'archived', 'closed'].map((status) => thesis({ status })) }));
  const texts = [...tools.values()].map((t) => t.desc);
  texts.push(JSON.stringify((await call('dwlf_list_theses')).body.agentHints));
  texts.push(JSON.stringify((await call('dwlf_list_thesis_fires')).body.agentHints));
  for (const t of texts) { assert.doesNotMatch(t, ADVICE, t.slice(0, 120)); }
});

test('registered in the full server, and not in the Block profile', () => {
  const names = [];
  registerAll({ tool: (name) => names.push(name), resource: () => {} }, {});
  const theses = names.filter((n) => /thes/.test(n));
  assert.equal(theses.length, 12);
  assert.deepEqual(theses.filter((n) => BLOCK_TOOLS.has(n)), []);
});

test('★ drift is visible, not lossy: an unknown status is named; a newer field or condition type reaches SPT unchanged', async () => {
  const { z } = await import('zod');
  const { tools, call } = setup(() => ({ theses: [thesis({ status: 'paused' })] }));
  const { body } = await call('dwlf_list_theses');
  assert.match(body.agentHints.definitions.status.paused, /Not described by this version/);
  const shape = z.object(tools.get('dwlf_revise_thesis').schema);
  const parsed = shape.parse({
    thesisId: 't1', expectedRevision: 1,
    steps: [{ conditions: [
      { id: 'c1', type: 'pivot_confirmed', timeframe: 'daily', side: 'low', confirmBars: 3, level: { op: 'inside', low: 1, high: 2, tolerancePct: 0.5 } },
      { type: 'volume_spike', multiple: 2 },
    ], weight: 1 }],
  });
  assert.equal(parsed.steps[0].weight, 1);
  assert.deepEqual(parsed.steps[0].conditions, [
    { id: 'c1', type: 'pivot_confirmed', timeframe: 'daily', side: 'low', confirmBars: 3, level: { op: 'inside', low: 1, high: 2, tolerancePct: 0.5 } },
    { type: 'volume_spike', multiple: 2 },
  ]);
  assert.equal(parsed.steps[0].match, 'any');
});

test('★ dwlf_thesis_guide: what, benefits, limits, rules, workflow, glossary and three worked examples that parse as dwlf_create_thesis input; no advice words anywhere (DWLF-891)', async () => {
  const { z } = await import('zod');
  const { tools, call } = setup();
  const { body } = await call('dwlf_thesis_guide');
  const g = body.guide;
  assert.ok(g.what && g.benefits.length >= 5 && g.limits.length >= 3 && g.rules.length >= 5 && g.workflow.length >= 4);
  assert.match(g.limits.join(' '), /End of day/);
  assert.match(g.limits.join(' '), /Information, not advice/);
  assert.match(g.rules.join(' '), /cycle\.low\.break/);
  assert.match(g.statuses.challenged, /review/);
  assert.equal(g.examples.length, 3);
  const create = z.object(tools.get('dwlf_create_thesis').schema).strict();
  const TYPES = ['pivot_confirmed', 'close_vs_level', 'window_opens', 'trendline_break', 'engine_event', 'manual'];
  for (const ex of g.examples) {
    const parsed = create.safeParse(ex.create);
    assert.ok(parsed.success, `${ex.create.symbol}: ${JSON.stringify(parsed.error?.issues)}`);
    for (const c of [...ex.create.steps.flatMap((st) => st.conditions), ...ex.create.invalidation]) {
      assert.ok(TYPES.includes(c.type), c.type);
      assert.ok(c.label, 'every example condition has a label saying what is checked');
    }
  }
  // Everything, the payloads agents copy included. ("Not advice" needs no exclusion: 'advice' is not in the list.)
  const ADVICE = /\b(buy|sell|entry|enter|exit|stop|target|risk|reward|should|recommend|opportunity)\b/i;
  assert.doesNotMatch(JSON.stringify(g), ADVICE);
  assert.match(tools.get('dwlf_create_thesis').desc, /dwlf_thesis_guide/);
});

test('the recorded thesis eval answer still passes its checker (eval/theses, DWLF-891)', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('node', ['eval/theses/check.mjs', 'eval/theses/answer-2026-11-20.json'], { encoding: 'utf8' });
  assert.match(out, /^PASS/);
});

test('the eval checker fails a wrong answer: a close below a low that does not exist, a forecast, no limits (eval/theses)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const good = JSON.parse(readFileSync('eval/theses/answer-2026-11-20.json', 'utf8'));
  const bad = {
    payload: { ...good.payload, invalidation: [{ type: 'close_vs_level', basis: 'daily_close', op: 'below', value: 1, label: 'Close below the new low' }] },
    explanation: 'DWLF watches NVDA in real time. The price will rise after the low; a good entry.',
  };
  const file = `${mkdtempSync(`${tmpdir()}/thesis-eval-`)}/bad.json`;
  writeFileSync(file, JSON.stringify(bad));
  let out = '';
  try { execFileSync('node', ['eval/theses/check.mjs', file], { encoding: 'utf8' }); } catch (e) { out = e.stdout; }
  for (const what of ['invalidation: weekly cycle.low.break', 'not intraday', 'information, not advice', 'no forecast', 'checked once a night']) {
    assert.ok(out.includes(what), `${what} reported: ${out}`);
  }
});
