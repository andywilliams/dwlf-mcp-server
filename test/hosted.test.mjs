import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, decodeJwt } from 'jose';
import { createHostedHandler } from '../dist/hosted/handler.js';
import { createTokenVerifier } from '../dist/hosted/auth.js';
import { UpstreamCredentials } from '../dist/hosted/credentials.js';
import { CallLimiter } from '../dist/hosted/limits.js';
import { MemoryStore } from '../dist/hosted/store.js';
import { HOSTED_TOOLS, HOSTED_SCOPES } from '../dist/hosted/scopes.js';
import { toRequest, toResult } from '../dist/hosted/lambda.js';

// DWLF-622: the hosted endpoint end to end — a real token verifier (local ES256 keys), the real limiter and credential
// logic on an in-memory store, a fake authorization server (minter), and a stub DWLF API on 127.0.0.1.

const RESOURCE = 'https://mcp.test/mcp';
const ISSUER = 'https://auth.test';
let keys;
let jwks;
let api;
let apiBase;
const seen = []; // every upstream request: { path, auth }

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

before(async () => {
  keys = await generateKeyPair('ES256');
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'ES256' }] });
  api = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    seen.push({ path: url.pathname + url.search, auth: req.headers.authorization });
    if (url.pathname === '/v2/regime/SLOW') return setTimeout(() => json(res, 200, { slow: true }), 3000);
    if (url.pathname === '/v2/regime/REVOKED') return json(res, 401, { error: 'Unauthorized' });
    if (url.pathname.startsWith('/v2/regime/')) return json(res, 200, { regime: 'bull', symbol: url.pathname.split('/').pop() });
    if (url.pathname === '/v2/events') {
      const page = Number(url.searchParams.get('cursor')?.slice(1) ?? 0);
      return setTimeout(() => json(res, 200, { events: [{ page }], cursor: `c${page + 1}` }), 700);
    }
    if (url.pathname === '/v2/quotes') {
      return json(res, 429, { success: false, error: 'Daily limit reached', upgradeUrl: 'https://block.dwlf.co.uk/pricing', plans: [] });
    }
    return json(res, 404, { error: 'not found' });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${api.address().port}`;
});

after(() => api.close());

const sign = async ({ scope = 'markets:read events:read', sub = 'acct-1', clientId = 'https://client.example/meta.json', aud = RESOURCE, iss = ISSUER, typ = 'at+jwt', exp = '10m', omit = [] } = {}) => {
  const claims = { scope, client_id: clientId };
  for (const k of omit) delete claims[k];
  let jwt = new SignJWT(claims).setProtectedHeader({ alg: 'ES256', typ, kid: 'k1' }).setIssuedAt().setExpirationTime(exp);
  if (iss) jwt = jwt.setIssuer(iss);
  if (aud) jwt = jwt.setAudience(aud);
  if (sub) jwt = jwt.setSubject(sub);
  return jwt.sign(keys.privateKey);
};

const configFor = (overrides = {}) => ({
  enabled: true,
  resource: RESOURCE,
  issuer: ISSUER,
  jwksUri: `${ISSUER}/jwks`,
  apiBaseUrl: apiBase,
  tableName: 't',
  kmsKeyId: 'k',
  tokenExchangeUrl: `${ISSUER}/token`,
  revocationUrl: `${ISSUER}/revoke`,
  exchangeClientId: 'hosted-mcp',
  exchangeClientSecretParam: '/p',
  defaultScopes: ['markets:read', 'events:read'],
  limits: { callsPerMinute: 60, repeatsPerMinute: 10, maxInFlight: 4 },
  callDeadlineMs: 2000,
  upstreamTimeoutMs: 1500,
  maxBodyBytes: 256 * 1024,
  resourceName: 'DWLF Block (test)',
  ...overrides,
});

/** A fake authorization server: mints `dwlf_sk_managed_<n>` with the token's scopes, and records revocations. */
const fakeMinter = () => {
  let n = 0;
  return {
    minted: [],
    revoked: [],
    async exchange(token) {
      n += 1;
      const key = { apiKey: `dwlf_sk_managed_${n}`, keyId: `key-${n}`, scopes: String(decodeJwt(token).scope ?? '').split(' ').filter(Boolean), expiresAt: Date.now() + 86_400_000 };
      this.minted.push(key);
      return key;
    },
    async revoke(apiKey) { this.revoked.push(apiKey); },
  };
};
const fakeSealer = {
  async seal(apiKey, id) { return Buffer.from(`${id.issuer}|${id.sub}|${id.clientId}|${apiKey}`); },
  async open(ct, id) {
    const [issuer, sub, clientId, apiKey] = Buffer.from(ct).toString().split('|');
    assert.equal(issuer, id.issuer); assert.equal(sub, id.sub); assert.equal(clientId, id.clientId);
    return apiKey;
  },
};

const setup = (configOverrides = {}, { minter = fakeMinter(), verify } = {}) => {
  const config = configFor(configOverrides);
  const store = new MemoryStore();
  const logs = [];
  const log = (e) => logs.push(e);
  const handler = createHostedHandler(config, {
    verify: verify ?? createTokenVerifier(config, jwks),
    credentials: new UpstreamCredentials(store, minter, fakeSealer, log),
    limiter: new CallLimiter(store, config.limits, 5000, log),
    shared: {},
    version: 'test',
    log,
  });
  return { config, store, minter, logs, handler };
};

let nextId = 1;
const post = (handler, message, { token, origin, raw } = {}) => handler(new Request(RESOURCE, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(origin ? { origin } : {}),
  },
  body: raw ?? JSON.stringify({ jsonrpc: '2.0', id: nextId++, ...message }),
}));
const call = (handler, name, args, opts) => post(handler, { method: 'tools/call', params: { name, arguments: args } }, opts);
const textOf = async (res) => (await res.json()).result.content[0].text;

test('flag off: every path is 404, and nothing else is built', async () => {
  const handler = createHostedHandler({ enabled: false });
  for (const path of ['/mcp', '/.well-known/oauth-protected-resource/mcp', '/']) {
    const res = await handler(new Request(`https://mcp.test${path}`));
    assert.equal(res.status, 404);
  }
  assert.throws(() => createHostedHandler(configFor()), /dependencies are required/);
});

test('RFC 9728 metadata at the path-suffixed and the root well-known path', async () => {
  const { handler } = setup();
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    const res = await handler(new Request(`https://mcp.test${path}`));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resource, RESOURCE);
    assert.deepEqual(body.authorization_servers, [ISSUER]);
    assert.deepEqual(body.scopes_supported, HOSTED_SCOPES);
    assert.ok(!body.scopes_supported.includes('offline_access')); // spec: the resource does not advertise it
  }
});

test('GET/DELETE on /mcp → 405; an unknown path → 404; any Origin → 403 (server-side clients only)', async () => {
  const { handler } = setup();
  assert.equal((await handler(new Request(RESOURCE, { method: 'GET' }))).status, 405);
  assert.equal((await handler(new Request(RESOURCE, { method: 'DELETE' }))).status, 405);
  assert.equal((await handler(new Request('https://mcp.test/other', { method: 'POST' }))).status, 404);
  const token = await sign();
  assert.equal((await post(handler, { method: 'ping' }, { token, origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(handler, { method: 'ping' }, { token, origin: 'https://claude.ai' })).status, 403);
  assert.equal((await post(handler, { method: 'ping' }, { token })).status, 200);
});

test('no token → 401 with a resource_metadata challenge and the default scopes', async () => {
  const { handler } = setup();
  const res = await post(handler, { method: 'initialize' });
  assert.equal(res.status, 401);
  const www = res.headers.get('www-authenticate');
  assert.match(www, /^Bearer resource_metadata="https:\/\/mcp\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.match(www, /scope="markets:read events:read"/);
});

test('a token for another audience, issuer, type, or expired, or without client_id → 401 invalid_token (never 403)', async () => {
  const { handler, logs } = setup();
  const bad = [
    await sign({ aud: 'https://api.dwlf.co.uk/v2' }), // passthrough of a token minted for the API
    await sign({ iss: 'https://evil.example' }),
    await sign({ typ: 'JWT' }), // an ID token or other JWT is not an access token
    await sign({ exp: Math.floor(Date.now() / 1000) - 120 }),
    await sign({ omit: ['client_id'] }),
    'not.a.jwt',
  ];
  for (const token of bad) {
    const res = await post(handler, { method: 'ping' }, { token });
    assert.equal(res.status, 401, token.slice(0, 20));
    assert.match(res.headers.get('www-authenticate'), /error="invalid_token"/);
  }
  assert.ok(logs.every((l) => !JSON.stringify(l).includes('eyJ')), 'no token in the logs');
});

test('initialize and tools/list work statelessly; the list is exactly the hosted tool set', async () => {
  const { handler, minter } = setup();
  const token = await sign();
  const init = await post(handler, { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, { token });
  assert.equal(init.status, 200);
  assert.equal(init.headers.get('mcp-session-id'), null);
  const initBody = await init.json();
  assert.match(initBody.result.instructions, /conditions, not calls/i);
  const list = await post(handler, { method: 'tools/list', params: {} }, { token });
  const names = (await list.json()).result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...HOSTED_TOOLS].sort());
  assert.ok(!names.includes('dwlf_register_agent') && !names.includes('dwlf_get_market_data'));
  assert.equal(minter.minted.length, 0, 'no credential is minted for protocol messages');
});

test('a tool call runs on the managed key, never the bearer token; the key is minted once and reused', async () => {
  const { handler, minter, store } = setup();
  const token = await sign();
  seen.length = 0;
  for (const symbol of ['BTC', 'ETH']) {
    const res = await call(handler, 'dwlf_get_regime', { symbol }, { token });
    assert.equal(res.status, 200);
    assert.match(await textOf(res), /bull/);
  }
  assert.equal(minter.minted.length, 1);
  assert.deepEqual(seen.map((s) => s.auth), ['ApiKey dwlf_sk_managed_1', 'ApiKey dwlf_sk_managed_1']);
  assert.ok(seen.every((s) => !s.auth.includes(token)));
  assert.equal(store.credentials.size, 1);
});

test('a tool needing a scope the token lacks → 403 insufficient_scope naming the held and the needed scopes', async () => {
  const { handler, minter } = setup();
  const token = await sign({ scope: 'markets:read' });
  const res = await call(handler, 'dwlf_list_strategies', {}, { token });
  assert.equal(res.status, 403);
  const www = res.headers.get('www-authenticate');
  assert.match(www, /error="insufficient_scope"/);
  assert.match(www, /scope="markets:read strategies:read"/);
  assert.match(www, /resource_metadata=/);
  assert.equal(minter.minted.length, 0);
});

test('a step-up re-mints a key with the new scopes, swaps it in, then revokes the old one', async () => {
  const { handler, minter } = setup();
  await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token: await sign({ scope: 'markets:read' }) });
  await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token: await sign({ scope: 'markets:read strategies:read' }) });
  assert.equal(minter.minted.length, 2);
  assert.deepEqual(minter.revoked, ['dwlf_sk_managed_1']);
});

test('the DWLF API refusing the managed key (401) drops it, and the next call re-mints', async () => {
  const { handler, minter, store } = setup();
  const token = await sign();
  await call(handler, 'dwlf_get_regime', { symbol: 'REVOKED' }, { token });
  assert.equal(store.credentials.size, 0);
  await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token });
  assert.equal(minter.minted.length, 2);
});

test("SPT's plan-limit 429 reaches the agent as a tool error carrying the upgrade URL", async () => {
  const { handler } = setup();
  const res = await call(handler, 'dwlf_get_quote', { symbol: 'BTC' }, { token: await sign() });
  const text = await textOf(res);
  assert.match(text, /HTTP 429/);
  assert.match(text, /upgrade at https:\/\/block\.dwlf\.co\.uk\/pricing/);
});

test('the loop guard: the same tool and arguments more than N times a minute is a counted tool error', async () => {
  const { handler, config } = setup({ limits: { callsPerMinute: 60, repeatsPerMinute: 3, maxInFlight: 4 } });
  const token = await sign();
  const results = [];
  for (let i = 0; i < 4; i += 1) {
    results.push(await (await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token })).json());
  }
  assert.equal(results.slice(0, 3).filter((r) => r.result.isError).length, 0);
  assert.equal(results[3].result.isError, true);
  assert.match(results[3].result.content[0].text, /same arguments 4 times this minute \(the limit is 3\)/);
  assert.equal(config.limits.repeatsPerMinute, 3);
  // Different arguments are not a loop.
  const other = await (await call(handler, 'dwlf_get_regime', { symbol: 'ETH' }, { token })).json();
  assert.ok(!other.result.isError);
});

test('in-flight is per ACCOUNT: another client of the same account shares the cap', async () => {
  const { handler } = setup({ limits: { callsPerMinute: 60, repeatsPerMinute: 10, maxInFlight: 1 }, callDeadlineMs: 4000, upstreamTimeoutMs: 3500 });
  const slow = call(handler, 'dwlf_get_regime', { symbol: 'SLOW' }, { token: await sign({ clientId: 'client-a' }) });
  await new Promise((r) => setTimeout(r, 100));
  const otherClient = await (await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token: await sign({ clientId: 'client-b' }) })).json();
  assert.match(otherClient.result.content[0].text, /already running for this account/);
  const otherAccount = await (await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token: await sign({ sub: 'acct-2' }) })).json();
  assert.ok(!otherAccount.result.isError);
  await slow;
});

test('the per-minute ceiling is per (account, client)', async () => {
  const { handler } = setup({ limits: { callsPerMinute: 2, repeatsPerMinute: 10, maxInFlight: 4 } });
  const a = await sign({ clientId: 'client-a' });
  const b = await sign({ clientId: 'client-b' });
  await call(handler, 'dwlf_get_regime', { symbol: 'A1' }, { token: a });
  await call(handler, 'dwlf_get_regime', { symbol: 'A2' }, { token: a });
  const third = await (await call(handler, 'dwlf_get_regime', { symbol: 'A3' }, { token: a })).json();
  assert.match(third.result.content[0].text, /Too many tool calls: 3 this minute/);
  const otherClient = await (await call(handler, 'dwlf_get_regime', { symbol: 'B1' }, { token: b })).json();
  assert.ok(!otherClient.result.isError);
});

test('in-flight cap: a call beyond maxInFlight is refused while the others run, and slots come back', async () => {
  const { handler } = setup({ limits: { callsPerMinute: 60, repeatsPerMinute: 10, maxInFlight: 1 }, callDeadlineMs: 4000, upstreamTimeoutMs: 3500 });
  const token = await sign();
  const slow = call(handler, 'dwlf_get_regime', { symbol: 'SLOW' }, { token });
  await new Promise((r) => setTimeout(r, 100));
  const refused = await (await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token })).json();
  assert.match(refused.result.content[0].text, /1 tool calls are already running for this account/);
  await slow;
  const after = await (await call(handler, 'dwlf_get_regime', { symbol: 'ETH' }, { token })).json();
  assert.ok(!after.result.isError);
});

test('the call deadline answers a tool error (never a gateway timeout) and aborts the upstream request', async () => {
  const { handler } = setup({ callDeadlineMs: 300, upstreamTimeoutMs: 5000 });
  const started = Date.now();
  const res = await call(handler, 'dwlf_get_regime', { symbol: 'SLOW' }, { token: await sign() });
  assert.ok(Date.now() - started < 1500, 'answered at the deadline, not when the upstream finished');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.isError, true);
  // Either the host's deadline answer, or the tool's own timeout (its request is capped at the time left): both in time.
  assert.match(body.result.content[0].text, /took longer than|timeout of \d+ms exceeded/);
});

test('oversized body → 413; a batch → 400; malformed JSON → 400', async () => {
  const { handler } = setup();
  const token = await sign();
  assert.equal((await post(handler, null, { token, raw: 'x'.repeat(256 * 1024 + 1) })).status, 413);
  assert.equal((await post(handler, null, { token, raw: '[{"jsonrpc":"2.0","id":1,"method":"ping"}]' })).status, 400);
  assert.equal((await post(handler, null, { token, raw: '{nope' })).status, 400);
});

test('an excluded or unknown tool is answered by the server, with no credential minted', async () => {
  const { handler, minter } = setup();
  const res = await call(handler, 'dwlf_register_agent', { email: 'a@b.c' }, { token: await sign() });
  const body = await res.json();
  assert.ok(body.error || body.result?.isError);
  assert.equal(minter.minted.length, 0);
});

test('lambda adapter: the URL is built on the canonical origin, never the Host header', async () => {
  const req = toRequest({
    httpMethod: 'POST', path: '/mcp', headers: { host: 'evil.example', 'content-type': 'application/json' },
    multiValueQueryStringParameters: { a: ['1', '2'] }, body: Buffer.from('{"x":1}').toString('base64'), isBase64Encoded: true,
  }, RESOURCE);
  assert.equal(new URL(req.url).origin, 'https://mcp.test');
  assert.equal(new URL(req.url).search, '?a=1&a=2');
  assert.equal(await req.text(), '{"x":1}');
  const out = await toResult(new Response('{"ok":true}', { status: 201, headers: { 'x-a': 'b' } }));
  assert.deepEqual(out, { statusCode: 201, headers: { 'x-a': 'b', 'content-type': 'text/plain;charset=UTF-8' }, body: '{"ok":true}' });
});

test('the hosted server registers no resources or prompts (nothing but a scoped, keyed tool reaches the API)', async () => {
  const { handler } = setup();
  const token = await sign();
  seen.length = 0;
  const res = await (await post(handler, { method: 'resources/read', params: { uri: 'dwlf://symbols' } }, { token })).json();
  assert.ok(res.error, 'resources/read is not served');
  const init = await (await post(handler, { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, { token })).json();
  assert.equal(init.result.capabilities.resources, undefined);
  assert.equal(seen.length, 0, 'no upstream request');
});

test('an outage of the AS keys → 503 with Retry-After, never 401 (clients keep their tokens)', async () => {
  const { handler, logs } = setup({}, { verify: async () => { const { AuthServerUnavailableError } = await import('../dist/hosted/auth.js'); throw new AuthServerUnavailableError('timeout'); } });
  const res = await post(handler, { method: 'ping' }, { token: 'abc.def.ghi' });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '30');
  assert.equal(res.headers.get('www-authenticate'), null);
  assert.ok(logs.some((l) => l.event === 'hosted-mcp-jwks-unavailable'));
});

test('a refused grant at the exchange (disconnected client) → 401 invalid_token, logged as an ordinary event', async () => {
  const { GrantRefusedError } = await import('../dist/hosted/credentials.js');
  const minter = { ...fakeMinter(), async exchange() { throw new GrantRefusedError('invalid_grant'); } };
  const { handler, logs } = setup({}, { minter });
  const res = await call(handler, 'dwlf_get_regime', { symbol: 'BTC' }, { token: await sign() });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /error="invalid_token"/);
  assert.ok(logs.some((l) => l.event === 'hosted-mcp-grant-refused'));
  assert.ok(!logs.some((l) => l.event === 'hosted-mcp-credential-failed'), 'not the alarmed event');
});

test('the deadline runs from arrival: slow credential work leaves the tool less time, and the answer still comes in time', async () => {
  const slowMinter = fakeMinter();
  const exchange = slowMinter.exchange.bind(slowMinter);
  slowMinter.exchange = async (t) => { await new Promise((r) => setTimeout(r, 400)); return exchange(t); };
  const { handler } = setup({ callDeadlineMs: 600, upstreamTimeoutMs: 5000 }, { minter: slowMinter });
  const started = Date.now();
  const body = await (await call(handler, 'dwlf_get_regime', { symbol: 'SLOW' }, { token: await sign() })).json();
  assert.ok(Date.now() - started < 1200, `answered by the deadline (${Date.now() - started} ms)`);
  assert.equal(body.result.isError, true);
});

test('dwlf_get_events under the deadline: stops auto-paging in time and returns what it has, marked incomplete', async () => {
  const { handler } = setup({ callDeadlineMs: 5000, upstreamTimeoutMs: 4000 });
  const started = Date.now();
  const res = await call(handler, 'dwlf_get_events', { customEventId: 'ce-1', days: 2000 }, { token: await sign() });
  const body = JSON.parse(await textOf(res));
  assert.ok(Date.now() - started < 5000);
  assert.equal(body.filtersApplied.incomplete, true);
  assert.match(body.filtersApplied.paginationHint, /time limit/);
  assert.ok(body.cursor, 'a cursor to carry on from');
  assert.ok(body.events.length >= 2 && body.filtersApplied.pagesFetched === body.events.length);
});
