#!/usr/bin/env node

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DWLFClient } from './client.js';
import { registerAll } from './register.js';
import { profiledServer, resolveProfile, resolveBlockBackend, PROFILE_INSTRUCTIONS, BLOCK_API_INSTRUCTIONS, type ProfileName, type BlockBackend } from './profiles.js';
import { BlockApiClient } from './block/client.js';
import { registerBlockApiTools } from './block/tools.js';

// package.json sits one level above dist/ in both a clone and the published tarball.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

// Tool profile (DWLF-621): `full` by default; `block` for block.dwlf users. Unknown → exit with the reason.
let profile: ProfileName;
let backend: BlockBackend;
try {
  profile = resolveProfile(process.argv.slice(2), process.env);
  backend = resolveBlockBackend(process.argv.slice(2), process.env, profile);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const instructions = backend === 'block-api' ? BLOCK_API_INSTRUCTIONS : PROFILE_INSTRUCTIONS[profile];
const server = new McpServer({ name: 'dwlf', version }, instructions ? { instructions } : undefined);

if (backend === 'block-api') {
  // The Block profile on the Block API (DWLF-876 D1–D3): only the launch-set tools, through BlockApiClient. SPT and
  // DWLF_API_KEY are not used at all here.
  if (process.env.DWLF_API_KEY) console.error('Note: DWLF_API_KEY is not used on the block-api backend (set DWLF_BLOCK_KEY for a Block API key).');
  registerBlockApiTools(server, new BlockApiClient());
} else {
  registerAll(profiledServer(server, profile), new DWLFClient());
}

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
