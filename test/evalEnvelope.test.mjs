// Charter check 4 (DWLF-804, WP7): the Block envelope reaches the agent. Three parts, no network and no model:
//   - envelope.mjs reads the required fields from the Block API's own OpenAPI and applies the knowableAt rules;
//   - recording checks each Block data-route body against that OpenAPI and saves only what passes, with its version;
//   - the pass-through rule (containment) holds for every tool in eval/passthrough.json, replayed through the built
//     server; its machinery is proven here on dwlf_get_divergences, which passes SPT's body through unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { requiredFrom, requiredForPath, envelopeFailures, containmentFailures, dataFamily } from '../eval/envelope.mjs';
import { startFixtureServer, fixtureKey, fixtureFile, routeFamily, schemaDrift, replayEnv } from '../eval/fixture-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The shape of the Block API's published OpenAPI (1.0.0-draft, 16-Nov): an Envelope, a ConditionsEnvelope that adds
// `unavailable` through allOf, and items that are one of OpenItem / LockedItem.
const OPENAPI = {
  info: { version: 'test-1' },
  paths: {
    '/public/v1/conditions': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ConditionsEnvelope' } } } } } } },
    '/public/v1/events': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } } } } },
    '/public/v1/series/{id}': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } } } } },
    '/v1/me': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } } } } } },
  },
  components: { schemas: {
    OpenItem: { required: ['id', 'knowableAt', 'summary', 'why', 'chartUrl', 'values'] },
    LockedItem: { required: ['id', 'knowableAt', 'summary', 'why', 'chartUrl', 'requiredPlan'] },
    Envelope: { required: ['asOf', 'knowableAt', 'summary', 'items', 'definitions'],
      properties: { items: { type: 'array', items: { oneOf: [{ $ref: '#/components/schemas/OpenItem' }, { $ref: '#/components/schemas/LockedItem' }] } } } },
    ConditionsEnvelope: { allOf: [{ $ref: '#/components/schemas/Envelope' }, { required: ['unavailable'] }] },
    Me: { required: ['accountId'] },
  } },
};
const item = (over = {}) => ({ id: 'costBasis.realised_price', knowableAt: '2023-01-14T00:46:06.000Z', summary: 's', why: ['w'], chartUrl: 'u',
  values: { sinceKnowableAt: '2023-01-14T00:46:06.000Z' }, ...over });
const conditions = (over = {}) => ({ asOf: '2026-11-16T10:50:57.759Z', knowableAt: '2026-11-16T00:32:13.000Z', summary: 's', definitions: {}, unavailable: [],
  items: [item(), item({ id: 'regime.daily', knowableAt: '2026-11-16T00:32:13.000Z', values: {} })], ...over });

test('the required lists come from the OpenAPI: allOf adds to the envelope, an item needs what EVERY variant requires', () => {
  const routes = requiredFrom(OPENAPI);
  assert.deepEqual(Object.keys(routes).sort(), ['/public/v1/conditions', '/public/v1/events', '/public/v1/series/{id}'], '/v1/me is not a data route');
  assert.deepEqual(routes['/public/v1/conditions'].envelope, ['asOf', 'knowableAt', 'summary', 'items', 'definitions', 'unavailable']);
  assert.deepEqual(routes['/public/v1/conditions'].item, ['id', 'knowableAt', 'summary', 'why', 'chartUrl']);
  assert.equal(requiredForPath(routes, '/public/v1/series/price-close').family, 'series');
  assert.equal(requiredForPath(routes, '/public/v1/series/a/b'), null);
  assert.equal(dataFamily('/v1/catalogue'), 'catalogue');
  assert.equal(dataFamily('/v1/me'), null);
});

test('a body with every required field and honest knowableAt times passes', () => {
  assert.deepEqual(envelopeFailures(conditions(), requiredForPath(requiredFrom(OPENAPI), '/public/v1/conditions'), { family: 'conditions' }), []);
});

test('missing fields are named, at the top and per item (a locked item still needs summary, why and chartUrl)', () => {
  const req = requiredForPath(requiredFrom(OPENAPI), '/public/v1/conditions');
  const body = conditions();
  delete body.definitions;
  delete body.items[1].chartUrl;
  assert.deepEqual(envelopeFailures(body, req, { family: 'conditions' }), ['envelope: no `definitions`', 'items[1] (regime.daily): no `chartUrl`']);
});

test('knowableAt rules (DWLF-853): request time on conditions, later than the envelope, sinceKnowableAt, envelope not the latest, later than asOf', () => {
  const req = requiredForPath(requiredFrom(OPENAPI), '/public/v1/conditions');
  const at = (body) => envelopeFailures(body, req, { family: 'conditions' });
  const requestTime = conditions();
  requestTime.items[0] = item({ knowableAt: requestTime.asOf, values: {} });
  assert.ok(at(requestTime).some((f) => /is the response's `asOf`/.test(f)));
  assert.ok(at(requestTime).some((f) => /later than the envelope's/.test(f)));
  assert.deepEqual(at(conditions({ items: [item({ values: { sinceKnowableAt: '2023-01-13T00:00:00.000Z' } }), conditions().items[1]] })),
    ['items[0] (costBasis.realised_price): `values.sinceKnowableAt` 2023-01-13T00:00:00.000Z is not its `knowableAt` 2023-01-14T00:46:06.000Z']);
  assert.deepEqual(at(conditions({ knowableAt: '2026-11-16T05:00:00.000Z' })), ['envelope: `knowableAt` 2026-11-16T05:00:00.000Z is not the latest item\'s (2026-11-16T00:32:13.000Z)']);
  assert.ok(at(conditions({ asOf: '2026-11-15T00:00:00.000Z' })).some((f) => /later than `asOf`/.test(f)));
  assert.ok(at(conditions({ knowableAt: 'soon' })).includes('envelope: `knowableAt` is not a time'));
});

test('the asOf rule is for conditions only (the catalogue\'s definitions are knowable when asked); events must not predate their date', () => {
  const routes = requiredFrom(OPENAPI);
  const catalogueLike = { asOf: '2026-11-17T19:55:57.227Z', knowableAt: '2026-11-17T19:55:57.227Z', summary: 's', definitions: {},
    items: [item({ knowableAt: '2026-11-17T19:55:57.227Z', values: {} })] };
  assert.deepEqual(envelopeFailures(catalogueLike, routes['/public/v1/events'], { family: 'catalogue' }), []);
  const early = { ...catalogueLike, knowableAt: '2026-10-17T00:00:00.000Z', items: [item({ date: '2026-10-18', knowableAt: '2026-10-17T00:00:00.000Z', values: {} })] };
  assert.deepEqual(envelopeFailures(early, routes['/public/v1/events'], { family: 'events' }),
    ['items[0] (costBasis.realised_price): `knowableAt` 2026-10-17T00:00:00.000Z is before the event\'s date 2026-10-18']);
});

test('containment: extra keys and extra pages are fine; a dropped, renamed or rewritten upstream field fails', () => {
  const page1 = conditions();
  const page2 = { ...conditions(), items: [item({ id: 'page2' })] };
  const enriched = { ...page1, filtersApplied: { autoPaginated: true }, items: [...page1.items.map((i) => ({ ...i, extra: 1 })), ...page2.items] };
  assert.deepEqual(containmentFailures(enriched, [page1, page2]), []);
  const { summary: _s, ...dropped } = page1;
  assert.deepEqual(containmentFailures(dropped, [page1]), ['dropped `summary`']);
  assert.deepEqual(containmentFailures({ ...page1, asOf: 'x' }, [page1]), ['changed `asOf`']);
  assert.deepEqual(containmentFailures(page1.items, [page1]), ['dropped `asOf`', 'dropped `knowableAt`', 'dropped `summary`', 'dropped `definitions`', 'dropped `unavailable`',
    'page 0 item 0 (costBasis.realised_price) is missing or altered', 'page 0 item 1 (regime.daily) is missing or altered'], 'unwrapping to items fails');
  assert.deepEqual(containmentFailures({ ...page1, items: [{ ...page1.items[0], why: 'reworded' }, page1.items[1]] }, [page1]),
    ['page 0 item 0 (costBasis.realised_price) is missing or altered']);
});

test('routing: Block paths go to the Block API, everything else to SPT', () => {
  assert.equal(routeFamily('/public/v1/conditions'), 'block');
  assert.equal(routeFamily('/v1/me'), 'block');
  assert.equal(routeFamily('/v2/conditions/btc'), 'dwlf');
  assert.equal(routeFamily('/v10/x'), 'dwlf');
});

/** A stand-in Block API: its OpenAPI, and conditions bodies a test chooses. */
const fakeBlock = async (bodies) => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization });
    const body = req.url === '/public/v1/openapi.json' ? OPENAPI : bodies[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: 'NOT_FOUND' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
};

test('recording checks a Block data-route body against the Block API\'s OpenAPI: a good one is saved with its version, sent with no key', async () => {
  const block = await fakeBlock({ '/public/v1/conditions': conditions() });
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const fixtures = await startFixtureServer({ dir, mode: 'record', upstreams: { block: block.url, dwlf: 'http://127.0.0.1:9' } });
  try {
    assert.equal((await fetch(`${fixtures.url}/public/v1/conditions`)).status, 200);
    const saved = JSON.parse(readFileSync(fixtureFile(dir, fixtureKey('GET', '/public/v1/conditions')), 'utf8'));
    assert.equal(saved.openapi.version, 'test-1');
    assert.match(saved.openapi.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(saved.body, conditions());
    assert.ok(block.seen.every((r) => r.authorization === undefined), 'a public route is recorded with no key');
    assert.deepEqual(fixtures.contractFailures, []);
  } finally { await fixtures.close(); await block.close(); }
});

test('recording does not save a body that breaks the contract: it is answered, reported as the Block API\'s, and not written', async () => {
  const broken = conditions();
  broken.items[0].knowableAt = broken.asOf;
  const block = await fakeBlock({ '/public/v1/conditions': broken });
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const fixtures = await startFixtureServer({ dir, mode: 'record', upstreams: { block: block.url } });
  try {
    const res = await fetch(`${fixtures.url}/public/v1/conditions`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), broken);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(fixtures.contractFailures.length, 1);
    assert.ok(fixtures.contractFailures[0].failures.some((f) => /`asOf`/.test(f)));
  } finally { await fixtures.close(); await block.close(); }
});

test('a signed-in Block path is sent with the Block key as a Bearer token; an SPT path with the SPT key', async () => {
  const block = await fakeBlock({ '/v1/me': { accountId: 'a' } });
  const spt = await fakeBlock({ '/v2/x': { ok: true } });
  const fixtures = await startFixtureServer({ dir: mkdtempSync(join(tmpdir(), 'dwlf-eval-')), mode: 'record', upstreams: { block: block.url, dwlf: spt.url },
    blockKey: 'blk', apiKey: 'spt' });
  try {
    assert.equal((await fetch(`${fixtures.url}/v1/me`)).status, 200);
    assert.equal((await fetch(`${fixtures.url}/v2/x`)).status, 200);
    assert.deepEqual(block.seen.map((r) => r.authorization), ['Bearer blk']);
    assert.deepEqual(spt.seen.map((r) => r.authorization), ['ApiKey spt']);
  } finally { await fixtures.close(); await block.close(); await spt.close(); }
});

test('recordings checked against an older OpenAPI than the newest are listed (a tightened required list shows up)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const write = (path, recordedAt, sha256) => writeFileSync(fixtureFile(dir, fixtureKey('GET', path)),
    JSON.stringify({ key: fixtureKey('GET', path), status: 200, recordedAt, openapi: { version: 'v', sha256 }, body: {} }));
  write('/public/v1/events', '2026-11-01T00:00:00Z', 'old');
  write('/public/v1/conditions', '2026-11-16T00:00:00Z', 'new');
  assert.deepEqual(schemaDrift(dir).map((d) => [d.key, d.openapi.sha256, d.newest.sha256]), [['GET /public/v1/events', 'old', 'new']]);
});

/** Replays `tool` through the built Block server against `dir`; returns the parsed result and the upstream bodies served. */
const replayTool = async (dir, tool, args, backend = 'spt') => {
  const fixtures = await startFixtureServer({ dir });
  const mcp = new Client({ name: 'eval-passthrough', version: '0' });
  try {
    // connect inside the try: a server that fails to start must still close the fixture server, or the file hangs.
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
      env: { ...replayEnv(fixtures.url), DWLF_BLOCK_BACKEND: backend }, stderr: 'ignore' }));
    const r = await mcp.callTool({ name: tool, arguments: args });
    assert.notEqual(r.isError, true, r.content?.map((c) => c.text).join(' '));
    return { result: JSON.parse(r.content.map((c) => c.text).join('')), pages: fixtures.served.map((s) => s.body),
      paths: fixtures.served.map((s) => s.key.split(' ')[1].split('?')[0]), misses: fixtures.misses };
  } finally { await mcp.close().catch(() => {}); await fixtures.close(); } // close() rejects if connect failed: ignored
};

test('the pass-through check works end to end (proven on dwlf_get_divergences, an SPT pass-through tool)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const key = fixtureKey('GET', '/v2/screener/divergences?limit=50');
  const body = { responseVersion: 2, asOf: '2026-11-16T00:00:00Z', summary: 'One divergence.', definitions: { regular: 'r' },
    items: [{ id: 'd1', summary: 's', knowableAt: '2026-11-10T00:00:00Z', chartUrl: 'u' }] };
  writeFileSync(fixtureFile(dir, key), JSON.stringify({ key, status: 200, recordedAt: new Date().toISOString(), body }));
  const { result, pages, misses } = await replayTool(dir, 'dwlf_get_divergences', {});
  assert.deepEqual(misses, []);
  assert.deepEqual(containmentFailures(result, pages), []);
});

test('passthrough.json covers the launch set: each launch-set data tool is checked or still pending the cut, and pending only shrinks', async () => {
  const registry = JSON.parse(readFileSync(join(root, 'eval', 'passthrough.json'), 'utf8'));
  const checked = registry.tools.map((t) => t.tool);
  const launch = registry.launchDataTools;
  assert.deepEqual(launch.filter((t) => !checked.includes(t) && !registry.cutPending.includes(t)), [], 'a launch-set data tool is in neither list');
  assert.deepEqual(registry.cutPending.filter((t) => checked.includes(t)), [], 'a tool is both checked and pending');
  // cutPending never grows past its 17-Nov baseline (a hand-kept copy here).
  const CUT_PENDING_BASELINE_2026_11_17 = ['dwlf_describe_onchain_events', 'dwlf_explain_event', 'dwlf_get_conditions', 'dwlf_get_events', 'dwlf_get_series'];
  assert.deepEqual(registry.cutPending.filter((t) => !CUT_PENDING_BASELINE_2026_11_17.includes(t)), [], 'a tool was ADDED to cutPending');
  assert.deepEqual(registry.cutPending.filter((t) => !launch.includes(t)), [], 'cutPending holds launch-set tools only');
  // A renamed launch tool fails here; dwlf_get_series is the one the launch set adds (it arrives with its PR).
  const { BLOCK_TOOLS } = await import('../dist/profiles.js');
  assert.deepEqual(launch.filter((t) => !BLOCK_TOOLS.has(t) && t !== 'dwlf_get_series'), [], 'a launch-set tool is not a Block tool');
});

test('check 4: every tool in eval/passthrough.json keeps its Block API body whole (on the block-api backend, DWLF-876)', async () => {
  const registry = JSON.parse(readFileSync(join(root, 'eval', 'passthrough.json'), 'utf8'));
  const { BLOCK_API_TOOLS } = await import('../dist/profiles.js');
  for (const { tool, args = {} } of registry.tools) {
    assert.ok(BLOCK_API_TOOLS.has(tool), `${tool} is not a block-api backend tool`);
    const { result, pages, paths, misses } = await replayTool(join(root, 'eval', 'fixtures'), tool, args, 'block-api');
    assert.deepEqual(misses, [], `${tool}: record its fixture first`);
    assert.ok(pages.length > 0, `${tool}: no upstream page`);
    assert.deepEqual(paths.filter((p) => routeFamily(p) !== 'block'), [], `${tool}: its upstream is not the Block API`);
    assert.deepEqual(containmentFailures(result, pages), [], tool);
  }
});

test('a failed OpenAPI fetch is reported, not saved and not cached: the next request fetches it again', async () => {
  let openapiCalls = 0;
  const server = createServer((req, res) => {
    if (req.url === '/public/v1/openapi.json') {
      openapiCalls += 1;
      res.writeHead(openapiCalls === 1 ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(openapiCalls === 1 ? { error: 'down' } : OPENAPI));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(conditions()));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const fixtures = await startFixtureServer({ dir, mode: 'record', upstreams: { block: `http://127.0.0.1:${server.address().port}` } });
  try {
    assert.equal((await fetch(`${fixtures.url}/public/v1/conditions`)).status, 200);
    assert.deepEqual(readdirSync(dir), [], 'an unchecked body is not saved');
    assert.match(fixtures.contractFailures[0].failures[0], /OpenAPI could not be read/);
    assert.equal((await fetch(`${fixtures.url}/public/v1/conditions`)).status, 200);
    assert.equal(openapiCalls, 2);
    assert.equal(readdirSync(dir).length, 1, 'checked and saved once the OpenAPI is readable');
  } finally { await fixtures.close(); await new Promise((r) => server.close(r)); }
});
