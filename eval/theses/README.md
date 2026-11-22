# Eval: a fresh agent saves a thesis and explains it (DWLF-891)

**Given:** only the thesis tools as an MCP client lists them (descriptions and full parameter schemas) and `dwlf_thesis_guide` (no other DWLF context). The scenario is like the guide's GOOG example but on another symbol and dates, so copying won't pass: the agent has to apply the rules.

**User says:** "I trade NVDA. Its 12 Nov daily cycle low failed on 18 Nov. Tell me when the next daily cycle low is confirmed, and after that either a higher daily low or a bullish daily trend-line break. If the weekly cycle low breaks, I want to know. Also: what does DWLF actually do for me here, and what doesn't it do?"

**The agent answers** with JSON `{ "payload": <dwlf_create_thesis arguments>, "explanation": "<what it tells the user>" }`.

**Pass** (checked by `node eval/theses/check.mjs <answer.json>`):
1. The payload is exact and detectable: only the six condition types, each with its required fields, every condition labelled; step 1 is `pivot_confirmed` daily low with `after` on or after 2026-11-12 (the next pivot after the failed one); step 2 offers `engine_event cycle.low.higher_low` (daily) or a bullish daily `trendline_break`; the invalidation is `engine_event cycle.low.break` (weekly) and never a close below a low that doesn't exist yet; no manual invalidation.
2. The explanation states the benefits correctly: checked once a night after the close (end of day); the user is told when a step is met or it is challenged; honest timing (nothing known before saving counts / knowable-at).
3. It states the limits: not intraday; information, not advice. No sentence forecasts or calls to act ("will rise", "price target", "guaranteed", "you should buy"); a sentence that denies them ("it won't tell you to buy or sell", "no price target") is the honest limit and passes.
4. It suggests a dry run first (or says it will show the restatement before saving).

**Run it:** `npm run build && node eval/theses/bundle.mjs > /tmp/agent-docs.md` (the descriptions and the guide, nothing else), give a fresh agent that file and the user's words above, save its JSON answer, then `node eval/theses/check.mjs <answer.json>`. `npm test` re-checks the recorded answer below, so the checker can't silently drift.

**Recorded:** `answer-2026-11-20.json`, run 4 by a fresh general-purpose agent given only the bundle: **PASS**. All four runs passed:
- run 1: the first draft;
- run 2: a bundle whose schemas were empty (a bundle bug, now fixed);
- run 3: its bundle had leaked the scenario's date into the glossary (removed);
- run 4: clean, full schemas, nothing from the scenario in the docs.

Questions the runs raised, now answered in the guide's `glossary`:
- whether `after` is inclusive, and which date to use;
- which trend line is meant;
- which weekly low counts and on which closes;
- what `higher_low` compares against;
- whether a step can be met in the same night as the one before;
- the `engine_event` allow-list;
- `group`;
- whether the `cycle.low.break` level is fixed at save time (it moves with the latest confirmed low).

## Scenario 2: void by time with window_closes (DWLF-897)

**User says:** "I trade GDX. I'm waiting for its weekly cycle low inside the weekly low window. Tell me when that window opens and when the next weekly cycle low is confirmed. I don't have a price level that would prove me wrong, but if the window closes without a confirmed weekly low, the idea is void, so I want to know then. What exactly will DWLF check, and what won't it do?" (The guide's worked example is SLV, so copying it won't pass.)

**Pass** (`node eval/theses/check-window.mjs <answer.json>`):
1. **Payload:**
   - `window_closes` (weekly, low) is the invalidation, and it appears in no step;
   - a step waits for the next confirmed weekly low;
   - no price level is invented;
   - only listed types, every field and label present.
2. **Explanation:**
   - says it is checked against the stored window's close;
   - says it is decided 28 days after the close;
   - gives **Andy's rule** (22-Nov): a low dated inside the window that confirms after the close, within those days, still counts;
   - never states the old strict rule;
   - gives the nightly timing and the limits;
   - makes no forecast;
   - mentions a dry run.

**Recorded:** each run was made by a fresh general-purpose agent given only the bundle.
- `answer-window-2026-11-22-run3.json`: **PASS**.
- `answer-window-2026-11-22-run4.json`: **PASS**.
- Runs 1 and 2, made under the earlier strict rule, are retired: they fail this checker, as they should.
- The rule is judged per sentence, because it is a contrast ("after the close, but within those 28 days, still counts").

Questions the runs raised, now answered in the guide:
- whether a step's low must be dated in the window;
- what a low confirmed before the window opens does;
- whether step 2 needs `after`;
- that a low dated after the close can meet step 2 while the void still fires (both are reported).
