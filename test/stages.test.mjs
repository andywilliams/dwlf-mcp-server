import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerStageTools } from '../dist/tools/stages.js';

// DWLF-382: dwlf_get_stage routes one symbol to /stages/{symbol} and many/a group to /stages, and refuses mixing.
const setup = () => {
  const calls = [];
  let handler;
  const server = { tool: (_name, _desc, _schema, fn) => { handler = fn; } };
  const client = { get: async (path, params) => { calls.push({ path, params }); return { ok: true }; } };
  registerStageTools(server, client);
  return { calls, call: (args) => handler(args) };
};

test('one symbol goes to the path form in dash spelling', async () => {
  const { calls, call } = setup();
  await call({ symbol: 'xau/usd' });
  assert.deepEqual(calls, [{ path: '/stages/XAU-USD', params: undefined }]);
});

test('several symbols or a group go to the list form', async () => {
  const { calls, call } = setup();
  await call({ symbols: ['BTC/USD', 'spy'] });
  await call({ group: 'metals' });
  assert.deepEqual(calls, [{ path: '/stages', params: { symbols: 'BTC-USD,SPY' } }, { path: '/stages', params: { group: 'metals' } }]);
});

test('mixing selectors is a usage error, not a guess and not a fetch failure', async () => {
  const { calls, call } = setup();
  const res = await call({ symbol: 'SPY', group: 'mag7' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^Usage:/);
  assert.equal(calls.length, 0);
});

test('a blank selector is a usage error, never a silent universe-wide call', async () => {
  const { calls, call } = setup();
  for (const args of [{ symbol: '  ' }, { symbols: [' ', 'spy'] }, { group: ' ' }]) {
    const res = await call(args);
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.match(res.content[0].text, /^Usage:/);
  }
  assert.equal(calls.length, 0);
});

test('no arguments asks for every staged symbol', async () => {
  const { calls, call } = setup();
  await call({});
  assert.deepEqual(calls, [{ path: '/stages', params: {} }]);
});
