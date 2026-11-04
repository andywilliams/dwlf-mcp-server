#!/usr/bin/env node
// SPIKE, local only (DWLF-622; docs/HOSTED-MCP.md §10). Not shipped: `spike/` is outside package.json `files`.
//
// A stateless Streamable HTTP host for the existing tools, to test the shape the hosted MCP would have:
//   - one endpoint, POST /mcp; GET and DELETE answer 405 (2026-07-28 removed the GET stream and sessions);
//   - a fresh McpServer + DWLFClient per request, built from the caller's credential, so no state is shared between
//     callers and nothing lives between requests (what a Lambda wants);
//   - Origin validation (DNS rebinding), localhost bind, a body-size cap;
//   - OAuth 2.0 Protected Resource Metadata at /.well-known/oauth-protected-resource, and a 401 with
//     `WWW-Authenticate: Bearer resource_metadata=…` when no credential is sent.
//
// ⚠️ NOT OAuth. The Bearer value here is a DWLF API key, passed through to the API. That is exactly the token
// passthrough the MCP spec forbids for a real deployment; the design replaces it with OAuth access tokens issued for
// this resource and an on-behalf-of credential to the API (docs/HOSTED-MCP.md §4). Run it only on your own machine.
//
//   npm run build && node spike/hosted-http.mjs [--port 8787] [--profile block]
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DWLFClient } from '../dist/client.js';
import { registerAll } from '../dist/register.js';
import { profiledServer, resolveProfile, PROFILE_INSTRUCTIONS } from '../dist/profiles.js';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8787;
const profile = resolveProfile(args, { DWLF_TOOL_PROFILE: 'block' }); // the hosted default is the Block profile
const HOST = '127.0.0.1';
const RESOURCE = `http://${HOST}:${port}/mcp`;
const PRM_PATH = '/.well-known/oauth-protected-resource';
const MAX_BODY = 256 * 1024;
const ALLOWED_ORIGINS = new Set([`http://${HOST}:${port}`, `http://localhost:${port}`]);

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.removeAllListeners('data'); reject(Object.assign(new Error('body too large'), { status: 413 })); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
  });
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, RESOURCE);

  // DNS rebinding: a present, unknown Origin is refused (spec: MUST 403). Non-browser clients send none.
  if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) {
    return json(res, 403, { jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' } });
  }

  if (url.pathname === PRM_PATH && req.method === 'GET') {
    // RFC 9728. In the real deployment authorization_servers names the DWLF authorization server.
    return json(res, 200, {
      resource: RESOURCE,
      authorization_servers: ['https://auth.dwlf.example/'],
      scopes_supported: ['markets:read'],
      bearer_methods_supported: ['header'],
      resource_name: 'DWLF Block (local spike)',
    });
  }

  if (url.pathname !== '/mcp') return json(res, 404, { error: 'not found' });
  if (req.method !== 'POST') {
    return json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: POST only' } }, { Allow: 'POST' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) {
    return json(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: 'Authorization required' } }, {
      'WWW-Authenticate': `Bearer resource_metadata="http://${HOST}:${port}${PRM_PATH}", scope="markets:read"`,
    });
  }

  let body;
  try { body = await readBody(req); } catch (e) {
    // Answer, then drop the connection (the rest of an oversized body is never read).
    res.writeHead(e.status || 400, { 'Content-Type': 'application/json', Connection: 'close' });
    return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: e.message } }), () => req.destroy());
  }

  // Per request: nothing shared between callers, nothing kept between requests.
  const instructions = PROFILE_INSTRUCTIONS[profile];
  const mcp = new McpServer({ name: 'dwlf', version: 'spike' }, instructions ? { instructions } : undefined);
  registerAll(profiledServer(mcp, profile), new DWLFClient({ apiKey: token }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); mcp.close(); });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' } });
    console.error('spike: request failed', e?.message);
  }
});

server.listen(port, HOST, () => console.error(`hosted-MCP spike (${profile}) on ${RESOURCE}`));
