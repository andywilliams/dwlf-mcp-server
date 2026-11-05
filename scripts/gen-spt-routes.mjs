#!/usr/bin/env node
// Generates test/fixtures/spt-routes.json: SPT's /v2 route → permission table, read from SPT's unifiedApi.js (DWLF-622).
// test/hostedScopes.test.mjs checks every hosted tool's calls against it, so the tool → scope table can't drift
// silently from what SPT enforces. Re-run when SPT's routes or permissions change:
//
//   node scripts/gen-spt-routes.mjs ../serverless-portfolio-tracker
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sptRoot = process.argv[2];
if (!sptRoot) { console.error('usage: node scripts/gen-spt-routes.mjs <serverless-portfolio-tracker checkout>'); process.exit(2); }
const file = path.join(sptRoot, 'src/handlers/unifiedApi.js');
const src = fs.readFileSync(file, 'utf8');
let sha = 'unknown';
try { sha = execFileSync('git', ['-C', sptRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }

const routes = [];
const re = /^app\.(get|post|put|patch|delete)\(\s*'(\/v2\/[^']*)'\s*,(.*)$/gm;
for (let m = re.exec(src); m; m = re.exec(src)) {
  const rest = m[3];
  const single = rest.match(/requirePermission\('([^']+)'\)/);
  const any = rest.match(/requireAnyPermission\(\[([^\]]+)\]\)/);
  let permissions = null; // null = no permission middleware on the route (public, JWT-only or checked in the handler)
  if (single) permissions = [single[1]];
  else if (any) permissions = any[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const auth = /requireJwtAuth|requireSession/.test(rest) ? 'session' : permissions ? 'permission' : 'none';
  routes.push({ method: m[1].toUpperCase(), path: m[2], permissions, auth });
}
if (routes.length < 100) { console.error(`only ${routes.length} routes found in ${file}: has its shape changed?`); process.exit(1); }

// One route per line, so a regeneration diffs as the routes that changed.
const out = `{
  "generatedBy": "scripts/gen-spt-routes.mjs",
  "source": ${JSON.stringify(`serverless-portfolio-tracker@${sha} src/handlers/unifiedApi.js`)},
  "note": "permissions: any one of them is required; null = no permission middleware (public, session-only, or checked in the handler)",
  "routes": [
${routes.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}
  ]
}
`;
fs.mkdirSync(new URL('../test/fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../test/fixtures/spt-routes.json', import.meta.url), out);
console.log(`wrote ${routes.length} routes from ${sha}`);
