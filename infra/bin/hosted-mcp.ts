#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import { HostedMcpStack } from '../lib/hosted-mcp-stack.js';

// DWLF-622. Deployed by hand (`npx cdk deploy`), never on merge. Off unless `-c enabled=true`: see the stack.
const app = new cdk.App();
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
new HostedMcpStack(app, 'DwlfHostedMcp', {
  // Pinned, never taken from the caller's credentials (as dwlf-identity's stack is).
  env: { account: '595413403045', region: 'eu-west-2' },
  description: 'DWLF hosted MCP endpoint: Streamable HTTP + OAuth resource server (DWLF-622)',
  tags: { project: 'dwlf-mcp-server', product: 'block' },
  enabled: app.node.tryGetContext('enabled') === 'true',
  alarmEmail: app.node.tryGetContext('alarmEmail'),
  version,
});
