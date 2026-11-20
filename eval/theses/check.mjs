#!/usr/bin/env node
// Checks an agent's answer to eval/theses/README.md: node eval/theses/check.mjs answer.json
import { readFileSync } from 'node:fs';

const REQUIRED = {
  pivot_confirmed: ['timeframe', 'side'], close_vs_level: ['basis', 'op', 'value'], window_opens: ['timeframe', 'side'],
  trendline_break: ['timeframe', 'direction'], engine_event: ['timeframe', 'eventType'], manual: ['label'],
};
const answer = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { payload: p = {}, explanation: x = '' } = answer;
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

const all = [...(p.steps || []).flatMap((s) => s.conditions || []), ...(p.invalidation || [])];
check(String(p.symbol).toUpperCase() === 'NVDA', 'symbol NVDA');
check(all.every((c) => REQUIRED[c.type]), 'only the six condition types');
check(all.every((c) => (REQUIRED[c.type] || []).every((f) => c[f] !== undefined && c[f] !== '')), 'every required field present');
check(all.every((c) => typeof c.label === 'string' && c.label.trim()), 'every condition labelled');
const s1 = p.steps?.[0]?.conditions || [];
check(s1.some((c) => c.type === 'pivot_confirmed' && /^d/.test(c.timeframe) && c.side === 'low' && typeof c.after === 'string' && c.after >= '2026-11-12'),
  'step 1: pivot_confirmed daily low with after >= 2026-11-12');
const s2 = p.steps?.[1]?.conditions || [];
check(s2.some((c) => c.type === 'engine_event' && c.eventType === 'cycle.low.higher_low') && s2.some((c) => c.type === 'trendline_break' && c.direction === 'bullish')
  && (p.steps?.[1]?.match || 'any') === 'any', 'step 2: any of a higher daily low or a bullish daily trend-line break');
const inv = p.invalidation || [];
check(inv.some((c) => c.type === 'engine_event' && c.eventType === 'cycle.low.break' && /^w/.test(c.timeframe)), 'invalidation: weekly cycle.low.break');
check(inv.every((c) => c.type !== 'manual'), 'no manual invalidation');

const t = x.toLowerCase();
// Clause by clause (split at sentence ends, semicolons and contrast words, never at commas, so a negated list stays one
// clause): the words count as denied when a negation stands within a few words before them ("it doesn't give forecasts,
// guarantees or a price target"), and as asserted otherwise ("not advice, but it will rise"; "there is no doubt it will rise").
const clauses = t.replace(/\b(no doubt|no question|not only|without doubt)\b/g, '~').split(/(?<=[.!?:;])\s+|\n+|\s+(?:but|however|although|though|yet)\s+/).filter(Boolean);
const NEG = /\b(not|no|never|nothing|won't|doesn't|does not|isn't|is not|can't|cannot|neither|nor|without)\b/;
const negatedBefore = (c, re) => { const m = c.match(re); return Boolean(m) && NEG.test(c.slice(Math.max(0, m.index - 60), m.index)); };
const denied = (re) => clauses.some((c) => negatedBefore(c, re));
const asserted = (re) => clauses.some((c) => re.test(c) && !negatedBefore(c, re));
check(/(once a night|every night|nightly|after the close|after each close)/.test(t), 'explains: checked once a night after the close');
check(/(notif|told|telegram|digest|let you know|tells you)/.test(t), 'explains: the user is told when it happens');
check(/(before .*saved|knowable|could first know|already happened)/.test(t), 'explains: honest timing (nothing before saving counts)');
check(denied(/\b(intraday|real[- ]time|the moment)\b/) || /end[- ]of[- ]day only/.test(t), 'states the limit: not intraday (a denied intraday, or "end of day only")');
check(denied(/\b(advice|tell you what to do|recommend)/), 'states the limit: information, not advice');
const CALL = /\b(will (rise|fall|go up|go down|bounce|recover|reverse)|guarantee[sd]?|price target|you should (buy|sell|enter|exit)|good (buy|entry)|time to (buy|sell))\b/;
check(!asserted(CALL), 'no forecast or call to act (a denial is the honest limit, not advice)');
check(/(dry ?run|restate|before (i |we )?sav)/.test(t), 'mentions a dry run / confirmation before saving');

if (failures.length) { console.log(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: exact, detectable payload; benefits and limits explained honestly.');
