#!/usr/bin/env node
/**
 * The Block profile's release gate (block-eval §0, 18-Nov-2026: standard tests, no model calls). For each calls file
 * in eval/calls/ (`{ tool, calls: [{ id, args }] }`), a fresh built server (`--profile block` on the `block-api`
 * backend by default: the calls are the re-pointed tools'; one server per call, so no
 * tool cache carries between calls) runs each call against the
 * recordings in eval/fixtures/ and:
 *   T1 · its output's MCP layer (what the tool adds, rewrites or selects; `mcpLayer`) must equal the committed snapshot
 *        in eval/snapshots/. Upstream content is pinned by pass-through containment instead (check 4), so a re-record
 *        changes a pass-through tool's snapshot only if the MCP's own layer changed; a selecting tool's snapshot also
 *        changes when its selection does (a new item matches);
 *   T2 · every string in the whole output that contains a space (a sentence) passes the shared banned-terms list. A
 *        single token is an identifier or an enum value and is skipped;
 *   coverage · a request that reaches a Block API path from a tool not in passthrough.json `tools` fails, and so does
 *        a request with no recording.
 *
 *   node eval/snapshot.mjs              check (what npm test runs, through test/snapshots.test.mjs)
 *   node eval/snapshot.mjs --update     rewrite the snapshots from the recordings; commit the diff after reading it
 *   node eval/snapshot.mjs --record     record from the Block API's public routes first (GETs only, no key), then update.
 *                                       SPT paths are never recorded (no DWLF key is passed, so they are refused).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServer, replayEnv, routeFamily } from './fixture-server.mjs';
import { bannedWordIn } from './wording/bannedWords.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** T2: each sentence (a string with whitespace) anywhere in `value` that the banned-terms list flags. */
export const sentenceFailures = (value, path = '') => {
  if (typeof value === 'string') {
    const hit = /\s/.test(value.trim()) ? bannedWordIn(value) : null;
    return hit ? [`${path || '(output)'}: "${hit}" in "${value.slice(0, 100)}"`] : [];
  }
  if (Array.isArray(value)) { return value.flatMap((v, i) => sentenceFailures(v, `${path}[${i}]`)); }
  if (isObject(value)) { return Object.entries(value).flatMap(([k, v]) => sentenceFailures(v, path ? `${path}.${k}` : k)); }
  return [];
};

/**
 * T1: what the MCP adds to the upstream bodies (`pages`). With no upstream page, or an output that isn't an object,
 * that is the whole output. Otherwise:
 *   - `added`: top-level keys (`items` aside) the tool added or rewrote. A value that IS one whole upstream body (a
 *     tool nesting a response under its own key) is pinned as `{ $upstreamPage: n }`, not copied;
 *   - `selection`: only when the output's items aren't exactly the upstream items in order, the upstream id (else
 *     index) of each one it gives (null = not from upstream), so a selecting tool's choice is pinned;
 *   - `itemsAdded`: per output item, keys its matching upstream item (the one it contains whole) lacks or differs on.
 * Items are matched by containment, not by `id`, so items with no id or a repeated id still match.
 */
export const mcpLayer = (output, pages) => {
  const bodies = pages.filter(isObject);
  if (!bodies.length || !isObject(output)) { return { output }; }
  const changed = (obj, base) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => !(k in base) || !isDeepStrictEqual(v, base[k])));
  const asUpstream = (v) => { const n = bodies.findIndex((b) => isDeepStrictEqual(b, v)); return n >= 0 ? { $upstreamPage: n } : v; };
  const top = changed(Object.fromEntries(Object.entries(output).filter(([k]) => k !== 'items')), bodies[0]);
  const layer = { added: Object.fromEntries(Object.entries(top).map(([k, v]) => [k, asUpstream(v)])) };
  if (!Array.isArray(output.items)) { return layer; }
  const upstream = bodies.flatMap((b) => (Array.isArray(b.items) ? b.items : []));
  const contains = (item, u) => isObject(item) && isObject(u) && Object.entries(u).every(([k, v]) => k in item && isDeepStrictEqual(item[k], v));
  const used = new Set();
  const match = output.items.map((item) => {
    const n = upstream.findIndex((u, i) => !used.has(i) && contains(item, u));
    if (n >= 0) { used.add(n); }
    return n;
  });
  // Readable in a diff: the upstream id where there is one, else its index; null = not from upstream.
  if (!(match.length === upstream.length && match.every((n, i) => n === i))) { layer.selection = match.map((n) => (n < 0 ? null : upstream[n]?.id ?? n)); }
  const extras = output.items.map((item, i) => ({ index: i, added: match[i] >= 0 ? changed(item, upstream[match[i]]) : item }))
    .filter((e) => (isObject(e.added) ? Object.keys(e.added).length : true));
  if (extras.length) { layer.itemsAdded = extras; }
  return layer;
};

/** Coverage: a request keyed `METHOD /path?…` that reached the Block API from a tool not registered for pass-through. */
export const blockReachFailures = (tool, keys, passthroughTools) => (passthroughTools.has(tool) ? [] : keys
  .filter((k) => routeFamily(k.split(' ')[1].split('?')[0]) === 'block')
  .map((k) => `${tool} reached the Block API (${k}) but is not in eval/passthrough.json \`tools\``));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const callFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f))) : []);

/** One call on a fresh server: its failures (`own`) and its MCP layer. */
const runCall = async ({ root, fixturesDir, mode, passthroughTools, tool, args, backend }) => {
  const fixtures = await startFixtureServer({ dir: fixturesDir, mode });
  const mcp = new Client({ name: 'block-snapshots', version: '0' });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
      env: { ...replayEnv(fixtures.url), DWLF_BLOCK_BACKEND: backend }, stderr: 'ignore' }));
    const r = await mcp.callTool({ name: tool, arguments: args });
    const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    let output;
    try { output = JSON.parse(text); } catch { output = text; }
    const own = [
      ...fixtures.misses.map((k) => `no recording: ${k}`),
      ...fixtures.refused.map((k) => `not recorded (no key, or an SPT path): ${k}`),
      ...fixtures.contractFailures.map((c) => `Block API contract, not saved: ${c.key}: ${c.failures.join('; ')}`),
      ...fixtures.transient.map((t) => `upstream failure, not saved: ${typeof t === 'string' ? t : JSON.stringify(t)}`),
      ...blockReachFailures(tool, [...fixtures.served.map((x) => x.key), ...fixtures.misses], passthroughTools),
      ...sentenceFailures(output).map((f) => `banned term: ${f}`),
    ];
    return { own, stale: [...fixtures.stale], layer: { isError: Boolean(r.isError), ...mcpLayer(output, fixtures.served.map((x) => x.body)) } };
  } finally {
    // close() rejects when connect never completed; that must not hide the call's own error, so it is ignored here.
    await mcp.close().catch(() => {});
    await fixtures.close();
  }
};

/** Writes the snapshot (update) or compares with it; returns the failures. A call that failed writes nothing. */
const settleSnapshot = ({ file, layer, update, failed, root }) => {
  if (update) {
    if (!failed) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(layer, null, 1)}\n`); }
    return [];
  }
  if (!existsSync(file)) { return [`no snapshot (run node eval/snapshot.mjs --update and commit ${file.slice(root.length + 1)})`]; }
  return isDeepStrictEqual(readJson(file), layer) ? [] : ['the MCP layer differs from its snapshot (read the diff, then --update)'];
};

/**
 * Runs every call. Returns `{ failures, results, stale }`; `failures` empty = the gate passes. `mode` 'record' fetches
 * from the Block API's public routes first (no key: SPT and signed-in paths are refused and not saved). `stale` lists
 * recordings older than the fixture server's limit: reported, never failed (that would make the test time-dependent).
 */
export const runSnapshots = async ({ root = join(here, '..'), fixturesDir = join(here, 'fixtures'), callsDir = join(here, 'calls'),
  snapshotsDir = join(here, 'snapshots'), passthroughFile = join(here, 'passthrough.json'), update = false, mode = 'replay',
  backend = 'block-api' } = {}) => {
  const passthroughTools = new Set(readJson(passthroughFile).tools.map((t) => t.tool));
  mkdirSync(fixturesDir, { recursive: true });
  const calls = callFiles(callsDir).flatMap(({ tool, calls: list }) => list.map(({ id, args = {} }) => ({ tool, id, args })));
  const failures = [];
  const results = [];
  const stale = new Set();
  for (const { tool, id, args } of calls) {
    const name = `${tool}.${id}`;
    const run = await runCall({ root, fixturesDir, mode, passthroughTools, tool, args, backend });
    run.stale.forEach((k) => stale.add(k));
    const own = [...run.own, ...settleSnapshot({ file: join(snapshotsDir, `${name}.json`), layer: run.layer, update, failed: run.own.length > 0, root })];
    failures.push(...own.map((f) => `${name}: ${f}`));
    results.push({ name, layer: run.layer, failures: own });
  }
  return { failures, results, stale: [...stale] };
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const record = args.includes('--record');
  runSnapshots({ update: record || args.includes('--update'), mode: record ? 'record' : 'replay' }).then(({ failures, results, stale }) => {
    for (const r of results) { console.log(`${r.failures.length ? 'FAIL' : 'ok  '} ${r.name}`); }
    if (stale.length) { console.warn(`stale recordings (re-record before a release candidate):\n- ${stale.join('\n- ')}`); }
    if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  }, (error) => { console.error(`snapshot: ${error.message}`); process.exit(2); });
}
