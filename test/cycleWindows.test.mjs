import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerCycleWindowTools } from '../dist/tools/cycle-windows.js';

// DWLF-416: dwlf_get_cycle_windows asks for each window's derived price zone only when `depth` is set.
const setup = () => {
  const calls = [];
  let handler;
  const server = { tool: (_name, _desc, _schema, fn) => { handler = fn; } };
  const client = { get: async (path, params) => { calls.push({ path, params }); return { ok: true }; } };
  registerCycleWindowTools(server, client);
  return { calls, call: (args) => handler(args) };
};

test('depth: true adds depth=1; without it the request is unchanged', async () => {
  const { calls, call } = setup();
  await call({ symbol: 'aapl', depth: true });
  await call({ symbol: 'aapl', history: 2 });
  assert.deepEqual(calls, [
    { path: '/cycles/windows', params: { symbol: 'AAPL', timeframe: '1w', depth: '1' } },
    { path: '/cycles/windows', params: { symbol: 'AAPL', timeframe: '1w', history: '2' } },
  ]);
});
