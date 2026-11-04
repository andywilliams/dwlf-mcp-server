import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerConditionsTools } from '../dist/tools/conditions.js';

// DWLF-602: dwlf_get_btc_conditions is a pass-through to GET /v2/conditions/btc.
const setup = ({ fail } = {}) => {
  const calls = [];
  let handler;
  let description;
  let name;
  const server = { tool: (n, d, _schema, fn) => { name = n; description = d; handler = fn; } };
  const client = {
    get: async (path, params) => {
      calls.push({ path, params });
      if (fail) {throw new Error('HTTP 500');}
      return { kind: 'conditions' };
    },
  };
  registerConditionsTools(server, client);
  return { calls, call: (args) => handler(args), description: () => description, name: () => name };
};

test('no arguments: the default symbol and window, decided by the backend', async () => {
  const { calls, call, name } = setup();
  const res = await call({});
  assert.equal(name(), 'dwlf_get_conditions');
  assert.deepEqual(calls, [{ path: '/conditions/btc', params: {} }]);
  assert.equal(JSON.parse(res.content[0].text).kind, 'conditions');
});

test('symbol spellings reach the route in dash form; days passes through', async () => {
  const { calls, call } = setup();
  await call({ symbol: 'btc/usd', days: 30 });
  await call({ symbol: 'BTC' });
  await call({ asset: 'btc', symbol: 'BTCOC/USD' });
  assert.deepEqual(calls.map((c) => c.params), [{ symbol: 'BTC-USD', days: 30 }, { symbol: 'BTC-USD' }, { symbol: 'BTCOC-USD' }]);
});

test('a backend failure is a tool error, never an empty answer', async () => {
  const { call } = setup({ fail: true });
  const res = await call({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /HTTP 500/);
  assert.doesNotMatch(res.content[0].text, /not available on this DWLF API/);
});

test('an API without the route (404) says so, rather than reading as no data', async () => {
  const calls = [];
  let handler;
  registerConditionsTools({ tool: (_n, _d, _s, fn) => { handler = fn; } }, { get: async (p) => { calls.push(p); throw new Error('HTTP 404 — Cannot GET /v2/conditions/btc'); } });
  const res = await handler({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not available on this DWLF API yet/);
});

test('the description carries the framing and the reading rules agents must follow', () => {
  const { description } = setup();
  const d = description();
  assert.match(d, /CONDITIONS, NOT CALLS/);
  assert.match(d, /pending/);
  assert.match(d, /unavailable/);
  assert.match(d, /withheld/);
  assert.match(d, /unscored/);
  assert.match(d, /dwlf_get_intelligence/);
  assert.match(d, /responseVersion 1/);
});
