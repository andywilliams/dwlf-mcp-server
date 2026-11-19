// The Block profile's release gate (block-eval §0, 18-Nov-2026): output snapshots (T1), banned terms on sentence text
// in every tool output (T2), coverage, and the fixture lint (T3). No model calls. Proven here on synthetic recordings
// of dwlf_get_divergences (an SPT pass-through tool); the real calls files arrive tool by tool with B4's re-point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureKey, fixtureFile } from '../eval/fixture-server.mjs';
import { runSnapshots, sentenceFailures, mcpLayer, blockReachFailures } from '../eval/snapshot.mjs';
import { vendorFailures } from '../eval/fixture-lint.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evalDir = join(root, 'eval');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** A throwaway eval tree: one recording of the divergences screener, one calls file, an empty pass-through list. */
const synthetic = (body) => {
  const dir = mkdtempSync(join(tmpdir(), 'dwlf-snap-'));
  const fixturesDir = join(dir, 'fixtures');
  const callsDir = join(dir, 'calls');
  mkdirSync(fixturesDir); mkdirSync(callsDir);
  const key = fixtureKey('GET', '/v2/screener/divergences?limit=50');
  if (body) { writeFileSync(fixtureFile(fixturesDir, key), JSON.stringify({ key, status: 200, recordedAt: new Date().toISOString(), body })); }
  writeFileSync(join(callsDir, 'divergences.json'), JSON.stringify({ tool: 'dwlf_get_divergences', calls: [{ id: 'default', args: {} }] }));
  writeFileSync(join(dir, 'passthrough.json'), JSON.stringify({ tools: [] }));
  return { root, fixturesDir, callsDir, snapshotsDir: join(dir, 'snapshots'), passthroughFile: join(dir, 'passthrough.json') };
};
const BODY = { responseVersion: 2, asOf: '2026-11-16T00:00:00Z', summary: 'One divergence on BTCOC/USD.', definitions: { regular: 'Price and RSI disagree at two lows.' },
  items: [{ id: 'd1', eventType: 'rsi.divergence.regular.bullish', direction: 'bearish', summary: 'A regular divergence at two daily lows.', knowableAt: '2026-11-10T00:00:00Z' }] };

test('T1: --update writes the MCP layer; a re-run against the same recording passes; an edited snapshot fails', async () => {
  const opts = synthetic(BODY);
  const first = await runSnapshots({ ...opts, update: true });
  assert.deepEqual(first.failures, []);
  const file = join(opts.snapshotsDir, 'dwlf_get_divergences.default.json');
  assert.ok(existsSync(file), 'the snapshot was written');
  assert.deepEqual((await runSnapshots(opts)).failures, []);
  const snap = readJson(file);
  writeFileSync(file, JSON.stringify({ ...snap, added: { ...snap.added, extra: 1 } }));
  assert.match((await runSnapshots(opts)).failures.join('\n'), /MCP layer differs from its snapshot/);
});

test('T1: with no snapshot, or no recording, the call fails', async () => {
  assert.match((await runSnapshots(synthetic(BODY))).failures.join('\n'), /no snapshot/);
  assert.match((await runSnapshots(synthetic(null))).failures.join('\n'), /no recording: GET \/v2\/screener\/divergences/);
});

test('T2: a banned term in a sentence anywhere in the output fails; identifiers and enum values do not', async () => {
  const opts = synthetic({ ...BODY, summary: 'Price will rise from here.' });
  const { failures } = await runSnapshots({ ...opts, update: true });
  assert.match(failures.join('\n'), /banned term: summary: "will"/);
  assert.equal(failures.length, 1, `only the sentence fails, not rsi.divergence.regular.bullish or direction "bearish": ${failures}`);
  assert.ok(!existsSync(join(opts.snapshotsDir, 'dwlf_get_divergences.default.json')), 'a failing call writes no snapshot');
  assert.deepEqual(sentenceFailures({ id: 'smc.bos.bullish', direction: 'bearish', label: 'supply-in-profit-pct' }), []);
  assert.equal(sentenceFailures({ why: ['It crossed above on 2023-01-13.', 'You should buy now.'] }).length, 1);
});

test('mcpLayer pins only what the tool adds, rewrites or selects', () => {
  const page = { asOf: 'a', summary: 's', items: [{ id: 'x', v: 1 }, { id: 'y', v: 2 }] };
  assert.deepEqual(mcpLayer({ ...page }, [page]), { added: {} }, 'a pure pass-through has an empty layer');
  assert.deepEqual(mcpLayer({ asOf: 'a', summary: 'changed', hint: 'h', items: [{ id: 'y', v: 2, note: 'n' }] }, [page]),
    { added: { summary: 'changed', hint: 'h' }, selection: ['y'], itemsAdded: [{ index: 0, added: { note: 'n' } }] });
  const noIds = { items: [{ t: 1 }, { t: 2 }, { t: 2 }] };
  assert.deepEqual(mcpLayer({ ...noIds }, [noIds]), { added: {} }, 'items with no id or repeated values still match');
  const definition = { kind: 'def', text: 'x' };
  assert.deepEqual(mcpLayer({ definitionSource: 'api', definition }, [definition]), { added: { definitionSource: 'api', definition: { $upstreamPage: 0 } } },
    'an upstream body nested under a key is referenced, not copied');
  assert.deepEqual(mcpLayer('Usage: …', [page]), { output: 'Usage: …' });
  assert.deepEqual(mcpLayer({ a: 1 }, []), { output: { a: 1 } }, 'no upstream: the whole output is the MCP\'s');
});

test('coverage: a call that reaches the Block API from an unregistered tool fails', () => {
  assert.equal(blockReachFailures('dwlf_get_conditions', ['GET /public/v1/conditions'], new Set()).length, 1);
  assert.deepEqual(blockReachFailures('dwlf_get_conditions', ['GET /public/v1/conditions'], new Set(['dwlf_get_conditions'])), []);
  assert.deepEqual(blockReachFailures('dwlf_get_divergences', ['GET /v2/screener/divergences?limit=50'], new Set()), []);
});

test('coverage: every re-pointed tool (passthrough.json `tools`) has a calls file with calls, each with a snapshot', () => {
  const registered = readJson(join(evalDir, 'passthrough.json')).tools.map((t) => t.tool);
  const callsDir = join(evalDir, 'calls');
  const suites = readdirSync(callsDir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(callsDir, f)));
  for (const tool of registered) {
    const suite = suites.find((s) => s.tool === tool);
    assert.ok(suite && suite.calls?.length, `${tool} is re-pointed but has no eval/calls file with calls`);
    for (const c of suite.calls) { assert.ok(existsSync(join(evalDir, 'snapshots', `${tool}.${c.id}.json`)), `${tool}.${c.id} has no snapshot`); }
  }
});

test('the gate: every committed calls file replays to its snapshot, with no banned sentence and no unregistered Block call', async () => {
  const { failures, stale } = await runSnapshots();
  if (stale.length) { console.log(`# stale recordings (re-record before a release candidate): ${stale.join(', ')}`); }
  assert.deepEqual(failures, []);
});

test('T3 fixture lint: no committed recording carries a price on a symbol other than BTCOC/USD', () => {
  const dir = join(evalDir, 'fixtures');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const failures = files.flatMap((f) => vendorFailures(readJson(join(dir, f)).body).map((x) => `${f}: ${x}`));
  assert.deepEqual(failures, []);
  assert.deepEqual(vendorFailures({ items: [{ symbol: 'BTCOC/USD', price: 82974 }] }), []);
  assert.equal(vendorFailures({ items: [{ symbol: 'BTC/USD', price: 82974 }] }).length, 1);
  assert.equal(vendorFailures({ items: [{ symbol: 'BTC/USD', values: { close: 1 } }] }).length, 1);
  assert.equal(vendorFailures({ items: [{ priceWithheld: false }] }).length, 1);
  assert.deepEqual(vendorFailures({ items: [{ symbol: 'BTC/USD', summary: 'no price here' }] }), []);
  assert.equal(vendorFailures({ symbol: 'BTC/USD', price: { close: 82974, withheld: false } }).length, 2, 'nested under a symbol parent, and the withheld flag');
  assert.equal(vendorFailures({ symbol: 'BTC/USD', items: [{ level: 60000 }] }).length, 1, 'a symbol applies to its children');
});
