// The library entry for a per-request host: `@dwlf/mcp-server/block` (DWLF-622, docs/design/hosted-auth.md step 2a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as entry from '@dwlf/mcp-server/block';
import { registerForProfile } from '../dist/register.js';
import { BLOCK_API_TOOLS, blockApiInstructions } from '../dist/profiles.js';

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
    // Every relative specifier: `from '…'`, a side-effect `import '…'`, and a dynamic `import('…')`, either quote.
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)) { walk(new URL(spec, file)); }
  };
  walk(new URL('../dist/block/server.js', import.meta.url));
  const reached = [...graph].map((u) => u.pathname.split('/dist/')[1]).sort();
  assert.ok(!reached.some((f) => f.startsWith('tools/') || f === 'register.js' || f === 'client.js'), reached.join(', '));
});

test('createBlockServer refuses a missing or blank credential (a hosted caller is always signed in) and a missing baseURL', () => {
  assert.throws(() => createBlockServer({ credential: '', baseURL: 'https://x' }), /credential/);
  assert.throws(() => createBlockServer({ credential: '   ', baseURL: 'https://x' }), /credential/);
  assert.throws(() => createBlockServer({ baseURL: 'https://x' }), /credential/);
  assert.throws(() => createBlockServer({ credential: 'dwlfk_a' }), /baseURL/, 'no environment fallback for the upstream');
  assert.throws(() => createBlockServer({ credential: 'dwlfk_a', baseURL: 'http://api.block.dwlf.co.uk' }), /HTTPS/, 'never a key in cleartext');
  assert.throws(() => createBlockServer({ credential: 'dwlfk_a', baseURL: 'not a url' }), /baseURL/);
  createBlockServer({ credential: 'dwlfk_a', baseURL: 'https://api.block.dwlf.co.uk' });
  createBlockServer({ credential: 'dwlfk_a', baseURL: 'http://localhost:1' });
});

test('createBlockServer gives the block-api tools and instructions the stdio entry gives, signed in with the key', async () => {
  const api = await upstream(() => [200, { summary: 'ok', items: [] }]);
  try {
    const mcp = await connect(createBlockServer({ credential: ' dwlfk_test ', baseURL: api.url }));
    assert.equal(mcp.getInstructions(), blockApiInstructions('https://api.block.dwlf.co.uk', true), 'a loopback base reads production\'s text, signed in');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.deepEqual(mcp.getServerVersion(), { name: 'dwlf', version: pkg.version }, 'serverInfo names the tool code that answered');
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

test('createBlockServer names the keys page of its baseURL\'s stage (staging\'s for the staging API)', async () => {
  const mcp = await connect(createBlockServer({ credential: 'dwlfk_a', baseURL: 'https://api.block-staging.dwlf.co.uk' }));
  assert.match(mcp.getInstructions(), /from https:\/\/block-staging\.dwlf\.co\.uk\/account\/, reads/);
  assert.doesNotMatch(mcp.getInstructions(), /https:\/\/block\.dwlf\.co\.uk\/account\//);
});

test('the recorder hears each refusal: Block\'s own body, an edge\'s answer, and an unreachable API; the tool still answers', async () => {
  const api = await upstream((url) => (url.startsWith('/v1/conditions') ? [401, { error: 'UNAUTHORIZED', message: 'key revoked' }]
    : url.startsWith('/v1/events') ? [403, '<html>Forbidden</html>', 'text/html']
      : url.startsWith('/v1/catalogue') ? [429, { error: 'Too Many Requests' }] : [200, { summary: 'ok' }]));
  try {
    const heard = [];
    const mcp = await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: api.url, recorder: (r) => heard.push(r) }));
    const revoked = await mcp.callTool({ name: 'dwlf_get_conditions', arguments: {} });
    assert.equal(revoked.isError, true);
    assert.match(revoked.content[0].text, /Block API 401: .*key revoked/);
    await mcp.callTool({ name: 'dwlf_get_events', arguments: {} });
    await mcp.callTool({ name: 'dwlf_get_series', arguments: { id: 'mvrv' } });
    await mcp.callTool({ name: 'dwlf_describe_onchain_events', arguments: {} });
    assert.deepEqual(heard, [{ status: 401, code: 'UNAUTHORIZED', blockBody: true }, { status: 403, code: null, blockBody: false },
      { status: 429, code: null, blockBody: false }], 'an `error` without Block\'s `message` is an edge\'s answer, not Block\'s');

    const offline = [];
    const down = await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: 'http://127.0.0.1:9', timeoutMs: 2000, recorder: (r) => offline.push(r) }));
    assert.equal((await down.callTool({ name: 'dwlf_get_conditions', arguments: {} })).isError, true);
    assert.deepEqual(offline, [{ status: null, code: null, blockBody: false }]);
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
    // One store for the whole process, as a host keeps it: the library keys it by the credential's SHA-256.
    const store = new Map();
    const shared = { get: (key) => store.get(key), set: (key, body) => { store.set(key, body); } };
    const keyOf = (c) => createHash('sha256').update(c).digest('hex');
    const first = await connect(createBlockServer({ credential: 'dwlfk_a', baseURL: api.url, catalogueCache: shared }));
    await first.callTool({ name: 'dwlf_describe_onchain_events', arguments: {} });
    const second = await connect(createBlockServer({ credential: 'dwlfk_a', baseURL: api.url, catalogueCache: shared }));
    await second.callTool({ name: 'dwlf_describe_onchain_events', arguments: { family: 'cost-basis' } });
    assert.equal(api.seen.filter((s) => s.url.startsWith('/v1/catalogue')).length, 1, 'the second server, same key, read the kept catalogue');
    assert.deepEqual([...store.keys()], [keyOf('dwlfk_a')], 'keyed by the hash, never the credential');
    assert.deepEqual(store.get(keyOf('dwlfk_a')), catalogue);

    fail = true;
    const other = await connect(createBlockServer({ credential: 'dwlfk_b', baseURL: api.url, catalogueCache: shared }));
    assert.equal((await other.callTool({ name: 'dwlf_describe_onchain_events', arguments: {} })).isError, true,
      'the other caller reads for itself (and fails here), never the first caller\'s kept view');
    assert.equal(store.has(keyOf('dwlfk_b')), false, 'a failed read is never kept');
  } finally { await api.close(); }
});

test('two callers share nothing: with no host cache, every tool on each server reads with that server\'s own credential', async () => {
  const catalogue = { summary: 'c', items: [{ id: 'onchain.x', kind: 'eventType', family: 'cost-basis' }], definitions: { 'onchain.x': 'd' } };
  const api = await upstream(() => [200, catalogue]);
  // Minimal arguments per tool; a Block tool added without an entry here fails the test until it gets one.
  const args = { dwlf_get_conditions: {}, dwlf_get_events: {}, dwlf_get_series: { id: 'mvrv' },
    dwlf_describe_onchain_events: {}, dwlf_explain_event: { eventType: 'onchain.x' } };
  assert.deepEqual(Object.keys(args).sort(), [...BLOCK_API_TOOLS].sort());
  try {
    for (const credential of ['dwlfk_a', 'dwlfk_b']) {
      const mcp = await connect(createBlockServer({ credential, baseURL: api.url }));
      const before = api.seen.length;
      for (const [name, a] of Object.entries(args)) { assert.notEqual((await mcp.callTool({ name, arguments: a })).isError, true, name); }
      const mine = api.seen.slice(before);
      assert.ok(mine.some((s) => s.url.startsWith('/v1/catalogue')), `${credential} read the catalogue itself, not another caller's`);
      assert.deepEqual([...new Set(mine.map((s) => s.auth))], [`Bearer ${credential}`]);
    }
  } finally { await api.close(); }
});

test('upstreamHeaders: a host\'s x-dwlf- headers go on every Block API read, never in an answer; anything else is refused', async () => {
  const SECRET = 'hosted-secret-0123456789abcdefghijklmnop';
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    const fail = req.url.startsWith('/v1/events');
    res.writeHead(fail ? 500 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fail ? { error: 'INTERNAL', message: 'boom' } : { summary: 'ok', items: [] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = { 'X-DWLF-Hosted-Secret': SECRET, 'x-dwlf-hosted-caller': '2001:db8::1' };
    const mcp = await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: url, upstreamHeaders: headers }));
    await mcp.callTool({ name: 'dwlf_get_conditions', arguments: {} });
    const failed = await mcp.callTool({ name: 'dwlf_get_events', arguments: {} });
    assert.equal(failed.isError, true);
    assert.ok(!JSON.stringify(failed).includes(SECRET), 'a refusal\'s answer never carries a host header');
    const down = await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: 'http://127.0.0.1:9', timeoutMs: 2000, upstreamHeaders: headers }));
    assert.ok(!JSON.stringify(await down.callTool({ name: 'dwlf_get_conditions', arguments: {} })).includes(SECRET));
    assert.equal(seen.length, 2);
    for (const h of seen) {
      assert.equal(h['x-dwlf-hosted-secret'], SECRET);
      assert.equal(h['x-dwlf-hosted-caller'], '2001:db8::1');
      assert.equal(h.authorization, 'Bearer dwlfk_test');
      assert.equal(h.accept, 'application/json');
    }
    seen.length = 0;
    await (await connect(createBlockServer({ credential: 'dwlfk_test', baseURL: url }))).callTool({ name: 'dwlf_get_conditions', arguments: {} });
    assert.deepEqual(Object.keys(seen[0]).filter((k) => k.startsWith('x-dwlf-')), [], 'none unless the host gives them');
  } finally { await new Promise((r) => server.close(r)); }

  const make = (upstreamHeaders) => createBlockServer({ credential: 'dwlfk_a', baseURL: 'https://api.block.dwlf.co.uk', upstreamHeaders });
  for (const name of ['authorization', 'Accept', 'host', 'x-other', 'x-dwlf-', 'x-dwlf-a b', 'x-dwlf--a']) {
    assert.throws(() => make({ [name]: 'v' }), /isn't an x-dwlf- header name/, name);
  }
  for (const value of ['', ' ', ' lead', 'trail ', 'a\r\nx-injected: 1', 'café', 42]) {
    assert.throws(() => make({ 'x-dwlf-a': value }), (e) => /printable ASCII/.test(e.message) && !e.message.includes(String(value).trim() || '\u0000'), JSON.stringify(value));
  }
  assert.throws(() => make({ 'x-dwlf-a': 'v', 'X-DWLF-A': 'w' }), /given twice/);
  assert.throws(() => make('x-dwlf-a: v'), /must be an object/);
  make({ 'x-dwlf-hosted-secret': 'a b', 'x-dwlf-hosted-caller': '203.0.113.9' });
});
