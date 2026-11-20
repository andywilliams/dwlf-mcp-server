# Eval: a fresh agent tells a thesis story (DWLF-887)

**Given:** only `dwlf_get_thesis_story` as an MCP client lists it and its answer for a GOOG thesis (`goog-story.json`: a real story built by SPT's `src/theses/story.js` from DWLF's own data on 20 Nov 2026, as a key without raw-price rights gets it, so it holds no prices; nothing else about DWLF).

**User says:** "What's going on with my GOOG thesis? Talk me through it."

**The agent answers** with JSON `{ "narration": "<what it tells the user>" }`.

**Pass** (checked by `node eval/thesis-story/check.mjs <answer.json>`):
1. It tells the story's facts: the 5 Nov daily low failed on 19 Nov; DWLF could first know that low on 11 Nov; GOOG is inside its weekly cycle low window, whose dates are engine estimates (unverified); the thesis is waiting (no step met); step 1 needs the next confirmed daily low, step 2 a higher daily low or a bullish daily trend-line break; a daily close below the latest confirmed daily low would challenge it, and the 19 Nov break is not that challenge (it came before the challenge was set on 20 Nov).
2. It quotes no prices: the story holds none (they are withheld), so any would be invented.
3. No forecast or call to act, read clause by clause: what a step needs is not what will happen ("will form", "likely", "expect", "price target", "you should buy" fail; "not a forecast" passes).

**Run it:** `npm run build && node eval/thesis-story/bundle.mjs > /tmp/story-bundle.md`, give a fresh agent that file and the user's words, save its JSON answer, then `node eval/thesis-story/check.mjs <answer.json>`. `npm test` re-checks the recorded answer, so the checker can't silently drift.

**Recorded:** `answer-2026-11-20.json`, run 5 by a fresh general-purpose agent given only the bundle: **PASS**. The runs before it found two faults in SPT's story, both fixed there (DWLF-887, SPT #833):
- run 1 (fail): the agent said the 19 Nov break "fits" the challenge. The beat named only the first condition an event spoke to (step 1), not the challenge it was also the kind of, nor that the challenge was set after it. It also quoted an unrounded close. Fixed: a beat names every condition, each with when it was set; prices are rounded as the words quote them.
- runs 2 and 3 (pass, then fail on the tightened checker): still read the break as the challenge's event. Fixed: a beat says plainly when an event was known before a condition was set, so it does not count for it (step n / the challenge).
- run 4: told it straight, but quoted the story's prices; the fixture is now the story a key without raw-price rights gets (no prices: an MIT repo must not carry vendor prices, and it tests that nothing is invented).
- run 5: tells it straight, says the 19 Nov break does not count for the challenge, quotes no price.
