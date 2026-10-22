import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// DWLF-514: serverInfo.version is read from package.json at startup, so it tracks the published version
// and a layout change that breaks the relative read fails here rather than on every client's launch.
test('initialize advertises the package.json version', { timeout: 10_000 }, async () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], {
    env: { ...process.env, DWLF_API_KEY: 'test' },
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout: 8_000, // kills a hung server so its pipes can't hold the test run open
  });
  const reply = new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const line = out.split('\n').find((l) => l.includes('"id":1'));
      if (line) resolve(JSON.parse(line));
    });
    child.on('exit', (code) => reject(new Error(`server exited (${code}) before replying`)));
  });
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  }) + '\n');
  try {
    const res = await reply;
    assert.deepEqual(res.result.serverInfo, { name: 'dwlf', version });
  } finally {
    child.kill();
  }
});
