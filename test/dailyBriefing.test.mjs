import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSemanticTools } from '../dist/tools/semantic.js';

// DWLF-416: dwlf_get_daily_briefing asks for the weekly depth readings only when `depth` is set.
test('daily briefing: depth: true adds depth=1; without it the request is unchanged', async () => {
  const calls = [];
  const handlers = {};
  const server = { tool: (name, _desc, _schema, fn) => { handlers[name] = fn; } };
  const client = { get: async (path, params) => { calls.push({ path, params }); return {}; } };
  registerSemanticTools(server, client);
  await handlers.dwlf_get_daily_briefing({ depth: true });
  await handlers.dwlf_get_daily_briefing({});
  await handlers.dwlf_get_daily_briefing({ depth: false, view: 'summary' });
  assert.deepEqual(calls, [
    { path: '/briefing/daily', params: { view: 'overview', depth: '1' } },
    { path: '/briefing/daily', params: { view: 'overview' } },
    { path: '/briefing/daily', params: { view: 'summary' } },
  ]);
});
