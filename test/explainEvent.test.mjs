import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError } from 'axios';
import { registerExplainEventTools } from '../dist/tools/explain-event.js';
import { ONCHAIN_CATALOGUE_AS_OF } from '../dist/data/onchainCatalogue.js';

// DWLF-646: dwlf_explain_event reads the definition from the API (bundled copy only as a fallback) and, for engine
// types, the occurrences route.
const httpError = (status, data) => {
  const e = new AxiosError(`HTTP ${status}`, 'ERR_BAD_REQUEST');
  e.response = { status, data, statusText: '', headers: {}, config: {} };
  return e;
};
const ENGINE_DEF = { type: 'onchain.sth_sopr.lose', inEngine: true, revision: { class: 'oracle' } };
const PACK_DEF = { type: 'onchain.fees.backlog.start', inEngine: false, revision: { class: 'estimated' } };
const setup = (routes) => {
  let handler;
  let name;
  let description;
  const calls = [];
  registerExplainEventTools({ tool: (n, d, _s, fn) => { name = n; description = d; handler = fn; } }, {
    get: async (path, params) => {
      calls.push({ path, params });
      const r = routes[path];
      if (r instanceof Error) {throw r;}
      if (r === undefined) {throw httpError(404, { message: 'Not found' });}
      return r;
    },
  });
  const call = async (args) => {
    const res = await handler(args);
    return { res, body: res.isError ? null : JSON.parse(res.content[0].text) };
  };
  return { call, calls, name: () => name, description: () => description };
};
const E = '/events/onchain.sth_sopr.lose/explain';

test('an engine type: the API definition, then its latest occurrences', async () => {
  const s = setup({ [E]: ENGINE_DEF, [`${E}/occurrences`]: { history: { count: 3 }, recent: [] } });
  const { body } = await s.call({ eventType: ' onchain.sth_sopr.lose ' });
  assert.equal(s.name(), 'dwlf_explain_event');
  assert.equal(body.definitionSource, 'api');
  assert.deepEqual(body.definition, ENGINE_DEF);
  assert.equal(body.occurrences.history.count, 3);
  assert.deepEqual(s.calls, [{ path: E, params: undefined }, { path: `${E}/occurrences`, params: {} }]);
});

test('date and since pass through to the occurrences route', async () => {
  const s = setup({ [E]: ENGINE_DEF, [`${E}/occurrences`]: { history: { count: 3 } } });
  await s.call({ eventType: 'onchain.sth_sopr.lose', date: '2026-10-15' });
  await s.call({ eventType: 'onchain.sth_sopr.lose', since: '2026-10-01' });
  assert.deepEqual(s.calls.filter((c) => c.path.endsWith('occurrences')).map((c) => c.params), [{ date: '2026-10-15' }, { since: '2026-10-01' }]);
});

test('a pack type: the definition, and no occurrence read (it is not in the engine)', async () => {
  const P = '/events/onchain.fees.backlog.start/explain';
  const s = setup({ [P]: PACK_DEF });
  const { body } = await s.call({ eventType: 'onchain.fees.backlog.start' });
  assert.match(body.occurrencesUnavailable, /not in the engine/);
  assert.equal(s.calls.length, 1);
});

test('a day with no occurrence is an answer naming the nearest days, not a failure', async () => {
  const s = setup({ [E]: ENGINE_DEF, [`${E}/occurrences`]: httpError(404, { message: 'no occurrence', nearest: { before: '2024-03-01', after: null } }) });
  const { res, body } = await s.call({ eventType: 'onchain.sth_sopr.lose', date: '2024-03-02' });
  assert.equal(res.isError, undefined);
  assert.equal(body.occurrences.occurrence, null);
  assert.deepEqual(body.occurrences.nearest, { before: '2024-03-01', after: null });
});

test('a failed occurrence read keeps the definition and says why, never an empty list', async () => {
  const s = setup({ [E]: ENGINE_DEF, [`${E}/occurrences`]: httpError(500, { message: 'boom' }) });
  const { body } = await s.call({ eventType: 'onchain.sth_sopr.lose', since: '2026-10-01' });
  assert.equal(body.definitionSource, 'api');
  assert.match(body.occurrencesUnavailable, /failed: HTTP 500/);
  assert.equal(body.occurrences, undefined);
});

test('an API without the route: the bundled definition, dated and labelled, and the error kept', async () => {
  const s = setup({ [E]: httpError(404, { message: 'Not found' }) });
  const { body } = await s.call({ eventType: 'onchain.sth_sopr.lose' });
  assert.equal(body.definitionSource, 'bundled');
  assert.equal(body.bundledAsOf, ONCHAIN_CATALOGUE_AS_OF);
  assert.equal(body.definition.id, 'onchain.sth_sopr.lose');
  assert.equal(body.definition.inEngine, null);
  assert.match(body.apiError, /HTTP 404/);
});

test('a type neither the API nor the package knows is a usage error; an unreachable API is a tool error', async () => {
  const unknown = await setup({}).call({ eventType: 'onchain.nope' });
  assert.equal(unknown.res.isError, true);
  assert.match(unknown.res.content[0].text, /^Usage: no on-chain event type "onchain.nope"/);
  const down = await setup({ '/events/onchain.nope/explain': new Error('ECONNREFUSED') }).call({ eventType: 'onchain.nope' });
  assert.equal(down.res.isError, true);
  assert.match(down.res.content[0].text, /^Error explaining onchain.nope: ECONNREFUSED/);
});

test('usage errors before any request: a non-onchain type, a bad date, both date and since', async () => {
  const s = setup({});
  for (const args of [{ eventType: 'rsi.exit.overbought' }, { eventType: 'onchain.cdd.spike', date: '15-10-2026' },
    { eventType: 'onchain.cdd.spike', since: 'yesterday' }, { eventType: 'onchain.cdd.spike', date: '2026-10-15', since: '2026-10-01' }]) {
    const { res } = await s.call(args);
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.match(res.content[0].text, /^Usage: /);
  }
  assert.equal(s.calls.length, 0);
});

test('the description frames conditions, not calls, and names the fallback and withheld-price rules', () => {
  const s = setup({});
  assert.match(s.description(), /CONDITIONS on the chain, not calls/);
  assert.match(s.description(), /definitionSource: "bundled"/);
  assert.match(s.description(), /priceWithheld/);
});
