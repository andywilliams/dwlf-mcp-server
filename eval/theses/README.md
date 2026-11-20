# Eval: a fresh agent saves a thesis and explains it (DWLF-891)

**Given:** only the thesis tool descriptions and `dwlf_thesis_guide` (no other DWLF context). The scenario is like the guide's GOOG example but on another symbol and dates, so copying won't pass: the agent has to apply the rules.

**User says:** "I trade NVDA. Its 12 Nov daily cycle low failed on 18 Nov. Tell me when the next daily cycle low is confirmed, and after that either a higher daily low or a bullish daily trend-line break. If the weekly cycle low breaks, I want to know. Also: what does DWLF actually do for me here, and what doesn't it do?"

**The agent answers** with JSON `{ "payload": <dwlf_create_thesis arguments>, "explanation": "<what it tells the user>" }`.

**Pass** (checked by `node eval/theses/check.mjs <answer.json>`):
1. The payload is exact and detectable: only the six condition types, each with its required fields, every condition labelled; step 1 is `pivot_confirmed` daily low with `after` on or after 2026-11-12 (the next pivot after the failed one); step 2 offers `engine_event cycle.low.higher_low` (daily) or a bullish daily `trendline_break`; the invalidation is `engine_event cycle.low.break` (weekly) and never a close below a low that doesn't exist yet; no manual invalidation.
2. The explanation states the benefits correctly: checked once a night after the close (end of day); the user is told when a step is met or it is challenged; honest timing (nothing known before saving counts / knowable-at).
3. It states the limits: not intraday; information, not advice. It doesn't forecast or advise (no "will rise", "buy", "sell", "target", "guaranteed").
4. It suggests a dry run first (or says it will show the restatement before saving).

**Run it:** `npm run build && node eval/theses/bundle.mjs > /tmp/agent-docs.md` (the descriptions and the guide, nothing else), give a fresh agent that file and the user's words above, save its JSON answer, then `node eval/theses/check.mjs <answer.json>`. `npm test` re-checks the recorded answer below, so the checker can't silently drift.

**Recorded:** `answer-2026-11-20.json`, a fresh general-purpose agent given only the bundle (0.70.0 docs): **PASS** on the first run. It asked for more detail on `after`, which trend line, which weekly low counts as "latest confirmed", and `group`; these are now in the guide's `glossary`.
