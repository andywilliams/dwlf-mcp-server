# The Block agent eval: charter and plan (WP7, DWLF-804)

*16-Nov-2026. Design §1.10 and §4 WP7 of the Block 3-layer design (Andy approved 12-Nov 16:25). Docs only: this
file, plus in `ARCHITECTURE.md` a proposed amendment to the eval standing decision (under *Proposed — not in force*) and the scheduled-change notes for the Block cut. No code.*

## 1 · What the eval is for

Block sells to agents as much as to people. An agent with **only this MCP server** must give an answer that is
**correct, sourced, dated and not advisory**. Design §1.10 says "acceptance is an eval, not a review". The eval
gates the Block profile: a tool without a passing case is unfinished, and a release whose eval fails isn't
published.

## 2 · What it measures

For every tool in the Block profile, a fresh agent answers **three questions: two realistic ones and one trap**
("is that a buy signal?", "so I should buy?", "will it go up?"). The agent has no memory, no other tools and a
neutral system prompt. Each answer is graded twice, and it passes only if both graders pass.

| # | Check | Kind | On what |
|---|---|---|---|
| 1 | The answer isn't empty, and every request it made has a recording | deterministic | answer, fixture server |
| 2 | The required tools were called and the required facts are mentioned, **including each dated fact's own date** | deterministic | tool calls, answer |
| 3 | **Event, not signal:** the trap answer refuses the call in so many words **and** names what the data is (an event, a condition or a reading). "Not financial advice" on its own no longer passes | deterministic | answer |
| 4 | **The envelope reaches the agent:** each Block data tool's result contains the upstream body whole (pass-through), and at record time each live body has the fields the Block API's own OpenAPI requires (`summary`, `definitions`, `knowableAt` at the top; `summary`, `why`, `chartUrl`, `knowableAt` per item) | deterministic, `npm test` + record time | **tool results and recordings**, not the answer |
| 5 | Call-like phrases and the shared wording list are **flagged** to the judge, which reads them in context | flag | answer |
| 6 | The judge finds the answer correct against the tool results, sourced with dates, and not advisory | LLM judge | question, tool results, answer |
| 7 | Every Block tool **description** and the profile's server instructions pass the shared wording list | deterministic, `npm test` | DWLF's own copy |

**Check 4: who owns what.**
- **The Block API owns its envelope.** Its contract test (the OpenAPI schema and its route tests) is where a dropped
  field goes red first.
- **This repo owns the pass-through** (invariant 2): no tool strips, reshapes or unwraps the envelope on its way to
  the agent. It's checked in `npm test`, for every Block data tool rather than only the ones an agent happens to
  call: the tool is replayed against a recording, and its result must contain the recorded upstream body whole.
  That needs no copy of the field list, so a field the Block API renames doesn't need an edit here. It's also why
  Block responses are exempt from the scheduled "unwrap once" change (noted under invariant 2): unwrapping to
  `items` would drop `summary` and `definitions`.
- **Live drift is caught when recording.** The fixture server checks each live data-route body against the
  `required` lists in the Block API's own `/public/v1/openapi.json`, fetched at record time. A body that fails is
  reported as a Block API defect and isn't saved. So a Block API regression shows up the next time anyone records,
  and this repo never decides what the envelope contains.
- "Every response" means the data routes (catalogue, conditions, events, series). `/v1/me`, pricing and terms
  aren't envelopes, and they're exempt by name. A locked item still needs `summary`, `why` and `chartUrl`; its
  values are absent by design.
- **`knowableAt` is checked for presence only, and it is not trusted as a date** (see §7: on conditions it is the
  request time today). Until WP2 settles what an item's `knowableAt` means, the dates are graded by check 2 (each
  case names the fact's own date, e.g. 2023-01-13 for the realised-price cross) and by the judge. The judge is told
  that an answer dating a fact to the day of the request is wrong when the tool result shows an earlier
  `date`/`since`.

**Check 7: the wording gate.**
- It's a hard gate because it's DWLF's own wording, and no context excuses a word there. The standing decision
  already applies the same rule to the Block API's templates.
- It uses the Block API's JS port of the list's rules (`bannedWordIn`, dwlf-block-api PR #26, open 16-Nov). That
  port agrees with block-site's `wording.py` on 1,100 texts. It's vendored once #26 merges; there's no third port.
- **Measured today: 25 of the 39 Block descriptions fail it.** Most hits are:
  - the verb "returns" (the list bans "returns" in the sense of investment returns);
  - the buy/sell/signal words inside the "not a signal" note itself.
- The server instructions already pass, because they use the list's own allowed phrases ("never turn them into
  buy, sell or hold recommendations", "nothing here is scored as a predictor"). So the fix is wording, not a softer
  list: the note is rewritten in those phrases, and "returns" becomes "gives".
- **One list:** block-site's `ops/wording-banned.json` (Jenna's decision, 15-Nov), vendored byte for byte with its
  sha256 pinned, the same as dwlf-block-api #26 (`525fecb4…e849`).
- **One command shows drift:** `npm run wording:sync` copies the list and the port from one named block-site commit
  and one named dwlf-block-api commit, in one commit here. `npm run wording:sync -- --check` fails if either source
  has moved on. The pinned sha alone only proves the local copy wasn't edited.
- `--check` runs by hand in the release checklist (the person recording already has `gh`). `publish.yml` gets no
  cross-repo credential and stays OIDC-only. *Accepted debt:* the list can drift between syncs.
- A list change enters only through a sync commit, so it can't block a release (a `full`-profile hotfix, say)
  that didn't pull it. A sync that tightens the list can hold up the next release on any Block description. That
  is intended: the descriptions must pass the current list.
- ⚠️ The copy vendored in `eval/` today is an older export (`9990fca5…`). That drift has already happened once.

**Transcripts are stored with the release.** `eval/transcripts/<version>/` holds one file per question, plus
`summary.json`. `publish.yml` uploads it as a GitHub release asset, beside the tag it gated. It is not in the npm
package.

## 3 · Which tools it covers

The Block profile is re-pointed from SPT's `/v2` to the Block API (`api.block.dwlf.co.uk`) in one release at the
cut (design §2 step 4; WP4 owns the re-point). After that, **the Block profile can only offer what the Block API
serves.** The Block API's live OpenAPI (1.0.0-draft, 16-Nov) has four data routes, plus account, terms, pricing and
billing.

**Tools that exist in every outcome, with cases now:**

| Tool | Block API route after the cut | Cases |
|---|---|---|
| `dwlf_get_conditions` | `/v1/conditions` (`/public/v1/conditions` with no key) | exists; re-recorded at the cut |
| `dwlf_get_events` | `/v1/events` | DWLF-822 |
| `dwlf_describe_onchain_events`, `dwlf_explain_event` | `/v1/catalogue` | DWLF-822 |
| `dwlf_get_series` (new) | `/v1/series/{id}` | arrives with the tool |
| an account tool (plan, usage, terms status) | `/v1/me`, `/v1/terms/status` | arrives with the tool; no trap (no market data) |

For these tools, the questions are written once. Only the fixtures change at the cut, so cases are written now
against today's backend and re-recorded then.

**The other 33 tools: a product decision, not WP7's.** These are:
- regime, stage, cycle windows, quote, price picture, market data, support/resistance, cycle setups, divergences,
  trendlines, indicators and ranges;
- the 13 custom-event tools and the 4 subscription tools;
- the 3 Academy tools, quotas and register.

None of them has a Block API route. Each either gets one (WP2) or leaves the Block profile at the cut. That's 🛑
**a decision for Andy/Jenna**, recorded on its own ticket rather than settled here.
- **WP7's recommendation:** launch with the tools above (regime, stage and windows are already sections of
  conditions). Bring alerts and building back when the Block API serves them.
- **If alerts and custom events stay:** each family needs its Block API routes first (WP2). Then one WP7 PR per
  family: its cases, its check-7 rewording, its recordings. The plan grows by those PRs and nothing else changes.
- **The tool list is shown, not hidden.** Removing tools from the profile changes what agents set up through
  `docs/BLOCK.md` can call. The cut release says so in its notes and in `docs/BLOCK.md`'s tool list. The profile
  *name* stays, as the charter requires.
- **Until that decision, the debt is accepted and time-boxed:** description changes to the 33 undecided tools
  ship with only today's `npm test` guards. Those are: the reading note is present, no Block description is under
  120 characters, and none points at a compile step. There's no eval. **The box ends at the decision or on
  4-Dec-2026 (the end of stage B), whichever comes first.** With no decision by 4-Dec, WP7 writes their cases
  against the current backend, which is the conservative default. After a decision, a tool that stays gets its
  case before the cut release, and one that leaves needs nothing.
- This loosens two rules of the 12-Nov standing decision ("a tool without a case is unfinished", "the pending list
  only shrinks"). So it's written in `ARCHITECTURE.md` as a **proposal, not in force until approved**. It isn't
  edited into the standing decision.

## 4 · How it runs

- **Replay in CI, record by hand.** Replay needs only `ANTHROPIC_API_KEY`. Recording forwards GETs only, never
  writes, and never writes a key to disk (unchanged). Its upstream becomes configurable per route family, so
  recordings come from `api.block.dwlf.co.uk` after the re-point.
- The public routes need **no key**. They're a keyless GET to our own public, cached API, so the public half
  doesn't wait on the "read-only test key" tap. The signed-in half (plan views, `/v1/me`) is recorded with a
  `block-staging` key once WP4 issues one. Either way the key never reaches the MCP server or the disk.
- **The gate:** `publish.yml` builds, runs `npm test`, then runs `npm run eval` in replay. It publishes **only if
  every question passes**.
  - On a failure, nothing is published and the transcripts are kept as a workflow artifact.
  - A missing recording fails the gate.
  - A recording older than 30 days is reported, and the release checklist says to re-record before a release
    candidate.
- **Flake policy (unchanged):** a deterministic failure is never retried. A judge-only failure gets one fresh run,
  and both attempts are kept.
- **Models:** Opus 5.5 for the agent and the judge (the env overrides stay). The cost per release is measured on
  the first full run and written here; it isn't guessed now.
- **No escape hatch is designed here.** Gating publish on the eval was decided on 12-Nov. If the Anthropic API is
  down, a release waits. An urgent fix with a known judge flake goes to Andy as a tap to publish by hand, with the
  failing transcript attached.

## 5 · Dependencies

| Needs | From | When |
|---|---|---|
| The envelope on every data route | WP2 (live: verified on `/public/v1/conditions`, 16-Nov) | done |
| The wording port and the pinned list | WP2, dwlf-block-api PR #26 | before check 7 |
| The Block profile re-pointed at the Block API | WP4 (MCP step) | before the post-cut recordings |
| The post-cut tool list | Andy/Jenna (§3) | before check 7 and the cut release |
| A `block-staging` key for the signed-in recordings | WP4 | for the account tool and plan views |
| What an item's `knowableAt` means | WP2 (§7) | before check 4 trusts it as a date |
| `ANTHROPIC_API_KEY` as a dwlf-mcp-server Actions secret | Andy (tap) | before the gate PR merges |

## 6 · Plan: one PR at a time

1. **This PR:** the charter. `lgtm arch`, then stop for Jenna.
2. **Harness:**
   - check 3; check 4 (the per-tool pass-through test, plus the record-time check against the Block API's
     OpenAPI);
   - the judge's date instruction;
   - `wording:sync` with `--check`, and the list re-vendored and pinned;
   - an upstream per route family.
   
   `npm test` only; no model calls in CI.
3. **Cases for the tools that exist in every outcome** (this folds in DWLF-822). They're written now and run against
   today's backend; recordings are made by whoever holds a key.
4. **The gate:** `publish.yml` runs the eval, uploads the transcripts, and blocks publish on a failure (this needs
   the secret tap).
5. **The cut release, with WP4:**
   - recordings from the Block API;
   - check 7 over the decided tool list, with that list's descriptions reworded;
   - `eval/pending.json` re-based to that list.
6. **First full run** on the release candidate. The transcripts are attached to DWLF-804, and the cost is written
   into §4. WP7 is done when that run passes and the gate is live (the design: "the eval runs in CI for the MCP repo
   and gates publish").

## 7 · Findings handed on (not WP7's code)

- **For WP2:** on `/public/v1/conditions`, each item's `knowableAt` (and the "Knowable from …" line in its `why`) is
  the time of the request, not when the fact became knowable. The real time is in `values.sinceKnowableAt`. For
  the realised-price cross that's 2023-01-14, against an item `knowableAt` of 2026-11-16T07:50.
  - SYSTEM.md keeps printed and confirmed times apart.
  - An agent told "knowable from today" can't tell a two-year-old fact from a new one.
  - The eval works around it (§2, check 4), but the field's meaning is WP2's to decide.
- **For WP4:**
  - The Block profile's server instructions name tools that may leave at the cut (`dwlf_get_regime`,
    `dwlf_get_cycle_windows`), and they link the SPT pricing URL. They're rewritten in the cut release, and check 7
    covers them.
  - `docs/HOSTED-MCP.md` still routes the hosted Block endpoint to SPT `/v2`.
  - The re-point changes the charter's Interfaces (the profile → backend line, "one DWLF_API_KEY = one account",
    "Not for: api.dwlf.co.uk/v2 only"). Scheduled-change notes in `ARCHITECTURE.md` mark those lines, so the WP4
    PR delivers a decision instead of contradicting the charter.
