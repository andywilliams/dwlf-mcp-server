// The Block profile's backend switch (DWLF-876, docs/design/block-repoint.md D1/D3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolveBlockBackend, BLOCK_API_TOOLS, BLOCK_TOOLS } from '../dist/profiles.js';
import { BlockApiClient, BlockApiError } from '../dist/block/client.js';

test('the backend is spt by default; block-api by flag or env; an unknown value or a non-block profile is refused', () => {
  assert.equal(resolveBlockBackend([], {}, 'block'), 'spt');
  assert.equal(resolveBlockBackend(['--block-backend', 'block-api'], {}, 'block'), 'block-api');
  assert.equal(resolveBlockBackend(['--block-backend=BLOCK-API'], {}, 'block'), 'block-api');
  assert.equal(resolveBlockBackend([], { DWLF_BLOCK_BACKEND: 'block-api' }, 'block'), 'block-api');
  assert.equal(resolveBlockBackend(['--block-backend', 'spt'], { DWLF_BLOCK_BACKEND: 'block-api' }, 'block'), 'spt', 'the flag wins');
  assert.equal(resolveBlockBackend([], { DWLF_BLOCK_BACKEND: '' }, 'block'), 'spt', 'an empty env var is unset');
  assert.throws(() => resolveBlockBackend(['--block-backend', 'sptt'], {}, 'block'), /Unknown Block backend/);
  assert.throws(() => resolveBlockBackend(['--block-backend'], {}, 'block'), /needs a value/);
  assert.throws(() => resolveBlockBackend([], { DWLF_BLOCK_BACKEND: 'block-api' }, 'full'), /--profile block only/);
});

test('block-api offers only launch-set tools: every one but the new series tool exists on spt too', () => {
  assert.deepEqual([...BLOCK_API_TOOLS].filter((t) => !BLOCK_TOOLS.has(t)), ['dwlf_get_series']);
});

/** A local stand-in for the Block API that records what it was asked. */
const upstream = async (status, body) => {
  const seen = [];
  const server = createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization }); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
};

test('BlockApiClient: no key → /public/v1 with no Authorization; a key → /v1 with Bearer; undefined params dropped', async () => {
  const api = await upstream(200, { summary: 'ok' });
  try {
    await new BlockApiClient({ baseURL: api.url, apiKey: undefined }).get('/events', { types: 'a,b', from: undefined });
    await new BlockApiClient({ baseURL: `${api.url}/`, apiKey: 'dwlfk_test' }).get('/conditions');
    assert.deepEqual(api.seen, [{ url: '/public/v1/events?types=a,b', auth: undefined }, { url: '/v1/conditions', auth: 'Bearer dwlfk_test' }]);
  } finally { await api.close(); }
});

test('BlockApiClient: the Block API\'s error body is kept whole in the error the tool returns', async () => {
  const body = { error: 'PLAN_REQUIRED', requiredPlan: 'block', pricingUrl: 'https://block.dwlf.co.uk/pricing/' };
  const api = await upstream(403, body);
  try {
    await assert.rejects(new BlockApiClient({ baseURL: api.url, apiKey: undefined }).get('/series/x'), (e) => e instanceof BlockApiError && e.status === 403
      && e.message.includes('PLAN_REQUIRED') && e.message.includes('pricingUrl'));
  } finally { await api.close(); }
});

test('BlockApiClient: an unreachable API is an error with no status, not a hang or a crash', async () => {
  await assert.rejects(new BlockApiClient({ baseURL: 'http://127.0.0.1:9', apiKey: undefined, timeoutMs: 2000 }).get('/conditions'),
    (e) => e instanceof BlockApiError && e.status === null && /unreachable/.test(e.message));
});

test('registerForProfile refuses the block-api backend on any profile but block', async () => {
  const { registerForProfile } = await import('../dist/register.js');
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  assert.throws(() => registerForProfile(new McpServer({ name: 't', version: '0' }), 'full', 'block-api'), /--profile block only/);
});
