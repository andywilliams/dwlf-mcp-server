import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerConditionsTools } from '../dist/tools/conditions.js';

// DWLF-602: dwlf_get_conditions is a pass-through to GET /v2/conditions/{asset}.
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
  await call({ symbol: 'btcoc' });
  await call({ symbol: 'BTCOCUSD' });
  assert.deepEqual(calls.map((c) => c.params), [
    { symbol: 'BTC-USD', days: 30 }, { symbol: 'BTC-USD' }, { symbol: 'BTCOC-USD' }, { symbol: 'BTCOC-USD' }, { symbol: 'BTCOC-USD' },
  ]);
});

test('a symbol the route does not answer for is a usage error, before any fetch', async () => {
  const { calls, call } = setup();
  for (const symbol of ['ETH', 'AAPL', 'XAU/USD']) {
    const res = await call({ symbol });
    assert.equal(res.isError, true, symbol);
    assert.match(res.content[0].text, /^Usage: symbol must be BTC\/USD or BTCOC\/USD/);
  }
  assert.equal(calls.length, 0);
});

test('a backend failure is a tool error, never an empty answer', async () => {
  const { call } = setup({ fail: true });
  const res = await call({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /HTTP 500/);
  assert.doesNotMatch(res.content[0].text, /not available on this DWLF API/);
});

const httpError = (status, message) => Object.assign(new Error(message), {
  isAxiosError: true, response: { status, data: {} }, toJSON: () => ({}),
});
const failingWith = async (err) => {
  let handler;
  registerConditionsTools({ tool: (_n, _d, _s, fn) => { handler = fn; } }, { get: async () => { throw err; } });
  return handler({});
};

test('an API without the route (a 404 RESPONSE) says so, rather than reading as no data', async () => {
  const res = await failingWith(httpError(404, 'HTTP 404 — Cannot GET /v2/conditions/btc'));
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not available on this DWLF API yet/);
});

test('the hint keys on the status, not on "404" appearing in some other error\'s text', async () => {
  for (const err of [httpError(502, 'HTTP 502 — upstream returned 404'), new Error('socket hang up 404')]) {
    const res = await failingWith(err);
    assert.equal(res.isError, true);
    assert.doesNotMatch(res.content[0].text, /not available on this DWLF API/);
  }
});

test('the description carries the framing and the reading rules agents must follow', () => {
  const { description } = setup();
  const d = description();
  assert.match(d, /CONDITIONS, NOT CALLS/);
  assert.match(d, /pending/);
  assert.match(d, /unavailable/);
  assert.match(d, /withheld/);
  assert.match(d, /unscored/);
  assert.doesNotMatch(d, /dwlf_get_intelligence/, 'a Block tool never points to a tool the Block profile hides');
  assert.match(d, /responseVersion 3/);
  assert.match(d, /locked: true/);
});
