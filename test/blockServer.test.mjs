// The library entry for a per-request host: `@dwlf/mcp-server/block` (DWLF-622, docs/design/hosted-auth.md step 2a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as entry from '@dwlf/mcp-server/block';
import { registerForProfile } from '../dist/register.js';
import { BLOCK_API_TOOLS, BLOCK_API_INSTRUCTIONS } from '../dist/profiles.js';

const { createBlockServer } = entry;

/** A local stand-in for the Block API: `route(url)` gives `[status, body, contentType?]`; every request is recorded. */
const upstream = async (route) => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    const [status, body, type = 'application/json'] = route(req.url);
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
};

const connect = async (server) => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
};

test('the package exports `./block`, and `.` still names the stdio entry', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['.'], './dist/index.js');
  assert.equal(pkg.main, './dist/index.js'.slice(2));
  assert.equal(pkg.exports['./block'].default, './dist/block/server.js');
  assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './block', './package.json'], 'internals are not importable');
  assert.deepEqual(pkg.files, ['dist', 'README.md', 'LICENSE'], 'the hosted entry changes no shipped files');
});

test('`./block` exports createBlockServer and nothing else at runtime (its types aside): that is the contract', () => {
  assert.deepEqual(Object.keys(entry), ['createBlockServer']);
});

test('createBlockServer imports no SPT tool module: a hosted bundle carries the Block tools only', () => {
  const graph = new Set();
  const walk = (file) => {
    if (graph.has(file)) { return; }
    graph.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) { walk(new URL(spec, file)); }
  };
  walk(new URL('../dist/block/server.js', import.meta.url));
  const reached = [...graph].map((u) => u.pathname.split('/dist/')[1]).sort();
  assert.ok(!reached.some((f) => f.startsWith('tools/') || f === 'register.js' || f === 'client.js'), reached.join(', '));
});

test('createBlockServer refuses a missing or blank key: a hosted caller is always signed in', () => {
  assert.throws(() => createBlockServer({ credential: '' }), /credential/);
  assert.throws(() => createBlockServer({ credential: '   ' }), /credential/);
  assert.throws(() => createBlockServer({}), /credential/);
});

test('createBlockServer gives the block-api tools and instructions the stdio entry gives, signed in with the key', async () => {
  const api = await upstream(() => [200, { summary: 'ok', items: [] }]);
  try {
    const mcp = await connect(createBlockServer({ credential: ' dwlfk_test ', baseURL: api.url }));
    assert.equal(mcp.getInstructions(), BLOCK_API_INSTRUCTIONS);
    const { tools } = await mcp.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...BLOCK_API_TOOLS].sort());
    // The same registrations as the stdio path (registerForProfile on block-api), description for description.
    const reference = new McpServer({ name: 'dwlf', version: '0' });
    registerForProfile(reference, 'block', 'block-api');
    const { tools: expected } = await (await connect(reference)).listTools();
    assert.deepEqual(tools, expected);
    await mcp.callTool({ name: 'dwlf_get_conditions', arguments: {} });
    assert.deepEqual(api.seen, [{ url: '/v1/conditions', auth: 'Bearer dwlfk_test' }]);
  } finally { await api.close(); }
});

test('the recorder hears each refusal: Block\'s own body, an edge\'s answer, and an unreachable API; the tool still answers', async () => {
  const api = await upstream((url) => (url.startsWith('/v1/conditions') ? [401, { error: 'UNAUTHORIZED', message: 'key revoked' }]
    : url.startsWith('/v1/events') ? [403, '<html>Forbidden</html>', 'text/html'] : [200, { summary: 'ok' }]));
  try {
    const heard = [];
    const mcp = await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: api.url, recorder: (r) => heard.push(r) }));
    const revoked = await mcp.callTool({ name: 'dwlf_get_conditions', arguments: {} });
    assert.equal(revoked.isError, true);
    assert.match(revoked.content[0].text, /Block API 401: .*key revoked/);
    await mcp.callTool({ name: 'dwlf_get_events', arguments: {} });
    await mcp.callTool({ name: 'dwlf_get_series', arguments: { id: 'mvrv' } });
    assert.deepEqual(heard, [{ status: 401, code: 'UNAUTHORIZED', blockBody: true, body: { error: 'UNAUTHORIZED', message: 'key revoked' } },
      { status: 403, code: null, blockBody: false, body: '<html>Forbidden</html>' }]);

    const offline = [];
    const down = await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: 'http://127.0.0.1:9', timeoutMs: 2000, recorder: (r) => offline.push(r) }));
    assert.equal((await down.callTool({ name: 'dwlf_get_conditions', arguments: {} })).isError, true);
    assert.deepEqual(offline, [{ status: null, code: null, blockBody: false, body: null }]);
  } finally { await api.close(); }
});

test('a recorder that throws never changes the tool\'s answer', async () => {
  const api = await upstream(() => [401, { error: 'UNAUTHORIZED', message: 'key revoked' }]);
  try {
    const mcp = await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: api.url, recorder: () => { throw new Error('boom'); } }));
    const r = await mcp.callTool({ name: 'dwlf_get_conditions', arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Block API 401/);
  } finally { await api.close(); }
});

test('a host-supplied catalogue cache: a hit makes no Block API call; a miss reads once and keeps it; a failed read is not kept', async () => {
  const catalogue = { summary: 'c', items: [{ id: 'onchain.x', kind: 'eventType', family: 'cost-basis' }], definitions: { 'onchain.x': 'd' } };
  let fail = false;
  const api = await upstream((url) => (url.startsWith('/v1/catalogue') ? (fail ? [503, { error: 'UNAVAILABLE', message: 'down' }] : [200, catalogue]) : [200, {}]));
  try {
    const store = new Map();
    const cacheFor = (key) => ({ get: () => store.get(key), set: (body) => { store.set(key, body); } });
    const first = await connect(createBlockServer({ credential: 'dwlfk_a', baseURL: api.url, catalogueCache: cacheFor('a') }));
    await first.callTool({ name: 'dwlf_describe_onchain_events', arguments: {} });
    const second = await connect(createBlockServer({ credential: 'dwlfk_a', baseURL: api.url, catalogueCache: cacheFor('a') }));
    await second.callTool({ name: 'dwlf_describe_onchain_events', arguments: { family: 'cost-basis' } });
    assert.equal(api.seen.filter((s) => s.url.startsWith('/v1/catalogue')).length, 1, 'the second server, same key, read the kept catalogue');
    assert.deepEqual(store.get('a'), catalogue);

    fail = true;
    const other = await connect(createBlockServer({ credential: 'dwlfk_b', baseURL: api.url, catalogueCache: cacheFor('b') }));
    assert.equal((await other.callTool({ name: 'dwlf_describe_onchain_events', arguments: {} })).isError, true);
    assert.equal(store.has('b'), false, 'a failed read is never kept');
  } finally { await api.close(); }
});

test('two callers share nothing: with no host cache, each server reads with its own credential and keeps nothing for the other', async () => {
  const catalogue = { summary: 'c', items: [{ id: 'onchain.x', kind: 'eventType', family: 'cost-basis' }], definitions: { 'onchain.x': 'd' } };
  const api = await upstream(() => [200, catalogue]);
  try {
    const a = await connect(createBlockServer({ credential: 'dwlfk_a', baseURL: api.url }));
    await a.callTool({ name: 'dwlf_describe_onchain_events', arguments: {} });
    const b = await connect(createBlockServer({ credential: 'dwlfk_b', baseURL: api.url }));
    await b.callTool({ name: 'dwlf_describe_onchain_events', arguments: {} });
    await b.callTool({ name: 'dwlf_get_conditions', arguments: {} });
    assert.deepEqual(api.seen, [{ url: '/v1/catalogue', auth: 'Bearer dwlfk_a' }, { url: '/v1/catalogue', auth: 'Bearer dwlfk_b' },
      { url: '/v1/conditions', auth: 'Bearer dwlfk_b' }]);
  } finally { await api.close(); }
});
