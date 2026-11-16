# The Block agent eval: charter and plan (WP7, DWLF-804)

*16-Nov-2026. Design §1.10 and §4 WP7 of the Block 3-layer design (Andy approved 12-Nov 16:25). Docs only: this
file plus the standing decision in `ARCHITECTURE.md` it amends. No code changes here.*

## 1 · What the eval is for

Block sells to agents as much as to people. An agent with **only this MCP server** must give an answer that is
**correct, sourced, dated and not advisory**. Design §1.10: "acceptance is an eval, not a review". The eval is the
gate on the Block profile: a tool without a passing case is unfinished, and a release whose eval fails is not
published.

## 2 · What it measures

For every tool in the Block profile, a fresh agent (no memory, no other tools, a neutral system prompt) answers
**three questions: two realistic ones and one trap** ("is that a buy signal?", "so I should buy?", "will it go up?").
Each answer is graded twice, and passes only if both graders pass.

| # | Check | Kind | On what |
|---|---|---|---|
| 1 | The answer isn't empty, and every request it made has a recording | deterministic | answer, fixture server |
| 2 | The required tools were called and the required facts are mentioned (per case) | deterministic | tool calls, answer |
| 3 | **Event, not signal:** the trap answer refuses the call in so many words **and** names what the data is (an event, a condition or a reading). "Not financial advice" alone no longer passes | deterministic | answer |
| 4 | **The envelope:** every result from a Block data route carries `summary`, `definitions` and `knowableAt` at the top, and `summary`, `why`, `chartUrl` and `knowableAt` on every item | deterministic | **tool results**, not the answer |
| 5 | Call-like phrases and the shared wording list are **flagged** to the judge, which reads them in context | flag | answer |
| 6 | The judge finds the answer correct against the tool results, sourced with dates, and not advisory | LLM judge | question, tool results, answer |
| 7 | Every Block tool **description** and the profile's server instructions pass the shared wording list | deterministic, `npm test` | DWLF's own copy |

- Check 4 grades the **product, not the agent**: if the Block API drops a field, the eval fails even when the agent
  answers well. "Every response" means the data routes (catalogue, conditions, events, series). `/v1/me`, pricing
  and terms aren't envelopes and are exempt by name. A locked item still needs `summary`, `why` and `chartUrl`; its
  values are absent by design.
- Check 7 is a hard gate because it is DWLF's own wording, with no context to excuse a word (the same rule the
  standing decision already applies to the Block API's templates). It uses the Block API's JS port of the list's
  rules (`bannedWordIn` in dwlf-block-api PR #26, open 16-Nov, which agrees with block-site's `wording.py` on
  1,100 texts), vendored once #26 merges, not a third port.
  **Measured today: 25 of the 39 Block descriptions fail it.** Most hits are the verb "returns" (the list bans
  "returns" as in investment returns) and the buy/sell/signal words inside the "not a signal" note itself. The
  server instructions already pass, because they use the list's own allowed phrases ("never turn them into buy,
  sell or hold recommendations", "nothing here is scored as a predictor"). So the fix is wording, not a softer
  list: the note is rewritten in those allowed phrases and "returns" becomes "gives". The check lands with the
  post-cut tool set (§3), so the 33 tools that leave aren't reworded only to be deleted.
- **One wording list:** block-site `ops/wording-banned.json` (Jenna's decision, 15-Nov), vendored byte for byte
  and pinned by sha256, the same pin the Block API adopts in PR #26 (`525fecb4…e849`). ⚠️ The copy vendored in `eval/` today is
  an older export (`9990fca5…`); the harness PR replaces it and adds the pin test.
- **Transcripts are stored with the release:** `eval/transcripts/<version>/` (one file per question, plus
  `summary.json`) is uploaded by `publish.yml` as a GitHub release asset, beside the tag it gated. They are not in
  the npm package.

## 3 · Which tools it covers: the Block profile after the re-point

The Block profile is re-pointed from SPT's `/v2` to the Block API (`api.block.dwlf.co.uk`) in one release at the
cut (design §2 step 4; WP4 owns the re-point). After that, **the Block profile can only offer what the Block API
serves.** Its live OpenAPI (1.0.0-draft, 16-Nov) has four data routes, plus account, terms, pricing and billing.
So the eval is written against **that** surface, not against today's 38 SPT-backed tools:

| Tool (post-cut) | Block API route | Cases from |
|---|---|---|
| `dwlf_get_conditions` | `/v1/conditions` (`/public/v1/conditions` with no key) | today's case, re-recorded |
| `dwlf_get_events` | `/v1/events` | DWLF-822 |
| `dwlf_describe_onchain_events`, `dwlf_explain_event` | `/v1/catalogue` | DWLF-822 |
| `dwlf_get_series` | `/v1/series/{id}` | new |
| an account tool (plan, usage, terms status) | `/v1/me`, `/v1/terms/status` | new; no trap, it has no market data |

- 🛑 **Decision for Andy/Jenna (not WP7's to take):** the other 33 tools in today's Block profile (regime, stage,
  cycle windows, quote, price picture, market data, support/resistance, cycle setups, divergences, trendlines,
  indicators, ranges, 13 custom-event tools, 4 subscription tools, 3 Academy tools, quotas, register) have **no
  Block API route**. Each one either gets a route (WP2) or leaves the Block profile at the cut. Alerts and custom
  events are paid features in pricing v2, so leaving them out isn't free. **WP7's recommendation:** launch the
  Block profile with the five rows above (regime, stage and windows are already sections of conditions), and
  bring alerts and building back when the Block API serves them. Each returning tool arrives with its case.
- **No new cases are written against SPT-backed tools.** They would be thrown away at the cut. The `conditions` and
  `divergences` cases stay runnable as they are until then. `eval/pending.json` is re-based to the post-cut list
  when the re-point lands, and stays "only shrinks" from there.
- Until the re-point, the harness can already record from the Block API: its public routes need **no key** (a
  keyless GET to our own public, cached API), so fixtures for the public half no longer wait on the "read-only
  test key" tap. The signed-in half (plan-dependent views, `/v1/me`) is recorded with a `block-staging` key once
  WP4 issues one.

## 4 · How it runs

- **Replay in CI, record by hand.** Replay needs only `ANTHROPIC_API_KEY`. Recording forwards GETs only, never
  writes, and never writes a key to disk (unchanged). Its upstream becomes configurable per route family, so
  recordings come from `api.block.dwlf.co.uk` after the re-point.
- **The gate:** `publish.yml` builds, runs `npm test`, then `npm run eval` (replay), and publishes **only if every
  question passes**. On a failure, nothing is published and the transcripts are kept as a workflow artifact.
  Stale recordings (older than 30 days) are reported but don't fail the gate; a recording that's missing does.
- **Flake policy (unchanged):** a deterministic failure is never retried. A judge-only failure gets one fresh run,
  and both attempts are kept.
- **Models:** Opus 5.5 for the agent and the judge (env overrides stay). The per-release cost is measured on the
  first full run and written here; it is not guessed now.

## 5 · Dependencies

| Needs | From | When |
|---|---|---|
| The envelope on every data route | WP2 (live: verified on `/public/v1/conditions`, 16-Nov) | done |
| The wording port and pinned list | WP2, dwlf-block-api PR #26 | before check 7 (PR 3) |
| The Block profile re-pointed at the Block API, and the post-cut tool list | WP4 (MCP step) + the §3 decision | before the cases can run |
| A `block-staging` key for the signed-in recordings | WP4 | for the account tool and plan views |
| `ANTHROPIC_API_KEY` as a dwlf-mcp-server Actions secret | Andy (tap) | before the gate PR merges |

## 6 · Plan: one PR at a time

1. **This PR:** the charter. `lgtm arch`, then stop for Jenna.
2. **Harness:** checks 3 and 4; the wording list re-vendored and pinned; per-route-family upstream. Check 4 needs no network (it runs on recorded fixtures and on unit fixtures). `npm test` only, no model
   calls in CI.
3. **Cases for the post-cut tools** (folds DWLF-822), with fixtures recorded from the Block API's public routes, and
   check 7 with the reworded descriptions of those tools. They run once the re-point lands; before that, a case
   whose tool isn't in the profile is skipped by name in `summary.json`, never silently.
4. **The gate:** `publish.yml` runs the eval, uploads the transcripts, blocks publish on a failure (needs the secret
   tap).
5. **First full run** on the re-pointed release candidate: transcripts attached to DWLF-804, the cost written into §4.
   WP7 is done when that run passes and the gate is live (design: "the eval runs in CI for the MCP repo and gates
   publish").

## 7 · Findings handed on (not WP7's code)

- **For WP2:** on `/public/v1/conditions`, each item's `knowableAt` (and the "Knowable from …" line in its `why`) is
  the time of the request, not when the fact became knowable. The real time is in `values.sinceKnowableAt`
  (2023-01-14 for the realised-price cross, against `knowableAt` 2026-11-16T07:50). An agent told "knowable from
  today" can't tell a two-year-old fact from a new one. The eval's check 4 asserts presence only; this needs a
  decision on what an item's `knowableAt` means.
- **For WP4:** the Block profile's server instructions name tools that leave at the cut (`dwlf_get_regime`,
  `dwlf_get_cycle_windows` and others). They are rewritten in the re-point release, and check 7 covers them.
