import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCK_TOOLS } from '../dist/profiles.js';

// DWLF-622: the local-only hosted-MCP spike (spike/hosted-http.mjs). Exercises the HTTP shape only: no call
// reaches the DWLF API (tools/list, and a tool answered from bundled data).
// The OS picks the port (--port 0), and the spike prints it, so parallel runs never collide.
let PORT;
let BASE;
let child;

before(async () => {
  // DWLF_API_URL points nowhere, so nothing in this test can reach the real API (the catalogue tool's engine
  // read then answers `inEngine: null`, which is the point: the spike is about the transport).
  child = spawn(process.execPath, [fileURLToPath(new URL('../spike/hosted-http.mjs', import.meta.url)), '--port', '0'], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, DWLF_API_URL: 'http://127.0.0.1:9' },
  });
  await new Promise((resolve, reject) => {
    child.stderr.on('data', (d) => {
      const m = String(d).match(/hosted-MCP spike .* port=(\d+)/);
      if (m) { PORT = Number(m[1]); BASE = `http://127.0.0.1:${PORT}`; resolve(); }
    });
    child.on('exit', (code) => reject(new Error(`spike exited ${code}`)));
    setTimeout(() => reject(new Error('spike did not start')), 5000);
  });
});
after(() => child?.kill());

const rpc = (method, params = {}, { token = 'dwlf_sk_test', headers = {} } = {}) => fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-11-25',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});

const INIT = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } };

test('no credential → 401 with a resource_metadata challenge, and the metadata is served', async () => {
  const res = await rpc('initialize', INIT, { token: null });
  assert.equal(res.status, 401);
  const challenge = res.headers.get('www-authenticate');
  assert.match(challenge, /^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
  assert.equal(prm.resource, `${BASE}/mcp`);
  assert.ok(Array.isArray(prm.authorization_servers) && prm.authorization_servers.length === 1);
});

test('POST only: GET and DELETE are 405', async () => {
  for (const method of ['GET', 'DELETE']) {
    const res = await fetch(`${BASE}/mcp`, { method, headers: { Authorization: 'Bearer x' } });
    assert.equal(res.status, 405, method);
  }
});

test('a foreign Origin is refused (DNS rebinding); a local one is not', async () => {
  assert.equal((await rpc('initialize', INIT, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await rpc('initialize', INIT, { headers: { Origin: `http://localhost:${PORT}` } })).status, 200);
});

test('stateless: each POST stands alone; no session id is minted', async () => {
  const init = await rpc('initialize', INIT);
  assert.equal(init.status, 200);
  assert.equal(init.headers.get('mcp-session-id'), null);
  const initBody = await init.json();
  assert.match(initBody.result.instructions, /conditions/i);

  const list = await (await rpc('tools/list')).json();
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(), [...BLOCK_TOOLS].sort());

  const call = await (await rpc('tools/call', { name: 'dwlf_describe_onchain_events', arguments: { pack: 'fees' } })).json();
  const payload = JSON.parse(call.result.content[0].text);
  assert.equal(payload.packState.pack, 'fees');
  assert.equal(payload.packState.inEngine, null); // the API is unreachable here, and says so
});

test('an oversized body is refused before any server is built', async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer x' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(300 * 1024) } }),
  });
  assert.equal(res.status, 413);
});
