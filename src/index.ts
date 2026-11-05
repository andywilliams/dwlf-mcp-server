#!/usr/bin/env node

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DWLFClient } from './client.js';
import { registerAll } from './register.js';
import { profiledServer, resolveProfile, PROFILE_INSTRUCTIONS, type ProfileName } from './profiles.js';

// package.json sits one level above dist/ in both a clone and the published tarball.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

// Tool profile (DWLF-621): `full` by default; `block` for block.dwlf users. Unknown → exit with the reason.
let profile: ProfileName;
try {
  profile = resolveProfile(process.argv.slice(2), process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const instructions = PROFILE_INSTRUCTIONS[profile];
const server = new McpServer({ name: 'dwlf', version }, instructions ? { instructions } : undefined);

const client = new DWLFClient();

registerAll(profiledServer(server, profile), client, { profile });

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
