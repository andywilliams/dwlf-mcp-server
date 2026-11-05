#!/usr/bin/env node
// Generates test/fixtures/spt-explain-index.json: what SPT's GET /v2/events/explain serves (its `types[]` summary
// lines and packs), computed from an SPT checkout (DWLF-646). test/onchainCatalogue.test.mjs checks the bundled
// catalogue against it, so the offline fallback can't drift from the API unnoticed. Re-run when either changes:
//
//   node scripts/gen-spt-explain-fixture.mjs ../serverless-portfolio-tracker
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const sptRoot = process.argv[2];
if (!sptRoot) { console.error('usage: node scripts/gen-spt-explain-fixture.mjs <serverless-portfolio-tracker checkout>'); process.exit(2); }
let sha = 'unknown';
try { sha = execFileSync('git', ['-C', sptRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const { listExplainable } = createRequire(import.meta.url)(path.resolve(sptRoot, 'src/services/eventExplain.js'));
const index = listExplainable();
if (!Array.isArray(index.types)) { console.error('this SPT has no `types` on the explain index (SPT #747): nothing to compare'); process.exit(1); }
const out = {
  generatedBy: 'scripts/gen-spt-explain-fixture.mjs',
  source: `serverless-portfolio-tracker@${sha} src/services/eventExplain.js listExplainable()`,
  catalogueAsOf: index.catalogueAsOf,
  brkVersion: index.brkVersion,
  packs: index.packs.map(({ id, title, summary, types }) => ({ id, title, summary, types })),
  types: index.types.map(({ type, pack, meaning, inEngine, estimated }) => ({ type, pack: pack?.id ?? null, meaning, inEngine, estimated })),
};
fs.mkdirSync(new URL('../test/fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../test/fixtures/spt-explain-index.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${out.types.length} types from ${sha}`);
