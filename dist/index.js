#!/usr/bin/env node
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerForProfile } from './register.js';
import { blockApiBase, blockApiKeyFromEnv } from './block/client.js';
import { resolveProfile, resolveBlockBackend, PROFILE_INSTRUCTIONS, blockApiInstructions } from './profiles.js';
// package.json sits one level above dist/ in both a clone and the published tarball.
const { version } = createRequire(import.meta.url)('../package.json');
// Tool profile (DWLF-621): `full` by default; `block` for block.dwlf users. Unknown → exit with the reason.
let profile;
let backend;
try {
    profile = resolveProfile(process.argv.slice(2), process.env);
    backend = resolveBlockBackend(process.argv.slice(2), process.env, profile);
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
// The keys page follows the Block API's stage (BLOCK_API_URL), as the client the tools use does.
const instructions = backend === 'block-api' ? blockApiInstructions(blockApiBase(), Boolean(blockApiKeyFromEnv())) : PROFILE_INSTRUCTIONS[profile];
const server = new McpServer({ name: 'dwlf', version }, instructions ? { instructions } : undefined);
// On the block-api backend (DWLF-876) SPT and DWLF_API_KEY are not used at all.
if (backend === 'block-api' && process.env.DWLF_API_KEY) {
    console.error('Note: DWLF_API_KEY is not used on the block-api backend (set DWLF_BLOCK_KEY for a Block API key).');
}
registerForProfile(server, profile, backend);
// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map