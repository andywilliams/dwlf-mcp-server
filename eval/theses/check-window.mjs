#!/usr/bin/env node
// Checks an agent's answer to the window_closes scenario in eval/theses/README.md (DWLF-897):
// node eval/theses/check-window.mjs answer.json
import { readFileSync } from 'node:fs';

const REQUIRED = {
  pivot_confirmed: ['timeframe', 'side'], close_vs_level: ['basis', 'op', 'value'], window_opens: ['timeframe', 'side'],
  window_closes: ['timeframe', 'side'], trendline_break: ['timeframe', 'direction'], engine_event: ['timeframe', 'eventType'], manual: ['label'],
};
const answer = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { payload: p = {}, explanation: x = '' } = answer;
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };
const weekly = (c) => /^w/.test(String(c.timeframe));

const steps = (p.steps || []).flatMap((s) => s.conditions || []);
const inv = p.invalidation || [];
const all = [...steps, ...inv];
check(String(p.symbol).toUpperCase() === 'GDX', 'symbol GDX');
check(all.every((c) => REQUIRED[c.type]), 'only the listed condition types');
check(all.every((c) => (REQUIRED[c.type] || []).every((f) => c[f] !== undefined && c[f] !== '')), 'every required field present');
check(all.every((c) => typeof c.label === 'string' && c.label.trim()), 'every condition labelled');
check(steps.some((c) => c.type === 'pivot_confirmed' && weekly(c) && c.side === 'low'), 'a step waits for the next confirmed weekly cycle low');
check(steps.filter((c) => c.type === 'window_opens').every((c) => weekly(c) && c.side === 'low'), 'any window_opens is the weekly low window');
check(inv.some((c) => c.type === 'window_closes' && weekly(c) && c.side === 'low'), 'invalidation: window_closes on the weekly low window');
check(steps.every((c) => c.type !== 'window_closes'), 'window_closes only as an invalidation, never in a step');
check(all.every((c) => c.type !== 'close_vs_level' && !c.level), 'no price level invented (the user has none)');
check(inv.every((c) => c.type !== 'manual'), 'no manual invalidation');

const t = x.toLowerCase();
const clauses = t.replace(/\b(no doubt|no question|not only|without doubt)\b/g, '~').split(/(?<=[.!?:;])\s+|\n+|\s+(?:but|however|although|though|yet)\s+/).filter(Boolean);
const NEG = /\b(not|no|never|nothing|won't|doesn't|does not|isn't|is not|can't|cannot|neither|nor|without)\b/;
const negatedBefore = (c, re) => { const m = c.match(re); return Boolean(m) && NEG.test(c.slice(Math.max(0, m.index - 60), m.index)); };
const denied = (re) => clauses.some((c) => negatedBefore(c, re));
const asserted = (re) => clauses.some((c) => re.test(c) && !negatedBefore(c, re));
check(/stored/.test(t) && /(close date|closing (bar|week)|window closes|closes)/.test(t), 'explains: checked against the stored window\'s close date');
// The strict rule in any wording: one clause says a low confirmed after the close is negated as counting / saving /
// rescuing it ("doesn't save it", "won't count"), or that it must be confirmed by (before) the close.
const strict = clauses.some((c) => /\bafter (the |it |its )?(window )?(has |is )?(close|closes|closed|closing|ends|ended)\b/.test(c)
  && /\b(does not|doesn't|won't|will not|not|never|no longer)\b[^.]*\b(count|rescue|save|help|undo|cancel)/.test(c))
  || /confirmed (by|before) the (close|window clos)/.test(t);
check(strict, 'explains the strict rule: a low confirmed after the close does not count');
check(/(28 days|four weeks|4 weeks)/.test(t), 'explains: decided 28 days after the close (weekly)');
check(/(once a night|every night|nightly|after the close|after each close)/.test(t), 'explains: checked once a night after the close');
check(denied(/\b(intraday|real[- ]time|the moment)\b/) || /end[- ]of[- ]day only/.test(t), 'states the limit: not intraday');
check(denied(/\b(advice|tell you what to do|recommend)/), 'states the limit: information, not advice');
const CALL = /\b(will (rise|fall|go up|go down|bounce|recover|reverse)|guarantee[sd]?|price target|you should (buy|sell|enter|exit)|good (buy|entry)|time to (buy|sell))\b/;
check(!asserted(CALL), 'no forecast or call to act');
check(/(dry ?run|restate|before (i |we )?sav)/.test(t), 'mentions a dry run / confirmation before saving');

if (failures.length) { console.log(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: window_closes as the invalidation only, no invented level; the stored close date, the strict rule and the decision delay explained.');
