import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BlockApiClient, type UpstreamRecorder } from './client.js';
import type { CatalogueCache } from './tools.js';
import { registerForProfile } from '../register.js';
import { BLOCK_API_INSTRUCTIONS } from '../profiles.js';

export { BlockApiClient, BlockApiError, type UpstreamRecorder, type UpstreamRefusal } from './client.js';
export type { CatalogueCache } from './tools.js';
export { BLOCK_API_TOOLS, BLOCK_API_INSTRUCTIONS } from '../profiles.js';

// package.json sits two levels above dist/block/ in both a clone and the published tarball.
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

export interface BlockServerOptions {
  /** The caller's own Block API key (`dwlfk_…`), sent as `Bearer` to the Block API and nowhere else. Required. */
  apiKey: string;
  /** The Block API's base URL. The host fixes it from its own configuration, never from the request. */
  baseURL?: string;
  timeoutMs?: number;
  /** Told of each Block API refusal or failure during this request (hosted-auth H11). */
  recorder?: UpstreamRecorder;
  /** Where the catalogue is kept between requests; the host keys it by credential (hosted-auth §1). */
  catalogueCache?: CatalogueCache;
}

/**
 * The library entry for a per-request host (`@dwlf/mcp-server/block`; DWLF-622, docs/design/hosted-auth.md): one
 * `McpServer` with the Block profile on the `block-api` backend, the same tools and instructions the stdio server gives
 * with `--profile block` on that backend, signed in with the caller's key. Build one per request and close it after;
 * nothing read with one caller's key is kept in it. The host owns the transport, the credential check and every limit.
 */
export function createBlockServer(options: BlockServerOptions): McpServer {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  if (!apiKey) throw new Error('createBlockServer needs the caller\'s Block API key.');
  const server = new McpServer({ name: 'dwlf', version }, { instructions: BLOCK_API_INSTRUCTIONS });
  const client = new BlockApiClient({ apiKey, baseURL: options.baseURL, timeoutMs: options.timeoutMs, recorder: options.recorder });
  registerForProfile(server, 'block', 'block-api', { block: () => client }, { catalogueCache: options.catalogueCache });
  return server;
}
