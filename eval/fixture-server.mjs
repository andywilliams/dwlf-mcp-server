/**
 * The DWLF APIs as the eval's MCP server sees them (DWLF-804). Two modes:
 *   - replay (CI, the default): answers each request from eval/fixtures/, keyed by method + path + sorted query.
 *     A request with no fixture is a 599 naming the missing key, so a case that wanders off its recording fails
 *     loudly instead of reading as "no data". No credential is needed or read.
 *   - record (by hand): forwards GET requests to the real API and writes each answer as a fixture; any other method is
 *     refused (403), so recording never writes to prod. The upstream is chosen per route family: Block API paths
 *     (`/v1/…`, `/public/v1/…`) go to `upstreams.block`, everything else to `upstreams.dwlf` (SPT). A key is needed
 *     only for what it unlocks: `/public/v1/…` is recorded with none; other Block paths need `blockKey` (Bearer),
 *     SPT paths `apiKey` (ApiKey). A request whose key was not given is refused (401) and not saved. Keys are sent
 *     upstream and NEVER written to disk.
 *   - record-time contract (charter check 4): each Block data-route body (catalogue, conditions, events, series) is
 *     checked against the `required` lists in the Block API's own `/public/v1/openapi.json`, fetched once per run,
 *     and against the `knowableAt` rules (envelope.mjs). A body that fails is answered but NOT saved, and is reported
 *     (`contractFailures`) as the Block API's defect. A saved one stores the OpenAPI `info.version` and sha256.
 * Fixtures are plain JSON ({ key, status, body }), so a reviewer can read what an eval's answers were based on.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataFamily, knowableAtFailures, requiredFailures, requiredForPath, requiredFrom } from './envelope.mjs';

export const UPSTREAMS = Object.freeze({ dwlf: 'https://api.dwlf.co.uk', block: 'https://api.block.dwlf.co.uk' });
/** Which upstream serves a path: the Block API owns `/v1/…` and `/public/v1/…`; SPT everything else. */
export const routeFamily = (path) => (/^\/(?:public\/)?v1(?:\/|$)/.test(path) ? 'block' : 'dwlf');

// A write's body is part of its identity (two creates on one path differ by body), so a non-empty body adds its hash.
export const fixtureKey = (method, rawUrl, body = '') => {
  const url = new URL(rawUrl, 'http://fixture.local');
  const query = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const bodyPart = body ? ` #body=${createHash('sha256').update(body).digest('hex').slice(0, 12)}` : '';
  return `${method.toUpperCase()} ${url.pathname}${query ? `?${query}` : ''}${bodyPart}`;
};
// Fixtures older than this are reported (summary.staleFixtures): the eval certifies descriptions against the API's
// shapes at recording time, so a stale recording is re-recorded rather than trusted.
export const STALE_AFTER_DAYS = 30;
export const fixtureFile = (dir, key) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 16)}.json`);

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

/**
 * The saved recordings checked against an OpenAPI other than the newest one in `dir` (by `recordedAt`): a `required`
 * list tightened since shows up here even while replay stays green. Returns `[{ key, openapi, newest }]`.
 */
export const schemaDrift = (dir) => {
  if (!existsSync(dir)) { return []; }
  const checked = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).filter((f) => f.openapi?.sha256);
  if (!checked.length) { return []; }
  const newest = checked.reduce((a, b) => (Date.parse(b.recordedAt) > Date.parse(a.recordedAt) ? b : a)).openapi;
  return checked.filter((f) => f.openapi.sha256 !== newest.sha256).map((f) => ({ key: f.key, openapi: f.openapi, newest }));
};

/**
 * Starts the server on a free local port. `mode`: 'replay' | 'record'. `upstreams` (record only): `{ dwlf, block }`
 * origins (UPSTREAMS by default); `apiKey`: SPT's key; `blockKey`: a Block API token, for its non-public paths.
 * Returns `{ url, close, misses, stale, transient, refused, contractFailures, served }`: the keys replay could not
 * answer; those answered from a recording older than STALE_AFTER_DAYS (or undated); when recording, the upstream
 * failures not saved, the requests refused for want of a key, and the Block bodies that broke the contract; and every
 * key answered, in order, with the body sent (the pass-through test compares a tool's result with these).
 */
export const startFixtureServer = async ({ dir, mode = 'replay', upstreams: given = {}, apiKey, blockKey } = {}) => {
  const upstreams = { ...UPSTREAMS, ...given };
  mkdirSync(dir, { recursive: true });
  const misses = [];
  const stale = new Set();
  const transient = [];
  const refused = [];
  const contractFailures = [];
  const served = [];
  let contract;
  // The Block API's own OpenAPI, fetched once per recording run: what its data-route bodies must carry.
  const blockContract = async () => {
    if (!contract) {
      contract = (async () => {
        const r = await fetch(new URL('/public/v1/openapi.json', upstreams.block));
        if (!r.ok) { throw new Error(`the Block API's OpenAPI answered ${r.status}`); }
        const text = await r.text();
        const doc = JSON.parse(text);
        return { routes: requiredFrom(doc), openapi: { version: doc.info?.version ?? null, sha256: createHash('sha256').update(text).digest('hex') } };
      })();
    }
    return contract;
  };
  const server = createServer(async (req, res) => {
    try {
      const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
      const key = fixtureKey(req.method, req.url, body);
      const file = fixtureFile(dir, key);
      if (mode === 'replay') {
        if (!existsSync(file)) {
          misses.push(key);
          res.writeHead(599, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'EVAL_FIXTURE_MISSING', key }));
          return;
        }
        const f = JSON.parse(readFileSync(file, 'utf8'));
        // No date, an unreadable date or an old one: all reported. A hand-written fixture carries the date it was written.
        const age = Date.now() - Date.parse(f.recordedAt);
        if (!(age <= STALE_AFTER_DAYS * 86400000)) { stale.add(key); }
        served.push({ key, body: f.body });
        res.writeHead(f.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(f.body));
        return;
      }
      // Recording reads only: an eval question must never create, change or delete anything in prod. A write tool's
      // case gets a hand-written fixture instead.
      if (req.method !== 'GET') {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'EVAL_RECORD_WRITE_REFUSED', key }));
        return;
      }
      const path = new URL(req.url, 'http://fixture.local').pathname;
      const family = routeFamily(path);
      const isPublic = family === 'block' && path.startsWith('/public/');
      const authorization = family === 'dwlf' ? (apiKey && `ApiKey ${apiKey}`) : (isPublic ? undefined : blockKey && `Bearer ${blockKey}`);
      if (!isPublic && !authorization) {
        refused.push(key);
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'EVAL_RECORD_NO_KEY', key, message: family === 'dwlf' ? 'set DWLF_API_KEY to record SPT paths' : 'set BLOCK_API_KEY to record signed-in Block paths' }));
        return;
      }
      const up = await fetch(new URL(req.url, upstreams[family]), {
        method: req.method, headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
      });
      const text = await up.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { nonJson: text.slice(0, 2000) }; }
      // A transient or credential failure is not a recording: answer it, never save it (it would replay an outage as
      // truth). Real answers are kept, refusals included (400, 403 plan locks, 404).
      if (up.status === 401 || up.status === 408 || up.status === 429 || up.status >= 500) {
        transient.push(`${up.status} ${key}`);
        res.writeHead(up.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(parsed));
        return;
      }
      let openapi;
      const dataRoute = family === 'block' && up.status === 200 ? dataFamily(path) : null;
      if (dataRoute) {
        const { routes, openapi: schema } = await blockContract();
        const required = requiredForPath(routes, path);
        // Two sources, reported apart: the OpenAPI's `required` lists are the Block API's own rule; the knowableAt rules
        // are this repo's copy (envelope.mjs), so a failure there may mean the copy is stale (see eval/README.md).
        const missing = required ? requiredFailures(parsed, required) : [`${path} is not in the Block API's OpenAPI`];
        const times = knowableAtFailures(parsed, { family: dataRoute });
        const broken = [...missing.map((f) => `required by the Block API's OpenAPI: ${f}`), ...times.map((f) => `knowableAt rule (eval/envelope.mjs): ${f}`)];
        if (broken.length) {
          contractFailures.push({ key, openapi: schema, failures: broken });
          res.writeHead(up.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(parsed));
          return;
        }
        openapi = schema;
      }
      writeFileSync(file, `${JSON.stringify({ key, status: up.status, recordedAt: new Date().toISOString(), ...(openapi ? { openapi } : {}), body: parsed }, null, 1)}\n`);
      served.push({ key, body: parsed });
      res.writeHead(up.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(parsed));
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'EVAL_FIXTURE_SERVER', message: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, misses, stale, transient, refused, contractFailures, served, close: () => new Promise((resolve) => server.close(resolve)) };
};
