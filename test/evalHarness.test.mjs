// The eval harness's plumbing, with no network and no model (DWLF-804): the built server starts under the Block
// profile against the fixture server, lists its tools, and a request with no recording fails LOUDLY (599 naming the
// key) rather than reading as "no data".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServer } from '../eval/fixture-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the harness lists Block tools and names a missing recording', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const fixtures = await startFixtureServer({ dir });
  const mcp = new Client({ name: 'eval-test', version: '0' });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
    env: { PATH: process.env.PATH || '', DWLF_API_URL: fixtures.url, DWLF_API_KEY: 'eval-fixture' }, stderr: 'ignore' }));
  try {
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('dwlf_get_conditions'));
    assert.ok(!names.includes('dwlf_get_portfolio'), 'the Block profile hides retail tools');
    const miss = await mcp.callTool({ name: 'dwlf_get_conditions', arguments: { asset: 'btc' } });
    assert.equal(miss.isError, true);
    assert.match(miss.content.map((c) => c.text).join(' '), /EVAL_FIXTURE_MISSING|599/);
    assert.equal(fixtures.misses.length, 1);
  } finally {
    await mcp.close();
    await fixtures.close();
  }
});

test('record mode refuses to start without a key (it never runs unauthenticated against prod)', async () => {
  await assert.rejects(startFixtureServer({ dir: mkdtempSync(join(tmpdir(), 'dwlf-eval-')), mode: 'record' }), /DWLF_API_KEY/);
});

test('a recorded fixture is replayed exactly as recorded', async () => {
  const { fixtureKey, fixtureFile } = await import('../eval/fixture-server.mjs');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const key = fixtureKey('GET', '/v2/conditions/btc?days=7');
  writeFileSync(fixtureFile(dir, key), JSON.stringify({ key, status: 200, recordedAt: new Date().toISOString(), body: { recorded: 'yes' } }));
  const fixtures = await startFixtureServer({ dir });
  try {
    const res = await fetch(`${fixtures.url}/v2/conditions/btc?days=7`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { recorded: 'yes' });
    assert.deepEqual([...fixtures.stale], [], 'a fresh, dated fixture is not stale');
  } finally { await fixtures.close(); }
});

test('recording never writes to prod: a non-GET is refused before anything goes upstream', async () => {
  const fixtures = await startFixtureServer({ dir: mkdtempSync(join(tmpdir(), 'dwlf-eval-')), mode: 'record', apiKey: 'dummy',
    upstream: 'http://127.0.0.1:9' });
  try {
    const res = await fetch(`${fixtures.url}/v2/custom-events`, { method: 'POST', body: '{"name":"x"}' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'EVAL_RECORD_WRITE_REFUSED');
  } finally { await fixtures.close(); }
});

test('recording does not save an outage: a 5xx/401/429 upstream answer is passed on, not written', async () => {
  const { createServer } = await import('node:http');
  const { readdirSync } = await import('node:fs');
  const up = createServer((req, res) => { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"down"}'); });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const fixtures = await startFixtureServer({ dir, mode: 'record', apiKey: 'dummy', upstream: `http://127.0.0.1:${up.address().port}` });
  try {
    const res = await fetch(`${fixtures.url}/v2/conditions/btc`);
    assert.equal(res.status, 503);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(fixtures.transient.length, 1);
  } finally { await fixtures.close(); await new Promise((r) => up.close(r)); }
});

test('an undated fixture is reported stale', async () => {
  const { fixtureKey, fixtureFile } = await import('../eval/fixture-server.mjs');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-eval-'));
  const key = fixtureKey('GET', '/v2/x');
  writeFileSync(fixtureFile(dir, key), JSON.stringify({ key, status: 200, body: {} }));
  const fixtures = await startFixtureServer({ dir });
  try { await fetch(`${fixtures.url}/v2/x`); assert.deepEqual([...fixtures.stale], [key]); } finally { await fixtures.close(); }
});
