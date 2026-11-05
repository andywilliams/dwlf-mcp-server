import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadHostedSettings } from '../dist/hosted/config.js';
import { TOOL_SCOPES, HOSTED_TOOLS, HOSTED_EXCLUDED, HOSTED_SCOPES, missingScopes } from '../dist/hosted/scopes.js';
import { bearerToken, challenge, metadataPath } from '../dist/hosted/auth.js';
import { canonicalJson, CallLimiter } from '../dist/hosted/limits.js';
import { UpstreamCredentials, CredentialUnavailableError } from '../dist/hosted/credentials.js';
import { MemoryStore, accountHash, credentialKey } from '../dist/hosted/store.js';
import { BLOCK_TOOLS } from '../dist/profiles.js';
import { DWLFClient } from '../dist/client.js';
import { createTokenVerifier, AuthServerUnavailableError, InvalidTokenError } from '../dist/hosted/auth.js';
import { logLine } from '../dist/hosted/lambda.js';
import { errors, createRemoteJWKSet, SignJWT, generateKeyPair } from 'jose';
import { createServer } from 'node:http';

// DWLF-622 hosted MCP: the pieces under the handler.

const ENV = {
  HOSTED_MCP_ENABLED: 'true',
  HOSTED_MCP_RESOURCE: 'https://mcp.block.dwlf.co.uk/mcp',
  HOSTED_MCP_ISSUER: 'https://api.dwlf.co.uk',
  HOSTED_MCP_JWKS_URI: 'https://api.dwlf.co.uk/.well-known/jwks.json',
  HOSTED_MCP_API_BASE_URL: 'https://api.dwlf.co.uk',
  HOSTED_MCP_TABLE: 'HostedMcp',
  HOSTED_MCP_KMS_KEY_ID: 'alias/hosted-mcp',
  HOSTED_MCP_TOKEN_EXCHANGE_URL: 'https://api.dwlf.co.uk/oauth/token',
  HOSTED_MCP_REVOCATION_URL: 'https://api.dwlf.co.uk/oauth/revoke',
  HOSTED_MCP_EXCHANGE_CLIENT_ID: 'hosted-mcp',
  HOSTED_MCP_EXCHANGE_CLIENT_SECRET_PARAM: '/hosted-mcp/exchange-secret',
};

// ── config ──────────────────────────────────────────────────────────────────
test('config: off unless HOSTED_MCP_ENABLED is exactly "true", and nothing else is read when off', () => {
  for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes']) assert.deepEqual(loadHostedSettings({ HOSTED_MCP_ENABLED: v }), { enabled: false });
});

test('config: on, a missing or non-https setting is a startup error, not a default', () => {
  const c = loadHostedSettings(ENV);
  assert.equal(c.enabled, true);
  assert.deepEqual(c.limits, { callsPerMinute: 60, repeatsPerMinute: 10, maxInFlight: 4 });
  assert.equal(c.callDeadlineMs, 24000);
  assert.equal(c.upstreamTimeoutMs, 20000);
  for (const name of Object.keys(ENV).filter((k) => k !== 'HOSTED_MCP_ENABLED')) {
    assert.throws(() => loadHostedSettings({ ...ENV, [name]: '' }), new RegExp(name));
  }
  assert.throws(() => loadHostedSettings({ ...ENV, HOSTED_MCP_JWKS_URI: 'http://api.dwlf.co.uk/jwks' }), /must be https/);
  assert.throws(() => loadHostedSettings({ ...ENV, HOSTED_MCP_RESOURCE: 'https://mcp.block.dwlf.co.uk/mcp#x' }), /fragment/);
  assert.throws(() => loadHostedSettings({ ...ENV, HOSTED_MCP_CALLS_PER_MINUTE: '0' }), /positive integer/);
  assert.throws(() => loadHostedSettings({ ...ENV, HOSTED_MCP_UPSTREAM_TIMEOUT_MS: '24000' }), /below/);
});

// ── scopes ──────────────────────────────────────────────────────────────────
test('scopes: every hosted tool has an entry; the hosted set is the Block profile less the exclusions', () => {
  for (const tool of HOSTED_TOOLS) assert.ok(Object.hasOwn(TOOL_SCOPES, tool), `${tool} has no scope entry`);
  for (const tool of Object.keys(HOSTED_EXCLUDED)) assert.ok(BLOCK_TOOLS.has(tool) && !HOSTED_TOOLS.has(tool));
  assert.equal(HOSTED_TOOLS.size, BLOCK_TOOLS.size - Object.keys(HOSTED_EXCLUDED).length);
  assert.ok(!HOSTED_SCOPES.includes('markets:candles'), 'no owner-only scope is advertised');
});

/**
 * Each hosted tool's calls, read from its source: `client.get('/path…')`, `client.post(\`/x/${id}\`)` …, in the span
 * between its `server.tool(` and the next one. A template expression becomes one path segment.
 */
function toolCalls() {
  const calls = new Map();
  for (const file of fs.readdirSync(new URL('../src/tools/', import.meta.url))) {
    const src = fs.readFileSync(new URL(`../src/tools/${file}`, import.meta.url), 'utf8');
    const parts = src.split(/server\.tool\(\s*'/);
    for (const part of parts.slice(1)) {
      const name = part.slice(0, part.indexOf("'"));
      const found = [];
      const re = /client\.(get|post|put|patch|delete|deleteWithBody)(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*(?:'([^']*)'|`((?:[^`$]|\$\{(?:[^{}]|\{[^}]*\})*\})*)`)/g;
      for (let m = re.exec(part); m; m = re.exec(part)) {
        const method = m[1] === 'deleteWithBody' ? 'DELETE' : m[1].toUpperCase();
        const path = (m[2] ?? m[3]).replace(/\$\{(?:[^{}]|\{[^}]*\})*\}/g, 'X').replace(/\?.*$/, '');
        found.push({ method, path: `/v2${path}` });
      }
      calls.set(name, found);
    }
  }
  return calls;
}

test("scopes: every route a hosted tool calls is in SPT's route table, and the tool's entry covers its permission", () => {
  const { routes, source } = JSON.parse(fs.readFileSync(new URL('./fixtures/spt-routes.json', import.meta.url), 'utf8'));
  const toRe = (p) => new RegExp(`^${p.replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
  const calls = toolCalls();
  // Tools that call no DWLF route through the caller's client: the academy CDN and the public node catalogue.
  const NO_CALLS = new Set(['dwlf_search_academy', 'dwlf_list_academy_tracks', 'dwlf_get_academy_lesson', 'dwlf_describe_onchain_events', 'dwlf_describe_strategy_nodes']);
  // Tools that build their path in a variable the parser can't follow: their calls, stated here and checked the same way.
  const STATED = {
    dwlf_explain_event: [{ method: 'GET', path: '/v2/events/X/explain' }, { method: 'GET', path: '/v2/events/X/explain/occurrences' }],
  };
  for (const [tool, list] of Object.entries(STATED)) calls.set(tool, list);
  const problems = [];
  for (const tool of HOSTED_TOOLS) {
    const found = calls.get(tool);
    if (!found) { problems.push(`${tool}: not found in src/tools`); continue; }
    if (!found.length && !NO_CALLS.has(tool)) problems.push(`${tool}: no client call found (extend the parser, or list it in NO_CALLS)`);
    for (const c of found) {
      // A literal segment beats a parameter (Express route order), as SPT declares them.
      const candidates = routes.filter((r) => r.method === c.method && toRe(r.path).test(c.path));
      const route = candidates.find((r) => !r.path.includes(':')) ?? candidates[0];
      if (!route) { problems.push(`${tool}: ${c.method} ${c.path} matches no SPT route (${source})`); continue; }
      if (!route.permissions) continue; // public, or checked in the handler
      const covered = TOOL_SCOPES[tool].some((alts) => alts.some((s) => route.permissions.includes(s)));
      if (!covered) problems.push(`${tool}: ${c.method} ${route.path} needs one of ${route.permissions.join('|')}; table has ${JSON.stringify(TOOL_SCOPES[tool])}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('missingScopes: one entry per unmet requirement, alternatives honoured', () => {
  assert.deepEqual(missingScopes('dwlf_get_regime', new Set(['markets:read'])), []);
  assert.deepEqual(missingScopes('dwlf_get_regime', new Set()), ['markets:read']);
  assert.deepEqual(missingScopes('dwlf_evaluate_strategy', new Set(['strategies:write'])), []);
  assert.deepEqual(missingScopes('dwlf_evaluate_strategy', new Set(['strategies:read'])), ['evaluations:write']);
  assert.deepEqual(missingScopes('dwlf_search_academy', new Set()), []);
  assert.deepEqual(missingScopes('no_such_tool', new Set()), []);
});

// ── auth helpers ────────────────────────────────────────────────────────────
test('bearerToken, metadataPath, challenge', () => {
  assert.equal(bearerToken('Bearer abc.def-ghi_'), 'abc.def-ghi_');
  assert.equal(bearerToken('bearer abc'), 'abc');
  assert.equal(bearerToken('ApiKey dwlf_sk_x'), null);
  assert.equal(bearerToken('Bearer a b'), null);
  assert.equal(bearerToken(null), null);
  assert.equal(metadataPath('https://mcp.block.dwlf.co.uk/mcp'), '/.well-known/oauth-protected-resource/mcp');
  assert.equal(metadataPath('https://mcp.block.dwlf.co.uk/'), '/.well-known/oauth-protected-resource');
  assert.equal(
    challenge('https://m.test/mcp', { error: 'insufficient_scope', scopes: ['a:b', 'c:d'], description: 'say "hi"' }),
    'Bearer resource_metadata="https://m.test/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="a:b c:d", error_description="say hi"',
  );
});

// ── limits ──────────────────────────────────────────────────────────────────
test('canonicalJson: key order does not change the hash input; undefined members drop', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }), canonicalJson({ a: { d: [1, { y: 2, z: 1 }] }, b: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: '1' }));
});

test('limits: a store failure lets the call through (SPT still enforces the plan) and is logged', async () => {
  const logs = [];
  const broken = { increment: async () => { throw new Error('ddb down'); }, acquireSlot: async () => null, releaseSlot: async () => {} };
  const limiter = new CallLimiter(broken, { callsPerMinute: 1, repeatsPerMinute: 1, maxInFlight: 1 }, 1000, (e) => logs.push(e));
  const a = await limiter.admit({ issuer: 'i', sub: 's', clientId: 'c', scopes: new Set(), expiresAt: 0 }, 't', {});
  assert.equal(a.ok, true);
  assert.equal(logs[0].event, 'hosted-mcp-limits-unavailable');
});

test('limits: a lapsed in-flight lease is free again (a crashed request does not hold its slot)', async () => {
  const store = new MemoryStore();
  const limiter = new CallLimiter(store, { callsPerMinute: 100, repeatsPerMinute: 100, maxInFlight: 1 }, 1000, () => {});
  const caller = { issuer: 'i', sub: 's', clientId: 'c', scopes: new Set(), expiresAt: 0 };
  const t0 = 1_000_000;
  assert.equal((await limiter.admit(caller, 't', { n: 1 }, t0)).ok, true); // never released
  assert.equal((await limiter.admit(caller, 't', { n: 2 }, t0 + 500)).ok, false);
  assert.equal((await limiter.admit(caller, 't', { n: 3 }, t0 + 1001)).ok, true);
});

// ── credentials ─────────────────────────────────────────────────────────────
const sealer = { seal: async (k) => Buffer.from(k), open: async (c) => Buffer.from(c).toString() };
const ISS = 'https://api.dwlf.co.uk';
const ID = { issuer: ISS, sub: 'acct-1', clientId: 'cli' };
const caller = (scopes, issuedAt = 1000, issuer = ISS) => ({ issuer, sub: 'acct-1', clientId: 'cli', scopes: new Set(scopes), expiresAt: 0, issuedAt });
const minterWith = (scopesFor) => {
  let n = 0;
  return { minted: [], revoked: [], expiresIn: 86_400_000, async exchange() { n += 1; const k = { apiKey: `k${n}`, keyId: `id${n}`, scopes: scopesFor(n), expiresAt: Date.now() + this.expiresIn }; this.minted.push(k); return k; }, async revoke(k) { this.revoked.push(k); } };
};

test('credentials: a racing re-mint loses the conditional write, revokes its own key, and uses the winner', async () => {
  const store = new MemoryStore();
  const minter = minterWith(() => ['markets:read']);
  const creds = new UpstreamCredentials(store, minter, sealer, () => {});
  // Two requests both read "no record", both exchange; the first write wins.
  const [a, b] = await Promise.all([creds.resolve(caller(['markets:read']), 't'), creds.resolve(caller(['markets:read']), 't')]);
  assert.equal(minter.minted.length, 2);
  assert.equal(a.keyId, b.keyId, 'both requests end up on the stored key');
  assert.equal(minter.revoked.length, 1, 'the loser revoked its surplus key');
  assert.notEqual(minter.revoked[0], (await store.getCredential(ID)).keyId);
});

test('credentials: a key broader than the grant is refused and revoked', async () => {
  const minter = minterWith(() => ['markets:read', 'strategies:write']);
  const creds = new UpstreamCredentials(new MemoryStore(), minter, sealer, () => {});
  await assert.rejects(creds.resolve(caller(['markets:read']), 't'), CredentialUnavailableError);
  assert.deepEqual(minter.revoked, ['k1']);
});

test('credentials: a narrowed grant re-mints too (the key is never broader than the live grant)', async () => {
  const store = new MemoryStore();
  let scopes = ['markets:read', 'events:read'];
  const minter = minterWith(() => scopes);
  const creds = new UpstreamCredentials(store, minter, sealer, () => {});
  await creds.resolve(caller(scopes), 't');
  scopes = ['markets:read'];
  const narrowed = await creds.resolve(caller(scopes, 2000), 't');
  assert.equal(narrowed.keyId, 'id2');
  assert.deepEqual(minter.revoked, ['k1']);
  assert.equal((await store.getCredential(ID)).version, 2);
});

test('store: the account (issuer + sub) is hashed in every key; forget only drops the key it was told about', async () => {
  const store = new MemoryStore();
  const creds = new UpstreamCredentials(store, minterWith(() => ['markets:read']), sealer, () => {});
  const c = caller(['markets:read']);
  const { keyId } = await creds.resolve(c, 't');
  assert.ok([...store.credentials.keys()].every((k) => !k.includes('acct-1') && k.includes(accountHash(ID))));
  // The same sub from another issuer is another account (BA-41 moves issuers): its own record, never this one.
  assert.notEqual(credentialKey(ID), credentialKey({ ...ID, issuer: 'https://identity.dwlf.co.uk' }));
  await creds.forget(c, 'some-older-key');
  assert.equal(store.credentials.size, 1);
  await creds.forget(c, keyId);
  assert.equal(store.credentials.size, 0);
});

test('credentials: an expired record is absent, and the next call re-mints over it', async () => {
  let now = 1_000_000;
  const store = new MemoryStore(() => now);
  const minter = minterWith(() => ['markets:read']);
  minter.expiresIn = 60_000;
  const creds = new UpstreamCredentials(store, { ...minter, exchange: async () => { const k = await minter.exchange(); return { ...k, expiresAt: now + 60_000 }; }, revoke: (k) => minter.revoke(k) }, sealer, () => {}, () => now);
  await creds.resolve(caller(['markets:read']), 't');
  now += 61_000;
  // (an expired record is absent whatever the token)
  assert.equal(await store.getCredential(ID), null);
  const again = await creds.resolve(caller(['markets:read']), 't');
  assert.equal(again.keyId, 'id2');
});

test('credentials: a key that arrives already expired is refused and revoked', async () => {
  const minter = minterWith(() => ['markets:read']);
  minter.expiresIn = -1;
  const creds = new UpstreamCredentials(new MemoryStore(), minter, sealer, () => {});
  await assert.rejects(creds.resolve(caller(['markets:read']), 't'), /already expired/);
  assert.deepEqual(minter.revoked, ['k1']);
});

test('credentials: an OLDER token (pre-step-up, still valid) reuses the newer grant\'s key; no flip-flop', async () => {
  const store = new MemoryStore();
  const minter = minterWith(() => ['markets:read', 'strategies:read']);
  const creds = new UpstreamCredentials(store, minter, sealer, () => {});
  await creds.resolve(caller(['markets:read', 'strategies:read'], 2000), 't'); // the step-up token
  for (let i = 0; i < 3; i += 1) {
    await creds.resolve(caller(['markets:read'], 1000), 't'); // the older token, still live
    await creds.resolve(caller(['markets:read', 'strategies:read'], 2000), 't');
  }
  assert.equal(minter.minted.length, 1);
  assert.deepEqual(minter.revoked, []);
});

test('credentials: an AS that mints narrower than the grant is reused, not re-minted on every call', async () => {
  const minter = minterWith(() => ['markets:read']); // e.g. it drops a scope it doesn't map
  const creds = new UpstreamCredentials(new MemoryStore(), minter, sealer, () => {});
  for (let i = 0; i < 3; i += 1) await creds.resolve(caller(['markets:read', 'openid']), 't');
  assert.equal(minter.minted.length, 1);
});

// ── auth: an outage of the AS's keys is not an invalid token ───────────────
test('verifier: a JWKS timeout, a non-200 JWKS or a network failure → AuthServerUnavailableError (503, not 401)', async () => {
  const cfg = { issuer: 'https://auth.test', jwksUri: 'https://auth.test/jwks', resource: 'https://mcp.test/mcp' };
  // A well-formed but unverifiable JWT: the key lookup is where each case fails.
  const token = 'eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCIsImtpZCI6ImsxIn0.eyJzdWIiOiJ4In0.c2ln';
  for (const failure of [new errors.JWKSTimeout(), new errors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response'), new TypeError('fetch failed')]) {
    const verify = createTokenVerifier(cfg, async () => { throw failure; });
    await assert.rejects(verify(token), AuthServerUnavailableError);
  }
  const noKey = createTokenVerifier(cfg, async () => { throw new errors.JWKSNoMatchingKey(); });
  await assert.rejects(noKey(token), InvalidTokenError);
});

test("verifier against jose's REAL remote key set: a 500, a non-JSON body and a hang are each 'unavailable', not 'invalid'", async () => {
  // BND-2: the 503-vs-401 split leans on how jose reports a remote JWKS failure. Pin it on the real thing.
  const modes = ['500', 'html', 'hang'];
  let mode = '';
  const server = createServer((req, res) => {
    if (mode === '500') { res.writeHead(500); res.end('boom'); return; }
    if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); return; }
    // hang: never answer (the set's timeout fires)
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { privateKey } = await generateKeyPair('ES256');
    const cfg = { issuer: 'https://auth.test', jwksUri: 'https://unused', resource: 'https://mcp.test/mcp' };
    const token = await new SignJWT({ client_id: 'c' }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'k1' })
      .setIssuer(cfg.issuer).setAudience(cfg.resource).setSubject('s').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    for (mode of modes) {
      const keys = createRemoteJWKSet(new URL(`http://127.0.0.1:${server.address().port}/jwks`), { timeoutDuration: 300, cooldownDuration: 0 });
      await assert.rejects(createTokenVerifier(cfg, keys)(token), AuthServerUnavailableError, mode);
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('logLine: one bare JSON object per line, no runtime prefix', () => {
  let out = '';
  logLine({ event: 'hosted-mcp-unhandled', x: 1 }, (l) => { out += l; });
  assert.ok(out.endsWith('\n'));
  const parsed = JSON.parse(out);
  assert.equal(parsed.event, 'hosted-mcp-unhandled');
});

// ── client options the host relies on ───────────────────────────────────────
test('DWLFClient: timeoutMs must be finite and positive (axios reads 0 as no timeout)', () => {
  for (const bad of [0, -1, Infinity, NaN]) assert.throws(() => new DWLFClient({ apiKey: 'k', timeoutMs: bad }), /finite positive/);
  assert.equal(new DWLFClient({ apiKey: 'k' }).remainingMs(), Infinity);
  const c = new DWLFClient({ apiKey: 'k', deadlineAt: 10_000 });
  assert.equal(c.remainingMs(4_000), 6_000);
});
