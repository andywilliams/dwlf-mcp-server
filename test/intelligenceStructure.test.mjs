import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSemanticTools } from '../dist/tools/semantic.js';

// DWLF-771: dwlf_get_intelligence tells the agent what the swing ladder's supersession fields mean (SPT /v2/intelligence
// `structure` / `structureWeekly`; the full wording is the route's agentHints.structure).
const descriptions = {};
registerSemanticTools({ tool: (name, desc) => { descriptions[name] = desc; } }, { get: async () => ({}) });
const d = descriptions.dwlf_get_intelligence;

test('the description names every supersession field the route serves', () => {
  // each field in backticks, alone or as `field: value`
  for (const field of ['structure', 'structureWeekly', 'supersededBy', 'supersededKept', 'supersessionTracked', 'finalAfter',
    'structureIncomplete', 'agentHints.structure']) {
    assert.match(d, new RegExp(`\`${field.replace('.', '\\.')}[\`:]`), field);
  }
  assert.match(d, /`status`[^.]*"active"[^;]*;[^;]*"superseded"/, 'status and both of its string values');
});

test('a null status reads as unknown, never active; no pivot is called final while finalAfter is null', () => {
  assert.match(d, /null when[^.]*supersessionTracked[^.]*unknown, NOT active/);
  assert.match(d, /while it is null, don't call a pivot final/);
});
