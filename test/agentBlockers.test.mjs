// DWLF-685: what the block-agent-first eval found outside the site, on the MCP side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError } from 'axios';
import { nextStepFor, formatNextStep } from '../dist/errors.js';
import { registrationBody, disclaimerFromError, describeRegistration } from '../dist/tools/registration.js';
import { registerCustomEventTools } from '../dist/tools/custom-events.js';
import { registerExplainEventTools } from '../dist/tools/explain-event.js';
import { registerSemanticTools } from '../dist/tools/semantic.js';
import { searchText } from '../dist/tools/onchain-catalogue.js';
import { createCatalogueLoader, describeNodes } from '../dist/data/nodeCatalogue.js';
import { STRATEGY_NODES } from '../dist/data/strategyNodeMetadata.js';
import { PROFILE_INSTRUCTIONS } from '../dist/profiles.js';

// ---- every refusal says what to do next -------------------------------------------------------------------------

test('the API\'s own nextStep wins, and a known call is named as the MCP tool', () => {
  const step = nextStepFor(403, { error: 'ACCOUNT_NOT_ACTIVATED', nextStep: { action: 'Ask your user.', call: 'POST /v2/agent/resend-activation', url: 'https://x' } });
  const line = formatNextStep(step);
  assert.match(line, /^Next: Ask your user\./);
  assert.match(line, /Call: dwlf_register_agent \(same email/);
  assert.match(line, /Link: https:\/\/x/);
});

test('API Gateway\'s bare 401 gets a next step: register, or set DWLF_API_KEY', () => {
  const line = formatNextStep(nextStepFor(401, { message: 'Unauthorized' }));
  assert.match(line, /dwlf_register_agent/);
  assert.match(line, /DWLF_API_KEY/);
  assert.match(line, /Link: https:\/\//);
});

test('403 PLAN_REQUIRED names the plan and the upgrade link; scope_missing names the scope', () => {
  const plan = nextStepFor(403, { error: 'PLAN_REQUIRED', requiredPlan: 'pro', upgradeUrl: 'https://block.dwlf.co.uk/pricing' });
  assert.equal(plan.plan, 'pro');
  assert.match(formatNextStep(plan), /Plan: pro\. Link: https:\/\/block\.dwlf\.co\.uk\/pricing/);
  const scope = nextStepFor(403, { error: 'FORBIDDEN', reason: 'scope_missing', required_scope: 'settings:write' });
  assert.match(scope.action, /settings:write/);
});

test('429 without a nextStep (an older API): retry after N s, or the upgrade link', () => {
  const s = nextStepFor(429, { error: 'RATE_LIMIT_EXCEEDED', retryAfter: 42, upgradeUrl: 'https://u' });
  assert.equal(s.retryAfterSeconds, 42);
  assert.match(s.action, /after 42 s.*bigger plan/);
  assert.equal(nextStepFor(400, { error: 'bad' }), null, 'a 400 is not a refusal to advise on');
});

// ---- dwlf_register_agent ----------------------------------------------------------------------------------------

test('register body: acceptance only when the agent says the user accepted', () => {
  assert.deepEqual(registrationBody({ email: 'a@b.co' }, 'block'), { email: 'a@b.co', product: 'block' });
  assert.deepEqual(registrationBody({ email: 'a@b.co' }), { email: 'a@b.co' });
  assert.deepEqual(
    registrationBody({ email: 'a@b.co', disclaimerAccepted: true, disclaimerVersion: '1.3', agentId: 'x' }, 'block'),
    { email: 'a@b.co', product: 'block', disclaimerAccepted: true, disclaimerVersion: '1.3', agentId: 'x' },
  );
  assert.equal('disclaimerVersion' in registrationBody({ email: 'a@b.co', disclaimerAccepted: false, disclaimerVersion: '1.3' }), false);
});

const axios400 = (data) => {
  const e = new AxiosError('HTTP 400');
  e.response = { status: 400, data, headers: {}, statusText: '', config: {} };
  return e;
};

test('step 1: the API\'s disclaimer 400 becomes the text to show the user, and how to accept', () => {
  const text = disclaimerFromError(axios400({
    error: 'Disclaimer acceptance required', disclaimer: { version: '1.3', title: 'Terms', content: 'Not advice.' },
  }));
  assert.match(text, /must accept the DWLF disclaimer/);
  assert.match(text, /disclaimerVersion: "1\.3"/);
  assert.match(text, /do not accept on their behalf/);
  assert.match(text, /Not advice\./);
  assert.equal(disclaimerFromError(axios400({ error: 'Invalid email format' })), null);
  assert.equal(disclaimerFromError(new Error('x')), null);
});

test('the register answer ends with what to do next', () => {
  assert.match(describeRegistration({ apiKey: 'k', nextStep: { action: 'Save it.', call: 'GET /v2/me' } }), /Next: Save it\. Call: dwlf_get_quotas\./);
  assert.match(describeRegistration({ apiKey: 'k' }), /activation link/);
  assert.match(describeRegistration({ activationStatus: 'pending_activation' }), /No new key/);
});

// ---- output sizes -----------------------------------------------------------------------------------------------

// A fake server that keeps every tool's handler, and a client that records each call.
const toolsOf = (register, routes = {}, options) => {
  const tools = {};
  const calls = [];
  const record = (method) => async (path, params) => {
    calls.push({ method, path, params });
    const r = typeof routes[path] === 'function' ? routes[path](params) : routes[path];
    if (r instanceof Error) throw r;
    return r ?? {};
  };
  register({ tool: (n, _d, _s, fn) => { tools[n] = fn; } }, { get: record('get'), post: record('post') }, options);
  return { tools, calls };
};

test('custom events: the API\'s summary view by default, the full list only when asked', async () => {
  const { tools, calls } = toolsOf(registerCustomEventTools);
  await tools.dwlf_list_custom_events({});
  assert.equal(calls[0].params.view, 'summary');
  await tools.dwlf_list_custom_events({ detail: true, limit: 5 });
  assert.equal(calls[1].params.view, undefined);
  assert.equal(calls[1].params.limit, 5);
});

test('explain since asks the API for 10 rows per bucket unless told otherwise', async () => {
  const E = '/events/onchain.sth_sopr.lose/explain';
  const routes = { [E]: { type: 'onchain.sth_sopr.lose', inEngine: true }, [`${E}/occurrences`]: { changedSince: {} } };
  const { tools, calls } = toolsOf(registerExplainEventTools, routes);
  await tools.dwlf_explain_event({ eventType: 'onchain.sth_sopr.lose', since: '2026-10-01' });
  assert.deepEqual(calls.at(-1).params, { since: '2026-10-01', rows: '10' });
  await tools.dwlf_explain_event({ eventType: 'onchain.sth_sopr.lose', since: '2026-10-01', rows: 50 });
  assert.equal(calls.at(-1).params.rows, '50');
  await tools.dwlf_explain_event({ eventType: 'onchain.sth_sopr.lose' });
  assert.equal(calls.at(-1).params.rows, undefined, 'rows only with since');
});

test('register signs up for the server\'s profile when the agent does not say', async () => {
  const block = toolsOf(registerSemanticTools, {}, { defaultProduct: 'block' });
  await block.tools.dwlf_register_agent({ email: 'a@b.co' });
  assert.equal(block.calls.at(-1).params.product, 'block');
  const full = toolsOf(registerSemanticTools, {}, { defaultProduct: 'dwlf' });
  await full.tools.dwlf_register_agent({ email: 'a@b.co' });
  assert.equal('product' in full.calls.at(-1).params, false, 'full profile: a classic account unless asked');
  await full.tools.dwlf_register_agent({ email: 'a@b.co', product: 'block' });
  assert.equal(full.calls.at(-1).params.product, 'block');
});

test('a hosted server\'s 401 says reconnect, not DWLF_API_KEY', () => {
  const s = nextStepFor(401, { message: 'Unauthorized' }, 'hosted');
  assert.match(s.action, /reconnect DWLF/);
  assert.doesNotMatch(s.action, /DWLF_API_KEY/);
});

const catalogueBody = {
  nodeTypes: [
    { id: 'onchain.sth_sopr.lose', label: '7d STH-SOPR loses 1', category: 'onchain', description: 'd', timeframes: ['daily'], parameters: [] },
    { id: 'cycle.low.confirmed', label: 'Cycle Low', category: 'cycles', description: 'c', timeframes: ['weekly'], parameters: [] },
  ],
  unsupported: [],
};

test('category condition lists by name; catalogueCategory gives one family in full', async () => {
  const catalogue = await createCatalogueLoader(async () => catalogueBody)(0);
  const brief = describeNodes({ local: STRATEGY_NODES, catalogue, category: 'condition' }).result;
  const sopr = brief.nodes.find((n) => n.nodeType === 'onchain.sth_sopr.lose');
  assert.equal(sopr.description, undefined, 'brief');
  assert.match(brief.detail, /catalogueCategory \(one of: .*onchain/);
  const full = describeNodes({ local: STRATEGY_NODES, catalogue, category: 'condition', catalogueCategory: 'onchain' }).result;
  assert.deepEqual(full.nodes.map((n) => n.nodeType), ['onchain.sth_sopr.lose']);
  assert.equal(full.nodes[0].description, 'd');
});

test('a pack (catalogue-only) on-chain type is not "Unknown nodeType": it says where it is described', async () => {
  const catalogue = await createCatalogueLoader(async () => catalogueBody)(0);
  const { error } = describeNodes({ local: STRATEGY_NODES, catalogue, nodeType: 'onchain.fees.backlog.enter' });
  assert.match(error.error, /not a node the engine can evaluate/);
  assert.match(error.hint, /dwlf_explain_event/);
  assert.match(error.hint, /catalogueCategory: "onchain"/);
  assert.match(describeNodes({ local: STRATEGY_NODES, catalogue, nodeType: 'made.up' }).error.error, /Unknown nodeType/);
});

// ---- search and instructions ------------------------------------------------------------------------------------

test('describe search finds STH types by the words people use', () => {
  const has = (id, q) => q.toLowerCase().split(/\s+/).every((w) => searchText(id, '').includes(w));
  assert.ok(has('onchain.sth_sopr.lose', 'short-term holder'));
  assert.ok(has('onchain.sth_sopr.lose', 'capitulation'));
  assert.ok(has('onchain.sth_realised_price.cross.below', 'STH cost basis'));
  assert.ok(!has('onchain.lth_realised_price.cross.below', 'short-term holder'));
});

test('the Block profile instructions carry the account and key facts in one place', () => {
  const s = PROFILE_INSTRUCTIONS.block;
  for (const want of [/dwlf_register_agent/, /DWLF_API_KEY/, /activation link/, /when an event is confirmed/, /"Next:"/]) {
    assert.match(s, want);
  }
  assert.doesNotMatch(s, /real[- ]time/i);
});
