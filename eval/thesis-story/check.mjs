#!/usr/bin/env node
// Checks an agent's narration of a thesis story (eval/thesis-story/README.md): node eval/thesis-story/check.mjs answer.json
import { readFileSync } from 'node:fs';

const answer = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fixture = readFileSync(new URL('./goog-story.json', import.meta.url), 'utf8');
const x = String(answer.narration || '');
const t = x.toLowerCase();
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

// The facts the story holds, in any wording.
check(/5 nov/.test(t) && /19 nov/.test(t) && /(fail|broke|break|no longer)/.test(t), 'says the 5 Nov daily low failed on 19 Nov');
check(/11 nov/.test(t), 'says when DWLF could first know the 5 Nov low (11 Nov)');
check(/weekly/.test(t) && /window/.test(t), 'says GOOG is inside its weekly cycle low window');
check(/(estimate|unverified)/.test(t), 'passes on that the window dates are engine estimates, unverified');
check(/step 1/.test(t) && /(next|new) (confirmed )?daily (cycle )?low/.test(t), 'step 1 needs the next confirmed daily low');
check(/higher daily (cycle )?low/.test(t) && /trend[- ]?line/.test(t), 'step 2 needs a higher daily low or a bullish daily trend-line break');
check(/(challeng|invalidat)/.test(t) && /daily close below/.test(t), 'names what would challenge it (a daily close below the latest confirmed daily low)');
check(/(waiting|no step|none of the steps|not (been )?met)/.test(t), 'says where it stands: waiting, no step met');

// Every price it quotes is one the story holds: nothing invented.
const prices = [...x.matchAll(/\b\d{2,}\.\d+\b/g)].map((m) => m[0]);
check(prices.every((p) => fixture.includes(p)), `no invented prices (${prices.filter((p) => !fixture.includes(p)).join(', ') || 'none'})`);

// No forecast or call to act, read clause by clause; a denial ("not a forecast") is the honest limit and passes.
const clauses = t.replace(/\b(no doubt|no question|without doubt)\b/g, '~').split(/(?<=[.!?:;])\s+|\n+|\s+(?:but|however|although|though|yet)\s+/).filter(Boolean);
const NEG = /\b(not|no|never|nothing|won't|doesn't|does not|isn't|is not|can't|cannot|neither|nor|without)\b/;
const negatedBefore = (c, re) => { const m = c.match(re); return Boolean(m) && NEG.test(c.slice(Math.max(0, m.index - 60), m.index)); };
const asserted = (re) => clauses.some((c) => re.test(c) && !negatedBefore(c, re));
const FORECAST = /\b(will (rise|fall|drop|go up|go down|bounce|recover|reverse|hold|break|form|confirm|come)|is (likely|about) to|likely|probably|expect(ed|s)?|should (rise|fall|hold|bounce|buy|sell)|price target|guarantee[sd]?|good (buy|entry)|time to (buy|sell)|you should (buy|sell|enter|exit))\b/;
check(!asserted(FORECAST), 'no forecast or call to act (what a step needs is not what will happen)');
// The 19 Nov break came before the challenge was set (20 Nov): it is context, not the challenge.
const CLAIMS_CHALLENGED = /\b(fits (that|the|this)|is (now )?challenged|was challenged|has been challenged|triggered|hit the (invalidation|challenge)|met the (invalidation|challenge)|counts as the challenge)\b/;
check(clauses.filter((c) => /challeng/.test(c) && /19 nov/.test(c)).every((c) => /(do(es)?n'?t|not|never) count/.test(c)),
  'ties the 19 Nov break to the challenge only to say it does not count (it was known before the challenge was set)');
check(!asserted(CLAIMS_CHALLENGED), 'does not call the thesis challenged by a break that came before the challenge was set');

if (failures.length) { console.log(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: the story told from its facts: what happened, where it stands, what it needs; no forecast.');
