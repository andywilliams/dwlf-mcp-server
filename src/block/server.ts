import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BlockApiClient, type UpstreamRecorder } from './client.js';
import { registerBlockApiTools, type CatalogueCache } from './tools.js';
import { blockApiInstructions } from '../profiles.js';

// The published contract of `@dwlf/mcp-server/block` is this file's exports and nothing else (charter *Interfaces*).
export type { UpstreamRecorder, UpstreamRefusal } from './client.js';
export type { CatalogueCache } from './tools.js';

// package.json sits two levels above dist/block/ in both a clone and the installed package. serverInfo names this
// package's version, the tool code that answered (what an agent's report needs); the host logs its own release. A host
// that bundles this module (esbuild moves the file) loses that path, and two levels up may then be another package's
// package.json: only ours (by name) is believed, else the version reads `unknown`. Loading works either way; a host
// should keep `@dwlf/mcp-server` external to its bundle (CDK `nodeModules`) so the version stays known.
const version = (() => {
  try {
    const pkg = createRequire(import.meta.url)('../../package.json') as { name?: string; version?: string };
    return pkg.name === '@dwlf/mcp-server' && typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch { return 'unknown'; }
})();

// Plain HTTP only to this machine (the tests' stand-in); anything else must be HTTPS, since every read carries a credential.
const allowedBase = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
  } catch { return false; }
};

export interface BlockServerOptions {
  /**
   * What the Block API accepts as `Bearer` on `/v1`: today a person's own Block API key (`dwlfk_…`); once OAuth ships
   * (hosted-auth step 7), also the `aud = block` token identity's exchange gives. The host decides which it passes;
   * this never inspects it, logs it or keeps it beyond this server's client, and sends it to the Block API only.
   * Required: a hosted caller is always signed in.
   */
  credential: string;
  /**
   * The Block API's base URL, e.g. `https://api.block.dwlf.co.uk`. Required, so no environment variable is a hidden
   * input: the host fixes it per stage from its own configuration, never from the request.
   */
  baseURL: string;
  timeoutMs?: number;
  /** Told of each Block API refusal or failure during this request (hosted-auth H11). */
  recorder?: UpstreamRecorder;
  /** Where the catalogue is kept between requests: one store may serve every caller, since it's keyed by view. */
  catalogueCache?: CatalogueCache;
  /**
   * Headers sent on every Block API read, for an agreement between the host and the Block API: the hosted MCP vouching
   * for its caller's address (`x-dwlf-hosted-secret`, `x-dwlf-hosted-caller`; DWLF-918). Names must be `x-dwlf-…`
   * (letters, digits, hyphens), so no host replaces `Authorization`, `Accept` or anything HTTP itself means; values are
   * printable ASCII, no line breaks, not blank. Treated like the credential: never logged or kept, sent only to `baseURL`.
   */
  upstreamHeaders?: Readonly<Record<string, string>>;
}

const HEADER_NAME = /^x-dwlf-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEADER_VALUE = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

/** The host's headers, names lower-cased, or a thrown error naming the first bad one (never its value). */
function checkedHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  if (headers === null || typeof headers !== 'object') throw new Error('createBlockServer\'s upstreamHeaders must be an object of header names to values.');
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(lower)) throw new Error(`createBlockServer's upstreamHeaders: "${name}" isn't an x-dwlf- header name.`);
    if (typeof value !== 'string' || !HEADER_VALUE.test(value)) {
      throw new Error(`createBlockServer's upstreamHeaders: the value of ${lower} must be printable ASCII on one line, not blank.`);
    }
    if (lower in out) throw new Error(`createBlockServer's upstreamHeaders: ${lower} is given twice.`);
    out[lower] = value;
  }
  return out;
}

/**
 * The library entry for a per-request host (`@dwlf/mcp-server/block`; DWLF-622, docs/design/hosted-auth.md step 2a):
 * one `McpServer` with the Block profile on the `block-api` backend, signed in with the caller's credential. It
 * registers through `registerBlockApiTools`, the function `registerForProfile` calls on that backend for stdio, so
 * both give the same tools and instructions (`test/blockServer.test.mjs` pins it), without importing the SPT tool
 * modules. Build one per request and close it after. The host owns the transport, the credential check and every limit.
 */
export function createBlockServer(options: BlockServerOptions): McpServer {
  const credential = typeof options.credential === 'string' ? options.credential.trim() : '';
  if (!credential) throw new Error('createBlockServer needs the caller\'s credential (a Block API key).');
  if (typeof options.baseURL !== 'string' || !allowedBase(options.baseURL)) {
    throw new Error('createBlockServer needs the Block API\'s baseURL, over HTTPS (plain HTTP only to loopback).');
  }
  const headers = checkedHeaders(options.upstreamHeaders);
  const server = new McpServer({ name: 'dwlf', version }, { instructions: blockApiInstructions(options.baseURL, true) });
  const client = new BlockApiClient({ apiKey: credential, baseURL: options.baseURL, timeoutMs: options.timeoutMs, recorder: options.recorder, headers });
  registerBlockApiTools(server, client, { catalogueCache: options.catalogueCache });
  return server;
}
