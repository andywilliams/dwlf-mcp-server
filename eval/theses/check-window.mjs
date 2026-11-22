#!/usr/bin/env node
// Checks an agent's answer to the window_closes scenario in eval/theses/README.md (DWLF-897):
// node eval/theses/check-window.mjs answer.json
import { readFileSync } from 'node:fs';
import { NEG, reader } from './clauses.mjs';

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
const { clauses, partBefore, matchesOf, denied, asserted } = reader(x);
check(/stored/.test(t) && /(close date|closing (bar|week)|window closes|closes)/.test(t), 'explains: checked against the stored window\'s close date');
// Andy's rule (22-Nov), judged in one clause: a low DATED inside the window still counts (saves the thesis) when it
// confirms after the close, within the decision days. And the old strict rule ("a low confirmed after the close does
// not count") must not be asserted.
const INSIDE = /\b(inside|in|within) the window\b|\bdated (inside|in|within|by)\b/;
const LATE = /\b(after the (close|window)|after it closes|confirm\w* (late|later)|confirmation (lag|takes))/;
const SAVES = /\b(count|counts|saves|save|rescues|rescue|still)\b/;
// Judged per sentence, not clause: the rule is a contrast ("confirms after the close, but within those days, still counts").
const sentences = t.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
const lagCounts = sentences.some((c) => INSIDE.test(c) && LATE.test(c) && matchesOf(c, SAVES).some((m) => !NEG.test(partBefore(c, m.index))));
check(lagCounts, 'explains Andy\'s rule: a low dated inside the window that confirms after the close (within the days) still counts');
const OLD = /\bconfirm\w* after (the |it |its )?(window )?(has |is )?(close|closes|closed|closing)\b/;
const strictAsserted = clauses.some((c) => OLD.test(c) && matchesOf(c, SAVES).some((m) => m.index > c.search(OLD) && NEG.test(partBefore(c, m.index))));
check(!strictAsserted, 'does not state the old strict rule (a low confirmed after the close does not count)');
check(/(28 days|four weeks|4 weeks)/.test(t), 'explains: decided 28 days after the close (weekly)');
check(/(once a night|every night|nightly|after the close|after each close)/.test(t), 'explains: checked once a night after the close');
check(denied(/\b(intraday|real[- ]time|the moment)\b/) || /end[- ]of[- ]day only/.test(t), 'states the limit: not intraday');
check(denied(/\b(advice|tell you what to do|recommend)/), 'states the limit: information, not advice');
const CALL = /\b(will (rise|fall|go up|go down|bounce|recover|reverse)|guarantee[sd]?|price target|you should (buy|sell|enter|exit)|good (buy|entry)|time to (buy|sell))\b/;
check(!asserted(CALL), 'no forecast or call to act');
check(/(dry ?run|restate|before (i |we )?sav)/.test(t), 'mentions a dry run / confirmation before saving');

if (failures.length) { console.log(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: window_closes as the invalidation only, no invented level; the stored close date, the decision point and Andy\'s rule explained.');
