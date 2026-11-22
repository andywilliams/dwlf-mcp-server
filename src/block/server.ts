import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BlockApiClient, type UpstreamRecorder } from './client.js';
import { registerBlockApiTools, type CatalogueCache } from './tools.js';
import { BLOCK_API_INSTRUCTIONS } from '../profiles.js';

// The published contract of `@dwlf/mcp-server/block` is this file's exports and nothing else (charter *Interfaces*).
export type { UpstreamRecorder, UpstreamRefusal } from './client.js';
export type { CatalogueCache } from './tools.js';

// package.json sits two levels above dist/block/ in both a clone and the published tarball. serverInfo names this
// package's version, the tool code that answered (what an agent's report needs); the host logs its own release.
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

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
  if (typeof options.baseURL !== 'string' || !/^https?:\/\//.test(options.baseURL)) throw new Error('createBlockServer needs the Block API\'s baseURL.');
  const server = new McpServer({ name: 'dwlf', version }, { instructions: BLOCK_API_INSTRUCTIONS });
  const client = new BlockApiClient({ apiKey: credential, baseURL: options.baseURL, timeoutMs: options.timeoutMs, recorder: options.recorder });
  registerBlockApiTools(server, client, { catalogueCache: options.catalogueCache });
  return server;
}
