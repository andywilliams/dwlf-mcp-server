# The Block agent eval: charter and plan (WP7, DWLF-804)

*16-Nov-2026. Design §1.10 and §4 WP7 of the Block 3-layer design (Andy approved 12-Nov 16:25). Docs only: this
file, plus in `ARCHITECTURE.md` an amendment to the eval standing decision (accepted by Andy, tap c-dc40) and a note marking the lines the Block cut touches. No code.*

## 0 · Decision, 18-Nov-2026: releases are gated by standard tests; the agent eval is a doc (B14)

**Andy, 18-Nov:** *"I'm not spending $50 to release an MCP server"* (17:03), then *"it's deterministic and could
be caught with standard testing… we just need a dictionary of banned words/terms"* (17:07, agreed "sounds good").
Relayed by Jenna; in force when the PR adding this merges on his tap.
- **Why:** cost and flakiness.
  - A model-run gate costs about $10–20 a release (up to $50), on every release of both profiles.
  - An LLM grader needs retries and an override path.
  - No Block-profile tool returns model-written text (checked 18-Nov). Every output is data from the API plus
    templated sentences, so standard tests can pin it.
- **Given up:** a release no longer proves that an agent *answers well*. It proves each tool still gives the output
  that was reviewed, with clean wording. Answer quality is re-checked by hand, if ever, with the doc in M.

**The release gate: `npm test`, which `publish.yml` already runs before every publish, plus the same `npm test` as
a PR check. Free, with no secrets and no model calls.**
- **T1 · Output snapshots (contract tests).**
  - For each launch-set tool, a fixed list of calls (`eval/calls/<tool>.json`: arguments, no agent) runs the built
    server against recorded responses in `eval/fixtures/`. Each result must equal its committed snapshot.
  - **A snapshot pins what the MCP adds or chooses, not the upstream data.** It records:
    - every output key or value that isn't in the recording (hints, `filtersApplied`, error text, wrappers);
    - for a tool that selects items (the catalogue tools), the ids it selected, in order.
  - Upstream content is pinned by pass-through instead (check 4: page 1's fields unchanged, every item whole).
    So a routine re-record changes no snapshot unless the MCP's own layer or its selection changed, and the diff a
    reviewer reads is only that.
  - A changed MCP layer fails until the snapshot is regenerated in the same PR. A call with no recording fails.
  - **Coverage rule (replaces run.mjs's runtime check):**
    - every tool in `passthrough.json` `tools` has a calls file with at least one call, and a snapshot;
    - every launch-set data tool is either in `tools` or still in `cutPending`;
    - during the snapshot run, a call that reaches a Block API path from a tool not in `tools` fails.
    So a B4 PR that re-points a tool but leaves it in `cutPending`, or adds no calls file, is red.
  - **Scope:** the Block profile only. Whether the `full` profile's outstanding "add tests" decision reuses this
    runner is not decided here. Its tools are SPT-backed, and their recordings would carry vendor data that the
    T3 rule keeps out of this public repo.
- **T2 · The banned-terms check on sentence text.** The vendored list (check 7) runs over:
  - every tool's description, parameter descriptions and the Block instructions (as today);
  - **every string that contains a space in each tool's actual output**, computed in the test from the recordings.
    That is the whole output, upstream sentences included, not the slimmed snapshot file. A single token is an identifier or an enum value
    (`rsi.midline.bullish`, `direction: "bearish"`) and is skipped, the rule check 7 already applies to enum values.
  - Measured 18-Nov on all three public Block API routes (9,552 strings): every sentence passes, and the only hits
    are identifiers.
  - Upstream sentences are checked as well as the MCP's own (Andy: every tool's output), because an agent reads
    both. **Who unblocks a red upstream sentence:** the recordings only change in a re-record PR or a list-sync PR.
    - A hit there fails *that* PR alone, and it isn't merged until dwlf-block-api fixes the sentence. That repo
      pins the same list, so its own test fails first.
    - The existing recordings keep replaying green, so a `full`-profile hotfix that doesn't re-record or sync is
      never blocked by upstream text.
- **T3 · Recordings.**
  - Recorded from the Block API's **public routes**: keyless, the Free view, data the API already publishes.
    - Checked 18-Nov: every public body is DWLF's own data. Events are all `BTCOC/USD` (DWLF's node), and series
      say "on DWLF's own data". There are no vendor (Twelve Data) values.
    - This repo is public and keeps its history, so a fixture holding vendor-derived or personal values isn't
      committed. Two guards:
      - a **fixture lint in `npm test`**: every item with a `symbol` is `BTCOC/USD`, and no item carries a price
        field (`price`, `close`, `level`, `value`) under any other symbol or with `priceWithheld: false`;
      - a person reads the fixture diff. The conditions price ladder and the on-chain price crosses are checked
        by hand at the first recording, since a sentence could quote a vendor close: the lint can't read prose.
    - Publishing DWLF's own Free-view data in an MIT repo is Andy's call, made by tapping the PR that adds it.
  - Recorded once by hand (GETs only, the key never written), then replayed in CI with no credential.
  - Signed-in views (`/v1/*`, the account tool) are recorded when keys exist, with a Block **test** account's
    `dwlfk_` key. That fixture diff is read for anything personal before it's committed.
  - The SPT-backed versions are never recorded: B4 replaces them.
- *Accepted debt: before the cut.*
  - Until B4 re-points a tool, its output has no snapshot. Block releases are then gated by T2 on descriptions and
    the existing tests, as on 17-Nov.
  - The 35 tools that leave at the cut never get snapshots.
  - The re-point PR for each tool lands with its recording and snapshot, so the first snapshot pins the new
    backend's output, reviewed in that PR.

**M · The agent eval, kept as a document.** `eval/cases/` (the 15 questions, 3 per tool, one a trap),
`eval/grade.mjs` (what an answer must do) and the judge's rubric stay in the repo as a **frozen reference**.
- `eval/MANUAL.md` says how to run them by hand in a fresh Claude Code session with only this server connected.
- It isn't a gate, has no schedule and needs no API key.
- The model-calling runner (`eval/run.mjs`) and the `@anthropic-ai/sdk` dev dependency are removed.
- **The case-file requirement goes too** (`eval/pending.json`, the coverage test and the per-family test). With
  nothing running the cases, a stale case would fail nothing, so the requirement would be on paper only. A new tool
  may add questions; nothing forces it to.

**Plan, one PR each, `npm test` only, no version bump:**
- **4a.** This decision (docs only).
- **4b.** M: remove `run.mjs`, the SDK, `pending.json` and its coverage tests; add `MANUAL.md` with the rubric;
  keep the cases and the grader.
- **4c.** T1/T2 machinery (calls file, snapshot runner, `--update`, the sentence-text wording check), proved on a
  synthetic fixture, plus `.github/workflows/test.yml` (pull requests: build and `npm test`).
- **Then, inside B4:** each re-pointed tool lands with its recording, calls and snapshot (T3).

## 1 · What the eval is for

Block sells to agents as much as to people. An agent with **only this MCP server** must give an answer that is
**correct, sourced, dated and not advisory**. Design §1.10 says "acceptance is an eval, not a review". The eval
was to gate the Block profile. **Since 18-Nov (§0) it is a document for a manual check:** releases are gated by
standard tests (output snapshots and the banned-terms check), and a tool still arrives with its case file.

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
| 7 | Every Block tool **description and parameter description**, and the profile's server instructions, pass the shared wording list (enum values are the engine's identifiers, not text) | deterministic, `npm test` | DWLF's own copy |

**Check 4: who owns what.**
- **The Block API owns its envelope.** Its contract test (the OpenAPI schema and its route tests) is where a dropped
  field goes red first.
- **This repo owns the pass-through** (invariant 2): no tool strips, reshapes or unwraps the envelope on its way to
  the agent. It's checked in `npm test`, for every Block data tool rather than only the ones an agent happens to
  call. The tool is replayed against a recording, and the rule is **containment, not equality**. The result must
  keep the first upstream page's top-level fields unchanged, and every item of every page it fetched must appear
  whole (deep-equal; extra keys allowed). So invariant 2's additive enrichment (`filtersApplied`, `agentHints`)
  stays legal. Dropping, renaming or rewriting an upstream field is what fails. That needs no copy of the field
  list, so a field the Block API renames doesn't need an edit here.
  - `dwlf_get_events`' scoped auto-pagination (a standing decision, for SPT shapes) does **not** pass it: it rewrites
    page 1's `cursor` and slices items to `limit`, and merged pages would sit under page 1's `summary`. It doesn't
    bite at launch (it's custom events', which leave the Block profile at the cut). Open for WP4 when they return:
    hand the agent the `cursor`, or have the Block API serve the range.
  - **Which tools:** `eval/passthrough.json`. `cutPending` lists the launch-set data tools not yet re-pointed and only
    shrinks; a tool leaves it with its recording. During the eval, a call that reaches a Block API path from a tool
    not in the registry fails its question, so a re-pointed tool left off the file can't pass unchecked.
  - Today `dwlf_describe_onchain_events` and `dwlf_explain_event` *reshape* SPT's answer (scoped exceptions to
    invariant 2: a JOIN, a pack and search view). After the cut the catalogue is one Block API read, and those
    exceptions end for the `block` profile. WP4's re-point PR records that.
  - Until the cut, the check runs only for tools whose upstream is the Block API, so there are none before WP4
    and no tool fails it on day one.
  - **WP7's requirement: a Block response is never unwrapped before the agent sees it.** Unwrapping to `items`
    would drop `summary` and `definitions`. "Unwrap once" then applies to SPT's shapes only. WP4 still decides
    whether SPT standardises on Block's shape.
- **Live drift is caught when recording.** The fixture server checks each live data-route body against the
  `required` lists in the Block API's own `/public/v1/openapi.json`, fetched at record time. A body that fails is
  reported as a Block API defect and isn't saved. Each recording stores the OpenAPI `info.version` and the
  schema's sha256 it was checked against. `summary.json` lists recordings checked against an older schema than the
  newest in the set, so a tightened `required` list shows up even while replay stays green. So a Block API regression shows up the next time anyone records,
  and this repo never decides what the envelope contains.
- "Every response" means the data routes (catalogue, conditions, events, series). `/v1/me`, pricing and terms
  aren't envelopes, and they're exempt by name. A locked item still needs `summary`, `why` and `chartUrl`; its
  values are absent by design.
- **`knowableAt` is checked by value** (DWLF-853, live 16-Nov: an item's `knowableAt` is when the reading it rests
  on became knowable). On every data-route response:
  - an item's `knowableAt` is never later than the envelope's `knowableAt`, and on conditions it is never the
    response's `asOf` (the OpenAPI promises that for conditions only: the catalogue's definitions are knowable when
    asked, and live catalogue items carry `asOf`, 17-Nov);
  - the envelope's `knowableAt` is the latest item's and no later than `asOf`;
  - where an item carries `values.sinceKnowableAt`, it equals the item's `knowableAt`;
  - an event's `knowableAt` is no earlier than its `date`.
  
  Dates in answers are still graded by check 2 (each case names the fact's own date, e.g. 2023-01-13 for the
  realised-price cross) and by the judge, who is told that an answer dating a fact to the day of the request is
  wrong when the tool result shows an earlier `knowableAt`, `date` or `since`.

**Check 7: the wording gate.**
- It's a hard gate because it's DWLF's own wording, and no context excuses a word there. The standing decision
  already applies the same rule to the Block API's templates.
- It uses the Block API's JS port of the list's rules (`bannedWordIn`, dwlf-block-api #26, merged). That port
  agrees with block-site's `wording.py` on its parity corpus. It's vendored in `eval/wording/` as plain ESM (types
  stripped by `wording:sync`, nothing else); there's no third port.
- **Measured 16-Nov: 25 of the 39 Block descriptions fail it** (and 23 parameter descriptions, 17-Nov). PR 2 rewords all of them. Most hits were:
  - the verb "returns" (the list bans "returns" in the sense of investment returns);
  - the buy/sell/signal words inside the "not a signal" note itself.
- The server instructions already pass, because they use the list's own allowed phrases ("never turn them into
  buy, sell or hold recommendations", "nothing here is scored as a predictor"). So the fix is wording, not a softer
  list: the note is rewritten in those phrases, and "returns" becomes "gives".
- **The list governs every Block-visible description.** A dispute is settled by editing the list in block-site
  (its owner), not by an exemption here. Enum values aren't descriptions: they are the engine's identifiers, which
  Block keeps as ids (dwlf-block-api's standing decision, 15-Nov: "`smc.bos.bullish` stays an id").
- *Accepted debt:* the never-advice lines quote the list's `allowPhrases` word for word, in shared text. If block-site
  rewords one, the next sync turns check 7 red on those descriptions, and that sync PR rewords them for both
  profiles. The failure is loud and names each text.
- **Shared wording changes for both profiles where the change is neutral.** "Returns" → "gives" changes nothing
  for `full`, so the shared docstring changes. Only wording that differs in content goes into
  `blockDescriptions.ts`, as it does today.
- The wording check is in `npm test`, so a `full`-only release waits on it too (18-Nov: no other release gate).
- **One list:** block-site's `ops/wording-banned.json` (Jenna's decision, 15-Nov), vendored byte for byte with its
  sha256 pinned in `eval/wording/SOURCES.json`, the same pin dwlf-block-api keeps (`872dbce1…` at PR 2).
- **One command shows drift:** `npm run wording:sync` copies the list and the port from one named block-site commit
  and one named dwlf-block-api commit, in one commit here. `npm run wording:sync -- --check` fails if either source
  has moved on. The pinned sha alone only proves the local copy wasn't edited.
- `--check` runs by hand in the release checklist (the person recording already has `gh`). `publish.yml` gets no
  cross-repo credential and stays OIDC-only. *Accepted debt:* the list can drift between syncs.
- A list change enters only through a sync commit, so it can't block a release (a `full`-profile hotfix, say)
  that didn't pull it. A sync that tightens the list can hold up the next release on any Block description. That
  is intended: the descriptions must pass the current list.
- The older export once vendored in `eval/` (`9990fca5…`) had drifted, which is why `--check` exists. PR 2 replaced it.

**Transcripts** of a manual run (§0 M) go on the release's ticket. They're not in the repo or the npm package.

## 3 · Which tools it covers

The Block profile is re-pointed from SPT's `/v2` to the Block API (`api.block.dwlf.co.uk`) in one release at the
cut (design §2 step 4; WP4 owns the re-point). After that, **the Block profile can only offer what the Block API
serves.** The Block API's live OpenAPI (1.0.0-draft, 16-Nov) has four data routes, plus account, terms, pricing and
billing.

**Tools that exist in every outcome, with cases now:**

| Tool | Block API route after the cut | Cases |
|---|---|---|
| `dwlf_get_conditions` | `/v1/conditions` (`/public/v1/conditions` with no key) | exists; re-recorded at the cut |
| `dwlf_get_events` | `/v1/events` | `eval/cases/events-<family>.json`, one per family (today `events-onchain.json`, DWLF-822) |
| `dwlf_describe_onchain_events`, `dwlf_explain_event` | `/v1/catalogue` | `describe-onchain-events.json`, `explain-event.json` (DWLF-822) |
| `dwlf_get_series` (new) | `/v1/series/{id}` | arrives with the tool |
| an account tool (plan, usage, terms status) | `/v1/me`, `/v1/terms/status` | arrives with the tool; no trap (no market data) |

For these tools, the questions are written once. Only the fixtures change at the cut, so cases are written now
against today's backend and re-recorded then. (One exception: `dwlf_get_events`' on-chain paragraph describes SPT's
row, so WP4 rewrites it at the re-point; §7.)

**`dwlf_get_events` is covered per family.** It reads several event families, so its case files each name one
(`"family"`; today only `onchain`, `eval/cases/events-onchain.json`). The tool-level coverage test can't see a
family, so the rule is held here and by `test/evalGrade.test.mjs` (each such case names a distinct family): each
family the Block API's `/v1/events` serves at the cut, and each family that comes back later (custom events),
arrives with its own case file. The cut PR lists `/v1/events`' families and adds any case missing.

**The other 35 tools leave the Block profile at the cut** (DWLF-852, decided by Andy 16-Nov). These are:
- regime, stage, cycle windows, quote, price picture, market data, support/resistance, cycle setups, divergences,
  trendlines, indicators and ranges (regime, stage and windows are already sections of conditions);
- the 14 custom-event tools (with `dwlf_describe_strategy_nodes`) and the 4 subscription tools;
- the 3 Academy tools, quotas and register.

None of them has a Block API route, so **the launch set is the table above** and WP7 writes cases only for it.
- **Alerts and custom events/building come back** once the Block API serves them (WP2 routes first). Then one WP7 PR
  per family: its cases, its wording, its recordings. The plan grows by those PRs and nothing else changes.
- **Until the cut,** the 35 stay in today's Block profile with today's `npm test` guards plus check 7 (their
  descriptions are what Block agents read until then). They get no eval cases; `eval/pending.json` is re-based to
  the launch set at the cut.
- **The tool list is shown, not hidden.** Removing tools from the profile changes what agents set up through
  `docs/BLOCK.md` can call. The cut release says so in its notes and in `docs/BLOCK.md`'s tool list. The profile
  *name* stays, as the charter requires.

## 4 · How it runs

**Rewritten 18-Nov by §0** (the 16-Nov model-run gate, its secret, its PR check and `eval_override` are withdrawn;
git history keeps the text). What still holds:
- Recording forwards GETs only, never writes, and never writes a key to disk. Its upstream is chosen per route
  family (`/v1`, `/public/v1` → the Block API), and each Block body is checked against the Block API's own OpenAPI
  when recorded (check 4).
- Replay needs no credential, and under replay no other host is reachable (`replayEnv`).
- A recording older than 30 days is reported (`staleFixtures`). Re-record before a release candidate.

## 5 · Dependencies

| Needs | From | When |
|---|---|---|
| The envelope on every data route | WP2 (live: verified on `/public/v1/conditions`, 16-Nov) | done |
| The wording port and the pinned list | WP2, dwlf-block-api #26 | done; vendored in PR 2 |
| The Block profile re-pointed at the Block API | WP4 (MCP step) | before the post-cut recordings |
| The post-cut tool list | Andy (DWLF-852, §3) | done 16-Nov |
| A `block-staging` key for the signed-in recordings | WP4 | for the account tool and plan views |
| What an item's `knowableAt` means (DWLF-853) | WP2 (dwlf-block-api #27, live 6d77171) | done 16-Nov; check 4 checks it by value |

## 6 · Plan: one PR at a time

1. **This PR:** the charter. `lgtm arch`, then stop for Jenna.
2. **Harness:**
   - check 3; check 4 (the per-tool pass-through test, plus the record-time check against the Block API's
     OpenAPI);
   - the judge's date instruction;
   - `wording:sync` with `--check`, and the list re-vendored and pinned;
   - an upstream per route family;
   - check 4's `knowableAt` value rules (checked against all four live routes, 17-Nov);
   - check 7 on, over all 39 Block descriptions, with the failing ones reworded neutrally.
   
   `npm test` only; no model calls in CI.
3. **Cases for the launch set** (§3; this folds in DWLF-822). They're written now and run against
   today's backend; recordings are made by whoever holds a key.
   - Three case files (on-chain events, the catalogue, explain), each with three questions, one a trap. Questions
     use fixed dates, so the window doesn't drift day to day. That doesn't make requests repeat: the fixture key is
     every query parameter, and the agent picks `limit`, `type` and the window form fresh each run, so a choice the
     recording didn't see misses (a deterministic failure). The first full run (step 6) measures how often; if it's
     material the fix is in the harness (what the key ignores, or recording the misses in a reviewed run), not in
     questions that name parameters.
   - `dwlf_get_events` now tells an agent where on-chain rows are (BTCOC/USD, daily, one exact type id) and that
     `onchain.confirmedAt` is when a row became knowable (DWLF-822's description fixes; the catalogue and explain
     tools already said both).
   - No recordings: §0 T3 (recorded from the Block API in B4, never from SPT).
4. **Replaced 18-Nov by §0** (4a–4c: standard tests and the banned-terms check; the eval a document).
5. **The cut release, with WP4:**
   - recordings from the Block API;
   - `eval/pending.json` re-based to that list.
6. **WP7 is done** when 4a–4c are merged and every launch-set tool has its snapshot (after B4). The 16-Nov "first
   full run" and its cost are dropped with the model gate (§0).

## 7 · Findings handed on (not WP7's code)

- **For WP2 (DWLF-853, fixed and live 16-Nov, dwlf-block-api #27):** on `/public/v1/conditions`, each item's `knowableAt` (and the "Knowable from …" line in its `why`) was
  the time of the request, not when the fact became knowable. The real time is in `values.sinceKnowableAt`. For
  the realised-price cross that's 2023-01-14, against an item `knowableAt` of 2026-11-16T07:50.
  - SYSTEM.md keeps printed and confirmed times apart.
  - An agent told "knowable from today" can't tell a two-year-old fact from a new one.
  - WP2 settled the meaning; check 4 now checks it by value.
- **For WP2 (the knowableAt rules, 17-Nov):** the Block API states its `knowableAt` rules as prose in its OpenAPI
  descriptions, and its route tests don't assert them as a contract. So the eval's `eval/envelope.mjs` is a copy,
  and a recording it refuses may be a Block regression or a stale copy (the two are reported apart). Ask: assert
  the rules in dwlf-block-api's own contract tests (or publish them machine-readably). A change of meaning lands
  there first, and the recording PR here edits `envelope.mjs` with it.
- **For WP4:**
  - The Block profile's server instructions name tools that may leave at the cut (`dwlf_get_regime`,
    `dwlf_get_cycle_windows`), and they link the SPT pricing URL. They're rewritten in the cut release, and check 7
    covers them.
  - `docs/HOSTED-MCP.md` still routes the hosted Block endpoint to SPT `/v2`.
  - `dwlf_get_events`' on-chain paragraph (DWLF-822, `src/tools/market-data.ts`) describes SPT's row: `symbol:
    "BTCOC"`, `timeframe: "1d"`, and `onchain.confirmedAt` as the knowable time. If `/v1/events` items differ (the
    Block envelope's per-item `knowableAt`, another asset name), the re-point rewrites it in the Block wording
    (`blockDescriptions.ts`), and the events-onchain questions stay as they are.
  - The families `/v1/events` serves, so each has a `dwlf_get_events` case before the cut release (§3).
  - The questions the re-point has to answer are listed in `ARCHITECTURE.md` (*Handed to other packages*):
    the charter lines it rewrites; tool names when the response contract differs; the install migration and
    `server.json`; how "unwrap once" treats the Block envelope; and the key's env var and client. They're WP4's,
    decided through its own `lgtm arch`, not here.
  - What the harness assumes today, for WP4 to keep or change in the re-point PR: one fixture origin for both
    upstreams, split by path (`/v1/…`, `/public/v1/…` = Block); a signed-in Block path sent `Bearer`; and the
    server under test pointed at the fixtures by `DWLF_API_URL` only, with a dummy `DWLF_API_KEY`. Every other host is
    unreachable under replay (`replayEnv`: a closed proxy, with only the fixture origin exempt), so a Block client
    reading its own base-URL variable fails the eval loudly until `replayEnv` sets it. If the client picks public
    routes by having no key, the eval must not set the dummy key for it.
