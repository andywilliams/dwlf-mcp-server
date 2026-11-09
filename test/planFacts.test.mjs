import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DWLFClient } from '../dist/client.js';

// DWLF-686: a plan refusal's facts must reach the agent (every tool reports error.message), so it can say which plan
// unlocks a locked family instead of guessing. Tested through the client, against a real HTTP 403.
const refusingWith = async (status, body, fn) => {
  const server = http.createServer((_req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const client = new DWLFClient({ baseURL: `http://127.0.0.1:${server.address().port}`, apiKey: 'k' });
    return await fn(client).then(() => assert.fail('expected a rejection'), (e) => e.message);
  } finally { server.close(); }
};
const SPT_FAMILY_REFUSAL = { success: false, error: 'PLAN_REQUIRED', entitlement: 'family', family: 'cycles', plan: 'free', requiredPlan: 'block',
  upgradeUrl: 'https://block.dwlf.co.uk/pricing', pricingUrl: 'https://block.dwlf.co.uk/pricing/', message: 'Your plan (Free) doesn\'t include Cycles.' };

test('★ a Block family refusal keeps its code, family, requiredPlan and pricingUrl in the tool-visible error', async () => {
  const msg = await refusingWith(403, SPT_FAMILY_REFUSAL, (c) => c.get('/stages/BTC-USD'));
  assert.equal(msg, 'HTTP 403 — Your plan (Free) doesn\'t include Cycles. [PLAN_REQUIRED; family=cycles; requiredPlan=block; pricingUrl=https://block.dwlf.co.uk/pricing/]');
});

test('the nested `{ error: { code, … } }` envelope carries the same facts', async () => {
  const msg = await refusingWith(403, { error: { code: 'PLAN_REQUIRED', message: 'Needs Block', family: 'levels', requiredPlan: 'block' } }, (c) => c.get('/x'));
  assert.equal(msg, 'HTTP 403 — Needs Block [PLAN_REQUIRED; family=levels; requiredPlan=block]');
});

test('an error with no plan facts is unchanged', async () => {
  assert.equal(await refusingWith(404, { error: 'NOT_FOUND', message: 'no such thing' }, (c) => c.get('/x')), 'HTTP 404 — no such thing');
});
