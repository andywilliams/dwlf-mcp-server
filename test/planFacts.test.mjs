import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFacts } from '../dist/client.js';

// DWLF-686: a plan refusal's facts must reach the agent (every tool reports error.message), so it can say which plan
// unlocks a locked family instead of guessing.
test('a Block family refusal keeps its code, family, requiredPlan and pricingUrl in the error message', () => {
  const body = { success: false, error: 'PLAN_REQUIRED', entitlement: 'family', family: 'cycles', plan: 'free', requiredPlan: 'block',
    upgradeUrl: 'https://block.dwlf.co.uk/pricing', pricingUrl: 'https://block.dwlf.co.uk/pricing/', message: 'Your plan (Free) doesn\'t include Cycles.' };
  assert.equal(planFacts(body), ' [PLAN_REQUIRED; family=cycles; requiredPlan=block; pricingUrl=https://block.dwlf.co.uk/pricing/]');
});

test('no plan facts → nothing appended (other errors unchanged)', () => {
  for (const body of [null, 'oops', { error: 'NOT_FOUND', message: 'x' }, { error: { message: 'x' } }]) { assert.equal(planFacts(body), ''); }
  assert.equal(planFacts({ error: 'RATE_LIMIT_EXCEEDED', requiredPlan: 'builder' }), ' [RATE_LIMIT_EXCEEDED; requiredPlan=builder]');
});
