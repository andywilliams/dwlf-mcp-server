import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerSemanticTools } from '../dist/tools/semantic.js';

// DWLF-771: dwlf_get_intelligence tells the agent what the swing ladder's supersession fields mean (SPT /v2/intelligence
// `structure` / `structureWeekly`; the full wording is the route's agentHints.structure).
const descriptions = {};
registerSemanticTools({ tool: (name, desc) => { descriptions[name] = desc; } }, { get: async () => ({}) });
const d = descriptions.dwlf_get_intelligence;

test('the description names every supersession field the route serves', () => {
  for (const field of ['structureWeekly', 'status', 'supersededBy', 'supersededKept', 'supersessionTracked', 'finalAfter', 'structureIncomplete', 'agentHints.structure']) {
    assert.ok(d.includes(field), field);
  }
});

test('a null status reads as unknown, never active; nothing is called final', () => {
  assert.match(d, /null when[^.]*supersessionTracked[^.]*unknown, NOT active/);
  assert.match(d, /never call a pivot final/);
});

test('server.json and package.json carry the same version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const srv = JSON.parse(readFileSync(new URL('../server.json', import.meta.url)));
  assert.equal(srv.version, pkg.version);
  assert.ok(srv.packages.every((p) => p.version === pkg.version));
});
