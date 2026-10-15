import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerMarketDataTools } from '../dist/tools/market-data.js';

// DWLF-435: dwlf_get_market_data sends the documented default of 50 when no limit is given.
const setup = () => {
  const calls = [];
  const handlers = {};
  const server = { tool: (name, _desc, _schema, fn) => { handlers[name] = fn; } };
  const client = { get: async (path, params) => { calls.push({ path, params }); return { candles: [] }; } };
  registerMarketDataTools(server, client);
  return { calls, call: (args) => handlers.dwlf_get_market_data(args) };
};

test('no limit sends 50 rather than leaving the API default of thousands', async () => {
  const { calls, call } = setup();
  await call({ symbol: 'btc/usd' });
  assert.deepEqual(calls, [{ path: '/market-data/BTC-USD', params: { timeframe: undefined, limit: 50 } }]);
});

test('an explicit limit is passed through', async () => {
  const { calls, call } = setup();
  await call({ symbol: 'XAU-USD', timeframe: 'weekly', limit: 520 });
  assert.deepEqual(calls[0].params, { timeframe: 'weekly', limit: 520 });
});
