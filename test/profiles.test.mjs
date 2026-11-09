import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveProfile, profiledServer, BLOCK_TOOLS, PROFILE_INSTRUCTIONS } from '../dist/profiles.js';
import { registerAll } from '../dist/register.js';

// DWLF-621: tool profiles. `full` is unchanged; `block` is the Bitcoin subset.
const fakeServer = () => {
  const tools = [];
  const resources = [];
  return { tools, resources, server: { tool: (name) => { tools.push(name); }, resource: (name) => { resources.push(name); } } };
};

test('profile resolution: flag beats env, default full, unknown is an error (never a silent full)', () => {
  assert.equal(resolveProfile([], {}), 'full');
  assert.equal(resolveProfile([], { DWLF_TOOL_PROFILE: 'Block' }), 'block');
  assert.equal(resolveProfile(['--profile', 'block'], { DWLF_TOOL_PROFILE: 'full' }), 'block');
  assert.equal(resolveProfile(['--profile=full'], { DWLF_TOOL_PROFILE: 'block' }), 'full');
  assert.throws(() => resolveProfile(['--profile', 'btc'], {}), /Unknown DWLF tool profile "btc"/);
  assert.throws(() => resolveProfile([], { DWLF_TOOL_PROFILE: 'blok' }), /Use one of: full, block/);
});

test('profile edge cases: a trailing --profile is an error; an empty env var is unset', () => {
  assert.throws(() => resolveProfile(['--profile'], {}), /--profile needs a value/);
  assert.throws(() => resolveProfile(['--profile', '--other'], { DWLF_TOOL_PROFILE: 'block' }), /--profile needs a value/);
  assert.equal(resolveProfile([], { DWLF_TOOL_PROFILE: '' }), 'full');
  assert.equal(resolveProfile([], { DWLF_TOOL_PROFILE: '  ' }), 'full');
  assert.throws(() => resolveProfile(['--profile='], {}), /Unknown DWLF tool profile ""/);
});

test('full registers every tool, exactly as registerAll offers them', () => {
  const direct = fakeServer();
  registerAll(direct.server, {});
  const viaFull = fakeServer();
  registerAll(profiledServer(viaFull.server, 'full'), {});
  assert.deepEqual(viaFull.tools, direct.tools);
  assert.ok(direct.tools.length > 100);
});

test('every Block tool exists (a renamed tool fails here, not silently in the profile)', () => {
  const offered = new Set();
  const f = fakeServer();
  registerAll(profiledServer(f.server, 'block', offered), {});
  const missing = [...BLOCK_TOOLS].filter((t) => !offered.has(t));
  assert.deepEqual(missing, []);
  assert.deepEqual([...f.tools].sort(), [...BLOCK_TOOLS].sort());
  assert.ok(f.resources.length > 0, 'resources pass through the profile');
});

test('no Block tool sends the agent to a tool the profile hides', () => {
  const desc = {};
  registerAll({ tool: (name, d) => { desc[name] = String(d); }, resource: () => {} }, {});
  const hiddenRefs = [];
  for (const t of BLOCK_TOOLS) {
    for (const ref of desc[t].match(/dwlf_[a-z_]+/g) || []) {
      if (desc[ref] !== undefined && !BLOCK_TOOLS.has(ref)) {hiddenRefs.push(`${t} → ${ref}`);}
    }
  }
  assert.deepEqual(hiddenRefs, []);
  const refsInInstructions = (PROFILE_INSTRUCTIONS.block.match(/dwlf_[a-z_]+/g) || []).filter((r) => !BLOCK_TOOLS.has(r));
  assert.deepEqual(refsInInstructions, []);
});

test('block leaves out the retail, metals and trade-journal tools', () => {
  // dwlf_get_intelligence: SPT refuses it to a Block key (403 NOT_ON_BLOCK; DWLF-686 decision D).
  for (const t of ['dwlf_create_trade', 'dwlf_get_portfolio', 'dwlf_get_daily_briefing', 'dwlf_add_to_watchlist', 'dwlf_get_holdings',
    'dwlf_get_intelligence']) {
    assert.equal(BLOCK_TOOLS.has(t), false, t);
  }
  assert.match(PROFILE_INSTRUCTIONS.block, /conditions, not calls/i);
  // The plan→family map is the API's (G22): the instructions point to it and never restate it.
  assert.match(PROFILE_INSTRUCTIONS.block, /\/v2\/public\/block\/pricing/);
  assert.doesNotMatch(PROFILE_INSTRUCTIONS.block, /Free: |cost basis and simple TA/);
  assert.equal(PROFILE_INSTRUCTIONS.full, null);
});

const listTools = (args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), ...args], {
    env: { ...process.env, DWLF_API_KEY: 'test', ...env }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 8_000,
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => {
    out += c;
    const line = out.split('\n').find((l) => l.includes('"id":2'));
    if (line) {
      const init = JSON.parse(out.split('\n').find((l) => l.includes('"id":1')));
      resolve({ tools: JSON.parse(line).result.tools.map((t) => t.name), instructions: init.result.instructions });
      child.kill();
    }
  });
  child.stderr.on('data', (c) => { err += c; });
  child.on('exit', (code) => reject(new Error(`server exited (${code}): ${err}`)));
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
});

test('the built server honours --profile block end to end, with its instructions', { timeout: 10_000 }, async () => {
  const { tools, instructions } = await listTools(['--profile', 'block']);
  assert.deepEqual(tools.sort(), [...BLOCK_TOOLS].sort());
  assert.match(instructions, /dwlf_get_conditions/);
});

test('an unknown profile exits non-zero with the reason', { timeout: 10_000 }, async () => {
  await assert.rejects(listTools([], { DWLF_TOOL_PROFILE: 'nope' }), /exited \(1\).*Unknown DWLF tool profile "nope"/s);
});

test('server.json (MCP Registry) agrees with package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const srv = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
  assert.equal(srv.name, pkg.mcpName);
  assert.match(srv.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(srv.description.length >= 1 && srv.description.length <= 100, `description is ${srv.description.length} chars`);
  assert.equal(srv.version, pkg.version);
  assert.equal(srv.packages.length, 1);
  const [npm] = srv.packages;
  assert.equal(npm.registryType, 'npm');
  assert.equal(npm.identifier, pkg.name);
  assert.equal(npm.version, pkg.version);
  assert.equal(npm.transport.type, 'stdio');
  const env = Object.fromEntries(npm.environmentVariables.map((v) => [v.name, v]));
  assert.equal(env.DWLF_API_KEY.isRequired, true);
  assert.equal(env.DWLF_API_KEY.isSecret, true);
  assert.deepEqual(env.DWLF_TOOL_PROFILE.choices, ['full', 'block']);
});
