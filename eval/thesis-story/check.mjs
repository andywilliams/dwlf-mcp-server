#!/usr/bin/env node
// Checks an agent's narration of a thesis story (eval/thesis-story/README.md): node eval/thesis-story/check.mjs answer.json
import { readFileSync } from 'node:fs';

const answer = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const x = String(answer.narration || '');
// DWLF's own panel text, quoted as served (it denies a forecast and names "a price target" to rule it out), is not the
// agent's claim: it is taken out before the clause checks.
// So are the legend's names for the routes ("a route that challenges the thesis" names a route, it claims nothing).
// And the story's own disclaimer (it too names "a price target" to deny it). Read from the fixture the run was given.
const fixture = process.argv[3] === 'replay' ? './goog-story-replay.json' : './goog-story-routes.json';
const { illustration, disclaimer } = JSON.parse(readFileSync(new URL(fixture, import.meta.url), 'utf8'));
const t = [illustration.disclaimer.text, ...Object.values(illustration.legend), disclaimer?.text].filter(Boolean).map((s) => s.toLowerCase())
  .reduce((acc, quoted) => acc.split(quoted).join('~'), x.toLowerCase());
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

const mode = process.argv[3] || 'story';
// The facts the story holds, in any wording (the story and routes runs; a replay is asked a different question).
if (mode !== 'replay') {
check(/5 nov/.test(t) && /19 nov/.test(t) && /(fail|broke|break|no longer)/.test(t), 'says the 5 Nov daily low failed on 19 Nov');
check(/11 nov/.test(t), 'says when DWLF could first know the 5 Nov low (11 Nov)');
check(/weekly/.test(t) && /window/.test(t), 'says GOOG is inside its weekly cycle low window');
check(/(estimate|unverified)/.test(t), 'passes on that the window dates are engine estimates, unverified');
check(/step 1/.test(t) && /(next|new) (confirmed )?daily (cycle )?low/.test(t), 'step 1 needs the next confirmed daily low');
check(/higher daily (cycle )?low/.test(t) && /trend[- ]?line/.test(t), 'step 2 needs a higher daily low or a bullish daily trend-line break');
check(/(challeng|invalidat)/.test(t) && /daily close below/.test(t), 'names what would challenge it (a daily close below the latest confirmed daily low)');
check(/(waiting|no step|none of the steps|not (been )?met)/.test(t), 'says where it stands: waiting, no step met');
}

// The story is the one a key without raw-price rights gets: it holds no prices, so the narration quotes none (a
// decimal, or a whole number of three or more digits that is not a year, is taken as a price).
const prices = [...x.matchAll(/\b\d+\.\d+\b|\b(?!20\d\d\b)\d{3,}\b/g)].map((m) => m[0]);
check(!prices.length, `no invented prices (${prices.join(', ') || 'none'})`);

// No forecast or call to act, read clause by clause; a denial ("not a forecast") is the honest limit and passes.
const clauses = t.replace(/\b(no doubt|no question|without doubt)\b/g, '~').split(/(?<=[.!?:;])\s+|\n+|\s+(?:but|however|although|though|yet)\s+/).filter(Boolean);
const NEG = /\b(not|no|never|none|nothing|won't|doesn't|does not|don't|do not|isn't|is not|can't|cannot|neither|nor|without)\b/;
// A negation denies a match only within its own part of the clause ("not advice, and it will rise" asserts the rise),
// and each match is judged on its own ("it does not say a low will form, and GOOG will rise" asserts the second).
const deniedAt = (c, index) => NEG.test(c.slice(0, index).split(/,|;|\band\b|\bso\b/).pop());
const matchesOf = (c, re) => [...c.matchAll(new RegExp(re.source, 'g'))];
const asserted = (re) => clauses.some((c) => matchesOf(c, re).some((m) => !deniedAt(c, m.index)));
const FORECAST = /\b(will (rise|fall|drop|go up|go down|bounce|recover|reverse|hold|break|form|confirm|come)|is (likely|about) to|likely|probably|expect(ed|s)?|should (rise|fall|hold|bounce|buy|sell)|price target|guarantee[sd]?|good (buy|entry)|time to (buy|sell)|you should (buy|sell|enter|exit))\b/;
check(!asserted(FORECAST), 'no forecast or call to act (what a step needs is not what will happen)');
// The 19 Nov break came before the challenge was set (20 Nov): it is context, not the challenge.
const CLAIMS_CHALLENGED = /\b(fits (that|the|this)|is (now )?challenged(?! (by an? |if |when |only ))|was challenged|(break|close|event|it|that|this) (challenged|challenges) (the thesis|it)|has been challenged|triggered|hit the (invalidation|challenge)|met the (invalidation|challenge)|counts as the challenge)\b/;
check(clauses.filter((c) => /challeng/.test(c) && /19 nov/.test(c)).every((c) => /(do(es)?n'?t|not|never) count/.test(c)),
  'ties the 19 Nov break to the challenge only to say it does not count (it was known before the challenge was set)');
check(!asserted(CLAIMS_CHALLENGED), 'does not call the thesis challenged by a break that came before the challenge was set');

// With routes (`check.mjs answer.json routes`, the goog-story-routes.json fixture, DWLF-888): told as illustrations, both
// kinds, by what they were drawn from; never as where price is heading.
if (mode === 'routes') {
  // What is said is read from the whole narration, quotes included (quoting the legend names both kinds).
  const said = x.toLowerCase();
  check(/(illustrat|not a forecast)/.test(said), 'calls the routes illustrations (not a forecast)');
  check(/\b(route|shape|path)s?\b/.test(said) && /\bmeet/.test(said) && /challeng/.test(said), 'names both: a route that meets the steps and one that challenges the thesis');
  // In the agent's own words (the panel text's "past cycles" does not count): a leg tied to a window edge, a band
  // percentile, a cycle length or the condition's level.
  check(/(window('s)? cent(re|er)|percentile|p75|p25|median|cycle length|half (the|a) (median )?cycle|condition'?s? (own )?level)/.test(t), 'says what a route was drawn from (a window edge, a band percentile, a cycle length)');
  // ("projected to open" is the engine's own word for a window date, so "projected" is not on the list.)
  const HEADING = /\b(heading (for|to|toward)|on track (to|for)|will (reach|bottom|top|get to|land|hit|test)|is going to|targets?|aims? for|the next leg (is|will))\b/;
  check(!asserted(HEADING), 'never tells a route as where price is heading');
}


// Replay (`check.mjs answer.json replay`, the goog-story-replay.json fixture, DWLF-889): the plan as drawn against what
// happened, in facts only. GOOG's real plan (reconstructed after the fact, no routes) with one SIMULATED fire: step 1
// met on the 20 Nov bar.
if (mode === 'replay') {
  const said = x.toLowerCase();
  // Each fact read within one sentence (a window "opens", a revision on 20 Nov, do not count for it).
  const sentences = t.split(/(?<=[.!?])\s+|\n+/);
  const inOne = (re) => sentences.some((c) => re.test(c));
  check(inOne(/step 1\b[^.]*\bmet\b[^.]*\b20 nov|\b20 nov\b[^.]*step 1\b[^.]*\bmet\b/), 'says step 1 was met on 20 Nov');
  check(inOne(/step 2\b[^.]*\b(not (yet )?(been )?met|is not\b|isn'?t met|has not been met|unmet|still needs)/), 'says step 2 is not met yet');
  check(/reconstruct/.test(said) && /(not captured|after the fact|wasn'?t captured|was not captured)/.test(said), 'says the plan it is replayed against was reconstructed after the fact, not captured at the time');
  // Never a score: no early/late, no right/wrong, no "as planned", no gap in days between the plan and the event.
  const SCORE = /\b(early|late|ahead of (schedule|plan|time)|behind (schedule|plan)|on (time|schedule)|accurate(ly)?|inaccurate|(was|were|got it|proved) (right|wrong)|correct(ly)? (called|predicted)|hit (the|its) (mark|target)|missed (the|its) (mark|target)|off by|as (predicted|planned|expected|forecast)|went (to|according to) plan|played out (as|like) (planned|drawn|expected)|matched the plan|beat the plan|\d+ (trading )?days? (early|late|before|after|sooner|ahead))\b/;
  check(!asserted(SCORE), 'never scores the plan against what happened (no early/late, right/wrong, "as planned", gap in days)');
  // The plan drew no route to step 1 (illustrated: null): no claim of where or when it had illustrated it.
  const INVENTED_RING = /\b(plan|illustration|route) (had )?(illustrated|drew|showed|put|placed|marked) (step 1|the (step 1 )?low|it)\b/;
  check(!asserted(INVENTED_RING), 'invents no illustrated point for step 1 (the plan drew none)');
  if (/\b(route|dashed|shape)s?\b/.test(said)) { check(/(illustrat|not a forecast)/.test(said), 'any route mentioned is called an illustration (not a forecast)'); }
}

if (failures.length) { console.log(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: the story told from its facts: what happened, where it stands, what it needs; no forecast.');
