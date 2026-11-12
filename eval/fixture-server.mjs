/**
 * The DWLF API as the eval's MCP server sees it (DWLF-804). Two modes:
 *   - replay (CI, the default): answers each request from eval/fixtures/, keyed by method + path + sorted query.
 *     A request with no fixture is a 599 naming the missing key, so a case that wanders off its recording fails
 *     loudly instead of reading as "no data". No credential is needed or read.
 *   - record (by hand, with a key the person running it provides in DWLF_API_KEY): forwards GET requests to the real
 *     API and writes each answer as a fixture; any other method is refused (403), so recording never writes to prod. The Authorization header is sent upstream and NEVER written to disk.
 * Fixtures are plain JSON ({ key, status, body }), so a reviewer can read what an eval's answers were based on.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
 * Starts the server on a free local port. `mode`: 'replay' | 'record'. `upstream` (record only): the real API origin.
 * Returns `{ url, close, misses, stale }`: the keys replay could not answer, and those answered from a recording
 * older than STALE_AFTER_DAYS.
 */
export const startFixtureServer = async ({ dir, mode = 'replay', upstream = 'https://api.dwlf.co.uk', apiKey } = {}) => {
  if (mode === 'record' && !apiKey) { throw new Error('record mode needs DWLF_API_KEY (a read-only Block test key)'); }
  mkdirSync(dir, { recursive: true });
  const misses = [];
  const stale = new Set();
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
        if (f.recordedAt && Date.now() - Date.parse(f.recordedAt) > STALE_AFTER_DAYS * 86400000) { stale.add(key); }
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
      const up = await fetch(new URL(req.url, upstream), {
        method: req.method, body: body || undefined, headers: { 'content-type': 'application/json', authorization: `ApiKey ${apiKey}` },
      });
      const text = await up.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { nonJson: text.slice(0, 2000) }; }
      writeFileSync(file, `${JSON.stringify({ key, status: up.status, recordedAt: new Date().toISOString(), body: parsed }, null, 1)}\n`);
      res.writeHead(up.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(parsed));
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'EVAL_FIXTURE_SERVER', message: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, misses, stale, close: () => new Promise((resolve) => server.close(resolve)) };
};
