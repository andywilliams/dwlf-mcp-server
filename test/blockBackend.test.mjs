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
  const body = { error: 'PLAN_REQUIRED', requiredPlan: 'block', upgradeUrl: 'https://block.dwlf.co.uk/pricing', pricingUrl: 'https://api.block.dwlf.co.uk/public/v1/pricing' };
  const api = await upstream(403, body);
  try {
    await assert.rejects(new BlockApiClient({ baseURL: api.url, apiKey: undefined }).get('/series/x'), (e) => e instanceof BlockApiError && e.status === 403
      && e.message.includes('PLAN_REQUIRED') && e.message.includes(body.upgradeUrl) && e.message.includes(body.pricingUrl));
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

test('dwlf_explain_event on block-api: an events read that fails still answers with the definition and says why', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const catalogue = { responseVersion: 1, summary: 'c', items: [{ id: 'onchain.x', kind: 'eventType', family: 'cost-basis' }], definitions: { 'onchain.x': 'd' }, pricingUrl: 'p' };
  const server = createServer((req, res) => {
    if (req.url.startsWith('/public/v1/catalogue')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(catalogue)); return; }
    res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'UNAVAILABLE' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const mcp = new Client({ name: 't', version: '0' });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
      env: { PATH: process.env.PATH || '', DWLF_BLOCK_BACKEND: 'block-api', BLOCK_API_URL: `http://127.0.0.1:${server.address().port}` }, stderr: 'ignore' }));
    const r = await mcp.callTool({ name: 'dwlf_explain_event', arguments: { eventType: 'onchain.x' } });
    assert.notEqual(r.isError, true);
    const out = JSON.parse(r.content[0].text);
    assert.deepEqual(out.items, catalogue.items);
    assert.equal(out.occurrences, undefined);
    assert.match(out.occurrencesUnavailable, /Block API 503: .*UNAVAILABLE/);
  } finally { await mcp.close().catch(() => {}); await new Promise((r) => server.close(r)); }
});

test('the catalogue is read once per 15 minutes, and a failed read is not kept', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const catalogue = { responseVersion: 1, summary: 'c', items: [{ id: 'onchain.x', kind: 'eventType', family: 'cost-basis', name: 'X' }], definitions: { 'onchain.x': 'hash ribbon' }, pricingUrl: 'p' };
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    const ok = hits !== 1; // the first catalogue read fails
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify(ok ? catalogue : { error: 'DOWN' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const mcp = new Client({ name: 't', version: '0' });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
      env: { PATH: process.env.PATH || '', DWLF_BLOCK_BACKEND: 'block-api', BLOCK_API_URL: `http://127.0.0.1:${server.address().port}` }, stderr: 'ignore' }));
    const call = (args) => mcp.callTool({ name: 'dwlf_describe_onchain_events', arguments: args });
    assert.equal((await call({ family: 'cost-basis' })).isError, true, 'the failed read is the answer');
    assert.notEqual((await call({ family: 'cost-basis' })).isError, true, 'and is not kept: the next call reads again');
    const found = await call({ search: 'hash ribbon' });
    assert.deepEqual(JSON.parse(found.content[0].text).items.map((i) => i.id), ['onchain.x'], 'search reads the definition');
    assert.equal(hits, 2, 'the good read is kept: the third call made no request');
    const none = await call({ family: 'nope' });
    assert.equal(none.isError, true);
    assert.match(none.content[0].text, /Families: cost-basis/);
  } finally { await mcp.close().catch(() => {}); await new Promise((r) => server.close(r)); }
});

test('describe caps an answer at 40 whole items and says how many matched', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const items = Array.from({ length: 45 }, (_, i) => ({ id: `onchain.t${i}`, kind: 'eventType', family: 'mining', name: `T${i}` }));
  const catalogue = { responseVersion: 1, summary: 'c', items, definitions: Object.fromEntries(items.map((i) => [i.id, 'price'])), pricingUrl: 'p' };
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(catalogue)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const mcp = new Client({ name: 't', version: '0' });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
      env: { PATH: process.env.PATH || '', DWLF_BLOCK_BACKEND: 'block-api', BLOCK_API_URL: `http://127.0.0.1:${server.address().port}` }, stderr: 'ignore' }));
    const out = JSON.parse((await mcp.callTool({ name: 'dwlf_describe_onchain_events', arguments: { search: 'price' } })).content[0].text);
    assert.equal(out.items.length, 40);
    assert.equal(out.matched, 45);
    assert.equal(out.shown, 40);
    assert.equal(Object.keys(out.definitions).length, 40, 'definitions follow the items shown');
  } finally { await mcp.close().catch(() => {}); await new Promise((r) => server.close(r)); }
});
