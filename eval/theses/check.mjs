#!/usr/bin/env node
// Checks an agent's answer to evals/thesis-agent.md: node scripts/check-thesis-eval.mjs answer.json
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
check(/(night|nightly|end of day|end-of-day|after the close|daily close)/.test(t), 'explains: checked once a night after the close');
check(/(notif|told|telegram|digest|alert you|let you know|tells you)/.test(t), 'explains: the user is told when it happens');
check(/(before .*saved|knowable|already happened|after (it|the thesis|you) (is |are )?saved|from (now|the moment))/.test(t), 'explains: honest timing (nothing before saving counts)');
check(/(intraday|real[- ]time|end of day|end-of-day|once a night)/.test(t), 'states the limit: not intraday');
check(/(not advice|isn't advice|is not advice|no advice|doesn't tell you what to do|does not tell you what to do|not a recommendation)/.test(t), 'states the limit: information, not advice');
// A forecast or a call to act; a denial ("it won't tell you to buy or sell") is the honest limit, not advice.
check(!/\b(will (rise|fall|go up|go down|bounce|recover)|guarantee[sd]?|price target|you should (buy|sell|enter|exit)|(it's|it is) a (good|great) (buy|time to buy))\b/.test(t), 'no forecast or advice');
check(/(dry ?run|restate|show you .* before saving|confirm before)/.test(t), 'mentions a dry run / confirmation before saving');

if (failures.length) { console.log(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: exact, detectable payload; benefits and limits explained honestly.');
