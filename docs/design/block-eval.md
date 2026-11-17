# The Block agent eval: charter and plan (WP7, DWLF-804)

*16-Nov-2026. Design §1.10 and §4 WP7 of the Block 3-layer design (Andy approved 12-Nov 16:25). Docs only: this
file, plus in `ARCHITECTURE.md` an amendment to the eval standing decision (accepted by Andy, tap c-dc40) and a note marking the lines the Block cut touches. No code.*

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
  call. The tool is replayed against a recording, and the rule is **containment, not equality**. The result must
  keep the first upstream page's top-level fields unchanged, and every item of every page it fetched must appear
  whole (deep-equal; extra keys allowed). So invariant 2's additive enrichment (`filtersApplied`, `agentHints`)
  stays legal. Dropping, renaming or rewriting an upstream field is what fails. That needs no copy of the field
  list, so a field the Block API renames doesn't need an edit here.
  - So `dwlf_get_events`' auto-pagination (a standing decision) stays legal too. Open, for WP4 when custom events
    return to Block (scoped auto-pagination is theirs, so it doesn't bite at launch): merged pages sit under page 1's
    envelope, whose `summary` may not describe them all. Hand the agent the `cursor`, or have the Block API serve
    the range?
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
- It uses the Block API's JS port of the list's rules (`bannedWordIn`, dwlf-block-api PR #26, open 16-Nov). That
  port agrees with block-site's `wording.py` on 1,100 texts. It's vendored once #26 merges; there's no third port.
- **Measured today: 25 of the 39 Block descriptions fail it.** Most hits are:
  - the verb "returns" (the list bans "returns" in the sense of investment returns);
  - the buy/sell/signal words inside the "not a signal" note itself.
- The server instructions already pass, because they use the list's own allowed phrases ("never turn them into
  buy, sell or hold recommendations", "nothing here is scored as a predictor"). So the fix is wording, not a softer
  list: the note is rewritten in those phrases, and "returns" becomes "gives".
- **The list governs every Block-visible description.** A dispute is settled by editing the list in block-site
  (its owner), not by an exemption here.
- **Shared wording changes for both profiles where the change is neutral.** "Returns" → "gives" changes nothing
  for `full`, so the shared docstring changes. Only wording that differs in content goes into
  `blockDescriptions.ts`, as it does today.
- A `full`-only release waits on the eval too. Every merge and publish already needs Andy's tap, so
  `eval_override` adds no new approver.
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
  - Block API conformance is a release dependency **for new recordings only**. Existing recordings keep
    replaying. If a recording a new case needs can't be saved because the Block API fails its own schema, that's
    a failure outside this repo, and `eval_override` covers it like a judge flake.
  - **The eval also runs as a PR check on any PR that bumps the version** (a release PR), so a failure is found
    before merge. Master never holds a version bump the gate then refuses. The run in `publish.yml` repeats it.
  - A recording older than 30 days is reported, and the release checklist says to re-record before a release
    candidate.
- **Flake policy (unchanged):** a deterministic failure is never retried. A judge-only failure gets one fresh run,
  and both attempts are kept.
- **Models:** Opus 5.5 for the agent and the judge (the env overrides stay). The cost per release is measured on
  the first full run and written here; it isn't guessed now.
- **The eval runs in its own job.** `publish.yml` gets an `eval` job that holds `ANTHROPIC_API_KEY` and has no
  `id-token` permission. The `publish` job `needs: eval`, and only it can mint the OIDC credential. So model-driven
  test code never runs where an npm publish credential exists.
- **One publish path, no hand publish.** Gating publish on the eval was decided on 12-Nov. If the Anthropic API is
  down, a release waits. For an urgent fix blocked by a known judge flake, or by a failure outside this repo, Andy can tap a `workflow_dispatch` run
  with an `eval_override` reason. That run still goes through the same OIDC job, tags the release and attaches the
  failing transcripts, and the reason and the overridden cases go into the release notes. The next release must
  pass those cases; the same case can't be overridden twice. A version is never published outside
  `publish.yml`, so it always has its provenance, its tag and its transcripts.
- **Accepted:** every release of the package (both profiles) depends on the Anthropic API being up and on the
  Block eval passing. One package means one gate.

## 5 · Dependencies

| Needs | From | When |
|---|---|---|
| The envelope on every data route | WP2 (live: verified on `/public/v1/conditions`, 16-Nov) | done |
| The wording port and the pinned list | WP2, dwlf-block-api PR #26 | before check 7 |
| The Block profile re-pointed at the Block API | WP4 (MCP step) | before the post-cut recordings |
| The post-cut tool list | Andy (DWLF-852, §3) | done 16-Nov |
| A `block-staging` key for the signed-in recordings | WP4 | for the account tool and plan views |
| What an item's `knowableAt` means (DWLF-853) | WP2 (dwlf-block-api #27, live 6d77171) | done 16-Nov; check 4 checks it by value |
| `ANTHROPIC_API_KEY` as a dwlf-mcp-server Actions secret | Andy (tap) | before the gate PR merges |

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
4. **The gate:** `publish.yml` runs the eval, uploads the transcripts, and blocks publish on a failure (this needs
   the secret tap).
5. **The cut release, with WP4:**
   - recordings from the Block API;
   - `eval/pending.json` re-based to that list.
6. **First full run** on the release candidate. The transcripts are attached to DWLF-804, and the cost is written
   into §4. WP7 is done when that run passes and the gate is live (the design: "the eval runs in CI for the MCP repo
   and gates publish").

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
