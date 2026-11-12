// DWLF-791/797/798: dwlf_get_divergences maps its arguments onto GET /v2/screener/divergences and passes the answer through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDivergenceTools, DEFAULT_LIMIT } from '../dist/tools/divergences.js';

const setup = (respond = async () => ({ responseVersion: 1, items: [] })) => {
  const calls = [];
  let handler;
  let description;
  const server = { tool: (_name, desc, _schema, fn) => { description = desc; handler = fn; } };
  const client = { get: async (path, params) => { calls.push({ path, params }); return respond(path, params); } };
  registerDivergenceTools(server, client);
  return { calls, call: (args) => handler(args), description };
};

test('no arguments: the limit is sent (not the API default of 100), nothing else', async () => {
  const { calls, call } = setup();
  await call({});
  assert.deepEqual(calls, [{ path: '/screener/divergences', params: { limit: String(DEFAULT_LIMIT) } }]);
});

test('every filter reaches the query; symbols in dash form, confluence de-duplicated', async () => {
  const { calls, call } = setup();
  await call({ days: 7, oscillator: 'dss', kind: 'regular', direction: 'bullish', symbols: ['btc/usd', 'aapl'], limit: 10,
    timeframe: 'all', confluence: ['cycle', 'smc', 'cycle'], confluenceDays: 5, minLayers: 2, includeRetired: true, explain: true });
  assert.deepEqual(calls[0].params, { limit: '10', days: '7', oscillator: 'dss', kind: 'regular', direction: 'bullish',
    symbols: 'BTC-USD,AAPL', timeframe: 'all', confluence: 'cycle,smc', confluenceDays: '5', minLayers: '2', includeRetired: 'true', explain: 'true' });
});

test('minLayers above the distinct layers requested (or without confluence) is a usage error, before any request', async () => {
  const { calls, call } = setup();
  assert.equal((await call({ minLayers: 2 })).isError, true);
  assert.equal((await call({ confluence: ['cycle', 'cycle'], minLayers: 2 })).isError, true);
  assert.deepEqual(calls, []);
  await call({ confluence: ['cycle', 'smc'], minLayers: 2 });
  assert.equal(calls[0].params.minLayers, '2');
});

test('the answer is passed through unchanged; a backend failure is a tool error, never an empty list', async () => {
  const body = { responseVersion: 2, items: [{ summary: 's', chartUrl: 'https://www.dwlf.co.uk/chart/x', confluence: { matched: 1 } }], definitions: { divergence: 'd' } };
  const ok = await setup(async () => body).call({ confluence: ['cycle'] });
  assert.deepEqual(JSON.parse(ok.content[0].text), body);
  const bad = await setup(async () => { throw new Error('HTTP 403 [PLAN_REQUIRED; family=cycles]'); }).call({});
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /PLAN_REQUIRED/);
});

test('the description frames events, not signals, and tells the agent to use summary, chartUrl and knowableAt', () => {
  const { description } = setup();
  for (const must of [/not signals/i, /summary/, /chartUrl/, /knowableAt/, /never present one/i, /\{ matched: false \}/]) {
    assert.match(description, must);
  }
});
