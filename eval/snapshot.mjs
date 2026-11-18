#!/usr/bin/env node
/**
 * The Block profile's release gate (block-eval §0, 18-Nov-2026: standard tests, no model calls). For each calls file
 * in eval/calls/ (`{ tool, calls: [{ id, args }] }`), the built server (`--profile block`) runs each call against the
 * recordings in eval/fixtures/ and:
 *   T1 · its output's MCP layer (what the tool adds, rewrites or selects; `mcpLayer`) must equal the committed snapshot
 *        in eval/snapshots/. Upstream content is pinned by pass-through containment instead (check 4), so a routine
 *        re-record changes no snapshot unless the MCP's own layer did;
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
 * T1: what the MCP adds to the upstream body. With no upstream page, or an output that isn't an object, that is the
 * whole output. Otherwise: top-level keys it added or rewrote (`items` aside), the ids of the items it gives, in order
 * (a selecting tool's choice), and per item any key the upstream item with that id didn't have or had otherwise.
 */
export const mcpLayer = (output, pages) => {
  const page0 = pages.find(isObject);
  if (!page0 || !isObject(output)) { return { output }; }
  const changed = (obj, base) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => !(k in base) || !isDeepStrictEqual(v, base[k])));
  const layer = { added: changed(Object.fromEntries(Object.entries(output).filter(([k]) => k !== 'items')), page0) };
  if (Array.isArray(output.items)) {
    const upstream = new Map(pages.filter(isObject).flatMap((p) => (Array.isArray(p.items) ? p.items : [])).filter(isObject).map((i) => [i.id, i]));
    layer.itemIds = output.items.map((i) => (isObject(i) ? i.id ?? null : null));
    const extras = output.items.filter(isObject).map((i) => ({ id: i.id ?? null, added: changed(i, upstream.get(i.id) || {}) }))
      .filter((e) => Object.keys(e.added).length);
    if (extras.length) { layer.itemsAdded = extras; }
  }
  return layer;
};

/** Coverage: a request keyed `METHOD /path?…` that reached the Block API from a tool not registered for pass-through. */
export const blockReachFailures = (tool, keys, passthroughTools) => (passthroughTools.has(tool) ? [] : keys
  .filter((k) => routeFamily(k.split(' ')[1].split('?')[0]) === 'block')
  .map((k) => `${tool} reached the Block API (${k}) but is not in eval/passthrough.json \`tools\``));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const callFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f))) : []);

/**
 * Runs every call. Returns `{ failures, results }`; `failures` empty = the gate passes. `mode` 'record' fetches from the
 * Block API's public routes first (no key: SPT and signed-in paths are refused and not saved).
 */
export const runSnapshots = async ({ root = join(here, '..'), fixturesDir = join(here, 'fixtures'), callsDir = join(here, 'calls'),
  snapshotsDir = join(here, 'snapshots'), passthroughFile = join(here, 'passthrough.json'), update = false, mode = 'replay' } = {}) => {
  const suites = callFiles(callsDir);
  if (!suites.length) { return { failures: [], results: [] }; }
  const passthroughTools = new Set(readJson(passthroughFile).tools.map((t) => t.tool));
  mkdirSync(fixturesDir, { recursive: true });
  const fixtures = await startFixtureServer({ dir: fixturesDir, mode });
  const mcp = new Client({ name: 'block-snapshots', version: '0' });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
    env: replayEnv(fixtures.url), stderr: 'ignore' }));
  const failures = [];
  const results = [];
  try {
    for (const { tool, calls } of suites) {
      for (const { id, args = {} } of calls) {
        const name = `${tool}.${id}`;
        const [servedBefore, missesBefore, refusedBefore] = [fixtures.served.length, fixtures.misses.length, fixtures.refused.length];
        const r = await mcp.callTool({ name: tool, arguments: args });
        const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
        let output;
        try { output = JSON.parse(text); } catch { output = text; }
        const served = fixtures.served.slice(servedBefore);
        const own = [
          ...fixtures.misses.slice(missesBefore).map((k) => `no recording: ${k}`),
          ...fixtures.refused.slice(refusedBefore).map((k) => `not recorded (no key, or an SPT path): ${k}`),
          ...blockReachFailures(tool, [...served.map((s) => s.key), ...fixtures.misses.slice(missesBefore)], passthroughTools),
          ...sentenceFailures(output).map((f) => `banned term: ${f}`),
        ];
        const layer = { isError: Boolean(r.isError), ...mcpLayer(output, served.map((s) => s.body)) };
        const file = join(snapshotsDir, `${name}.json`);
        if (update && !own.length) {
          mkdirSync(snapshotsDir, { recursive: true });
          writeFileSync(file, `${JSON.stringify(layer, null, 1)}\n`);
        } else if (!update) {
          if (!existsSync(file)) { own.push(`no snapshot (run node eval/snapshot.mjs --update and commit ${file.slice(root.length + 1)})`); }
          else if (!isDeepStrictEqual(readJson(file), layer)) { own.push('the MCP layer differs from its snapshot (read the diff, then --update)'); }
        }
        failures.push(...own.map((f) => `${name}: ${f}`));
        results.push({ name, layer, failures: own });
      }
    }
  } finally {
    await mcp.close();
    await fixtures.close();
  }
  return { failures, results };
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const record = args.includes('--record');
  runSnapshots({ update: record || args.includes('--update'), mode: record ? 'record' : 'replay' }).then(({ failures, results }) => {
    for (const r of results) { console.log(`${r.failures.length ? 'FAIL' : 'ok  '} ${r.name}`); }
    if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  }, (error) => { console.error(`snapshot: ${error.message}`); process.exit(2); });
}
