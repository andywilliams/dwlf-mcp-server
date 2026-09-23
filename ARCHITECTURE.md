---
title: dwlf-mcp-server — architecture charter
system: ../dwlf-system/SYSTEM.md
---

# dwlf-mcp-server — architecture charter

> **NORMATIVE.** Inferred 2026-08-13, then corrected with Andy the same day — all nine open questions closed.
>
> **Claims are graded and the grades carry different authority.** *(verified …)* / *(Andy, …)* are normative. *(inferred from: …)* is rebuttable — contradicting evidence may mean the charter is stale. *(from: …)* is sourced outside this repo and weakest. Counts marked *(verified)* are **snapshots, not ceilings**.

## Purpose & scope boundary

This repo is the **MCP adapter for the DWLF platform**: it exposes DWLF's v2 REST surface to
MCP-speaking AI agents as ~100 `dwlf_*` tools plus one `dwlf://symbols` resource, and ships as the
public npm package `@dwlf/mcp-server` that agent clients run locally over stdio *(inferred from:
`package.json` name/`bin`; `src/index.ts` `new McpServer({name:'dwlf'})` + `StdioServerTransport`;
100 `server.tool(...)` registrations across `src/tools/*.ts`; `src/resources/symbols.ts`)*. It is a
**thin translation layer**: validate/normalise arguments with zod, call `DWLFClient`, return the
backend's JSON *(inferred from: runtime deps are only `@modelcontextprotocol/sdk`, `axios`, `zod`;
tool bodies are `client.get/post/... ` + `JSON.stringify(data)`)*. Its real product surface is the
**tool docstrings** — the prerequisites, footguns and workflow ordering an agent cannot infer from a
schema *(inferred from: multi-paragraph ⚠️ descriptions in `src/tools/evaluations.ts:14,49`,
`src/tools/market-data.ts:156-169`)*.

**Not for:**
- **Market/trading computation** — indicator math, event detection, cycle FSMs, strategy evaluation.
  Those live in `dwlf-indicators` and `dwlf-scheduled-jobs` *(inferred from: no indicator/compute
  dependency in `package.json`; no numeric analysis anywhere in `src/`)*.
- **New platform capability.** A tool may only surface something `api.dwlf.co.uk/v2` already does;
  capability is added in `serverless-portfolio-tracker` first *(inferred from: SYSTEM.md "API-first —
  no privileged client"; every tool is an HTTP call through `src/client.ts`)*.
- **Auth, account or key management.** One `DWLF_API_KEY` = one account for the process lifetime;
  no key storage, no account switching, no multi-tenancy *(inferred from: `src/client.ts` reads
  `process.env.DWLF_API_KEY` once in the constructor and sets a fixed `Authorization: ApiKey` header;
  a single `DWLFClient` is constructed at module load in `src/index.ts`)*.
- **Charting/rendering and any UI** — `dwlf-charting` / `portfolio-frontend` *(inferred from: no
  render deps; README points integrators at `@dwlf/charting` instead)*.
- **Hosting a remote/multi-user MCP endpoint** — stdio only today, and **this boundary has a stated expiry condition rather than being permanent**: see the stdio standing decision, which names the trigger (a third-party agent onboarding without Andy). ⇒ Treat this *Not-for* as *not yet*, not *never* *(inferred from: `src/index.ts`
  uses `StdioServerTransport`; no HTTP server code)*.

## Interfaces & dependencies

**Exposes**
- **npm package `@dwlf/mcp-server`** (public, MIT), bin `dwlf-mcp-server`, `engines.node >= 18`,
  consumed by MCP clients (Claude Desktop, Cursor, VS Code, Claude Code) via `npx -y @dwlf/mcp-server`
  *(inferred from: `package.json` `bin`/`publishConfig.access: public`; README client-config snippets)*.
- **~100 `dwlf_*` tools** grouped in 22 modules under `src/tools/` (market-data, ranges, cycle-setups, cycle-windows, indicators,
  signals, watchlist, symbol-tags, strategies, backtests, portfolio, trades, custom-events,
  evaluations, annotations, trade-plans, symbol-activations, ai-summary, academy, semantic, account,
  subscriptions), each wired in `src/index.ts` via a `register*Tools(server, client)` call
  *(inferred from: `src/index.ts` imports + phase comments; `server.tool(` counts per file)*.
- **One MCP resource** `dwlf://symbols` → `GET /market-data/symbols` *(inferred from:
  `src/resources/symbols.ts`)*.
- **A static catalog of visual-strategy node semantics** surfaced by `dwlf_describe_strategy_nodes`
  *(inferred from: `src/data/strategyNodeMetadata.ts`, added by PR #40)*.

**Depends on**
- **`serverless-portfolio-tracker` v2 REST API** — `https://api.dwlf.co.uk/v2` (override:
  `DWLF_API_URL`), contract = HTTP + `Authorization: ApiKey <DWLF_API_KEY>`, response shapes consumed
  as-is *(inferred from: `src/client.ts` `baseURL`/headers, 30 s timeout)*.
- **Academy CDN** — `https://academy.dwlf.co.uk/live`, unauthenticated, `manifest.json` shape owned by
  `dwlf-academy-content`; the only place that bypasses `DWLFClient` (direct `axios`, 15-min manifest
  cache) *(inferred from: `src/tools/academy.ts` `ACADEMY_BASE`, `MANIFEST_TTL_MS`;
  `registerAcademyTools(server)` takes no client)*.
- **`dwlf-scheduled-jobs`' `visualStrategyExecutor`** — *by hand-copied documentation, not by code*:
  `strategyNodeMetadata.ts` names it as "source of truth for the runtime behaviour" and must be
  re-synced when the executor changes *(inferred from: file header comment; doc-drift PRs #43, #44,
  #47, #48, #50)*.
- **npm + GitHub Actions OIDC** for release *(inferred from: `.github/workflows/publish.yml`)*.

**DECIDED 2026-08-13 (Andy): the Academy CDN IS a contract**, not opportunistic reuse. The academy exists to teach a fresh agent what DWLF is and how to use it — "we just want to teach agents that come to DWLF fresh what DWLF is all about" — so it is a first-class dependency, not opportunistic reuse. `dwlf-academy-content` owns the schema *(Andy, 2026-08-13 — a statement of intent about another repo; **not verified in that repo**, which has not been chartered)*.
⚠️ **Recorded pushback, accepted by Andy: it does not yet LOOK like a contract.** A hardcoded URL fetched with bare `axios`, no auth, no shared retry and an inline 404 check means that if `academy.dwlf.co.uk/live` moved or changed shape, this repo would break at runtime with nothing declaring the relationship. ⇒ **Calling it a contract is the decision; making the code express one is outstanding work** — a named schema owner and a versioned or discoverable manifest, so a consumer can tell that content changed.

## Invariants

A reviewer should be able to test a diff against each of these:

1. **Every user-supplied symbol passes through `normalizeSymbol()` before it reaches the API.** A new
   tool taking a symbol without calling it is a bug *(inferred from: 54 `normalizeSymbol` call sites
   across `src/`; `src/client.ts` docstring)*.
2. **Responses are passed through, not re-enveloped.** Tools return `JSON.stringify(<backend data>)`;
   enrichment is *additive* alongside the backend shape (`agentHints`, `filtersApplied`), never a
   replacement wrapper *(inferred from: ~100 `JSON.stringify` returns in `src/tools/*`;
   `market-data.ts:318-333` `filtersApplied`, `:573` `agentHints`)*.
   ⚠️ **This invariant is scheduled to change.** Once the backend envelopes are standardised (see *Outstanding decisions*), `DWLFClient` should unwrap **once** and tools stop handling the variance individually. ⇒ **A diff that centralises unwrapping is delivering that decision, not violating this invariant.** Until then pass-through remains correct, because a partial normalisation is worse than none.
3. **All authenticated HTTP goes through `DWLFClient`.** No tool constructs its own axios instance or
   URL against `api.dwlf.co.uk` *(verified 2026-08-13 for the auth half only: `src/client.ts:77` is
   the sole `Authorization` assignment in `src/`. The "no tool builds its own URL" half is
   **not** mechanically verified — it is the rule this invariant asks a reviewer to apply.)*
   ⚠️ **"`academy.ts` is the only tool importing axios" would be wrong** — `src/tools/backtests.ts`
   imports it too, but **only for `axios.isAxiosError()` when narrowing a 409**, never to make a
   request *(verified 2026-08-13)*. ⇒ **Importing axios is not the test; making a request is.** A
   review that greps for the import will get a false positive here, and a check that greps for
   `axios.get`/`axios.post` outside `client.ts` will not.
   ⚠️ **The Academy CDN is a SECOND outbound path this invariant does not cover — so it needs its own check.** The reviewable check for it: *does this diff add an unauthenticated outbound call, and if so is the host `academy.dwlf.co.uk` and the failure handled locally?* Any third outbound host is a change to this repo's dependency surface and belongs in *Interfaces*, not in a tool file.
   ⚠️ **It is not an "exception" to the authenticated-HTTP rule.** The rule governs *authenticated* traffic; `academy.ts` makes *unauthenticated* calls to a public CDN, so it is out of scope rather than exempt. Stated explicitly because "the sole exception is…" invites a reader to believe one rule covers all outbound HTTP here. **It does not: two paths exist, and only one is governed.**
4. **A tool handler never throws through the transport** — it catches and returns
   `{ content: [...], isError: true }` with a human-readable message *(inferred from: ~100
   `isError: true` sites, one per tool)*.
5. **The docstring is the contract.** A change to a tool's behaviour, default, or backend semantics
   must change its `description` in the same diff *(inferred from: PR #62 "auto-paginate … + document
   the footgun", #50 "doc-drift audit", #39 "echo filtersApplied so the 7-day default is visible")*.
6. **A new tool file is not shipped until it is registered in `src/index.ts`** — registration is the
   only wiring point *(inferred from: `src/index.ts` explicit `register*Tools` list)*.
7. **Every PR that must ship bumps `version` in `package.json`.** CI publishes only when the version
   is absent from npm and otherwise silently skips *(inferred from: `publish.yml` "Check if version is
   already published" step gating both publish and tag; PR titles carrying explicit versions, e.g.
   #65 "→ 0.38.0", #64 "bump to 0.37.0")*.
8. **No credential is *read from* the repo.** The key comes from `DWLF_API_KEY` in the environment
   only; publishing uses OIDC rather than a stored `NPM_TOKEN` *(inferred from: `src/client.ts`;
   `publish.yml` `id-token: write` and its "No NODE_AUTH_TOKEN" comment)*.
   ✅ **A hole here was found and CLOSED in this PR** *(2026-08-13)*: the rules were `.env`,
   `.env.local` and `.env.*.local` — **not** `.env*` — so `.env.production`, `.env.staging` or any
   `.env.<name>` without a `.local` suffix was **not ignored**, and `git add -A` would have committed
   it to a **public** repo. Now `.env*` with `!.env.example` *(verified: `git check-ignore -v
   .env.production` matches)*. ⇒ Fixed rather than filed, against this session's document-don't-fix
   rule, because **documenting a credential-exposure hole while leaving it open is worse than not
   finding it** when the fix is one character class.
   ⚠️ **Deliberately NOT phrased as "no credentials in the repo"** — that is a stronger claim than the
   evidence supports, and this repo commits 3,950 `node_modules` files nobody has scanned. The
   reviewable check is *does this diff read a secret from a file rather than the environment?*, which
   is verifiable; "nothing secret is anywhere in 24 MB of history" is not.

## Standing decisions

- **2026-01-30 — stdio transport, one `McpServer` and one `DWLFClient` built at module load; one API key, one account, per process. Confirmed 2026-08-13 as the CURRENT posture, with a named expiry condition** *(Andy, 2026-08-13, accepting the recommendation)*.
  **Why it is right today:** two users, no multi-tenancy to build, no hosting to run, and the API key is simply an env var.
  🛑 **The trigger that ends it, stated so it is not rediscovered as a surprise: the moment a third-party agent should onboard without Andy in the loop, stdio is the blocker.** It sits in direct tension with this platform's agent-first onboarding goal (see SPT's charter): an agent can only reach the frictionless registration endpoint *after* installing a binary, setting an env var and editing a local MCP config — friction that no amount of smooth registration removes, because it happens first.
  ⇒ A hosted/remote MCP surface is what would make "arrive fresh and just use it" literally true, at the cost of transport, multi-tenant auth and hosting. **Not now; but when that trigger fires, this is a known decision being revisited, not a new question.**
- **2026-05-07 — symbol normalisation uses a narrow `KNOWN_PAIRED` allow-list, stocks pass through
  unchanged** — because the previous `KNOWN_STOCKS` allow-list appended `-USD` to any unrecognised
  ticker and the API rejected them (PAAS, DRD, HMY, NEM, SPY); the paired list is "much narrower and
  stable — far less maintenance burden than tracking every stock symbol" *(inferred from:
  `src/client.ts` docstring; PR #16)*.
- **2026-05-20 — publish via npm Trusted Publishing (OIDC), no long-lived `NPM_TOKEN`** — because the
  trusted-publisher config on npmjs.com authorises this repo+workflow with a short-lived
  GitHub-issued token instead of a stored secret *(inferred from: `publish.yml` permissions comment;
  PR #32)*.
- ~~**2026-05-27 — ship a hand-maintained catalog of executor node semantics rather than deriving it**~~
  🛑 **SUPERSEDED 2026-08-13 (Andy): the catalog becomes API-served — see *Outstanding decisions*.**
  The original reasoning still stands and is worth keeping, because it says what the replacement must
  preserve: "an agent (or a user) can ask 'what does this SL node actually do at runtime?' without
  having to read engine code"; it was "INTENTIONALLY informational" and updated when the executor
  changed *(inferred from: `src/data/strategyNodeMetadata.ts` header; PR #40)*.
  ⇒ **What failed was not the idea but the mechanism**: "updated when the executor changes" is a
  promise no code enforces, and five doc-drift PRs are the receipts.
- **2026-05-27 → 2026-06 — heavy endpoints default to the light view** (`dwlf_get_backtest_results`
  `summary=true`, `dwlf_list_backtests` summary, daily briefing compact/overview) — because the full
  payload is "~1-3 MB" of per-symbol equity curves that "torches context budget when an agent only
  wanted 'did Sharpe go up?'" *(inferred from: `src/tools/backtests.ts:61-64,86`; PRs #51, #49, #60)*.
- **2026-06-16 — a single axios response interceptor rewrites `error.message` to
  `HTTP <status> — <backend detail>`** — because every request goes through `this.http`, so enriching
  once makes **all** tools report the real reason (e.g. a 400's "skipNote exceeds max length")
  instead of an opaque status code the agent has to guess at *(inferred from: `src/client.ts`
  interceptor comment; PR #61)*.
- **2026-07 — `dwlf_get_events` auto-follows the cursor for scoped custom-event queries (cap 40 pages)
  and echoes `filtersApplied`** — because the backend's `limit` counts rows *scanned* then
  post-filters, so page 1 holds only a fraction of the matches, and the silent 7-day default hides
  older history *(inferred from: `src/tools/market-data.ts:252-333`; PRs #62, #39)*.
- **2026-07-15 — CI pins `npm@11.5.1` exactly** — because trusted publishing needs npm ≥ 11.5.1 while
  npm@12 dropped Node 20, so `@latest` broke with `EBADENGINE` *(inferred from: `publish.yml` step
  comment; PR #64)*.

## Accepted debt

*(Entries here are **tolerated**, not endorsed: reviews should stop *raising* them, and none blocks a
diff. **Decided-but-unbuilt work belongs under *Outstanding decisions* below, not here** — a charter
that files pending work as "accepted" quietly licenses it forever, which is the opposite of what a
decision means. Where an entry names its own fix, that fix is available to anyone passing through;
"accepted" means nobody is obliged to do it, not that doing it would be unwelcome.)*

- **`node_modules/` is committed** — 3,950 tracked files, present since the first commit `eeb388e`,
  despite `.gitignore` listing `node_modules/` *(inferred from: `git ls-tree -r HEAD | grep
  '^node_modules/'` = 3950)*.
  🛑 **The cause is that `.gitignore` never untracks anything** *(verified 2026-08-13: `node_modules/` is line 2 of `.gitignore`, and 3,950 files remain tracked)*. The rule was added *after* the files were committed, so git faithfully keeps versioning all of them while appearing to ignore them — `.git` is **24 MB**, in a **public** repo. `dist/` is the same trap, smaller: 60 tracked files, also gitignored, and **was out of sync with `src/` when checked** (15 modified `dist/` files in the working tree on 2026-08-13) — a working-tree observation, not a durable property: the point is that nothing keeps them in sync, not that they are drifted right now.
  ⇒ Consumers are unaffected — `files: ["dist","README.md","LICENSE"]` governs the tarball — so this is hygiene, not a shipping defect. `git rm -r --cached` is the fix for both. ⚠️ **Say so when you do it**: the `bin` entry points at `./dist/index.js`, so anyone running from a clone rather than the published package needs a build afterwards, and "it broke when you deleted dist" is the predictable complaint.
- **Version drift in metadata:** `src/index.ts` advertises `version: '0.3.0'` while the package is at
  `0.41.0`, and README says "45+ tools" where the actual count is ~100 *(inferred from: `src/index.ts`
  vs `package.json`; `server.tool(` count)*.
- **Manual, one-bump-per-PR versioning** with no semantic-release; a missed bump merges but never
  ships *(inferred from: `publish.yml` skip-if-published; PR #46 "bump to 0.29.1 to publish annotation
  tool fix (#45)")*.

## Outstanding decisions — decided 2026-08-13, not yet built

*(These are NOT accepted debt. Each is a decision Andy has taken; reviews may raise them as
work-in-progress, and a diff that moves toward them is conformant.)*

- **Backend envelope variance — TO BE STANDARDISED UPSTREAM** *(decided 2026-08-13)*. Until it is, this repo inherits the variance (`data` / `results` / bare objects) rather than papering over it locally *(inferred from: pass-through pattern in
  `src/tools/*`)*. *(from: the handbook's response-wrapping audit reports 87% of **SPT's own endpoints**
  already using `data` — a figure about the producing repo, not about this one's tool returns, and
  sourced outside this repo so it is the weakest grade here.)*
  ⚠️ **`manifest` is deliberately excluded from that list**: it is the *Academy CDN's* shape, not the
  DWLF API's, and the two outbound paths must not be conflated. ⇒ **Standardising SPT's envelopes will
  not touch the academy manifest** — that shape is `dwlf-academy-content`'s to own, and folding it into
  this decision would silently widen the work to a repo that has not agreed to it.
  🛑 **DECIDED 2026-08-13 (Andy): standardise the envelope, and review the API shape generally** — "I definitely would like to standardise the envelope… we probably need to do a review of the API shape in general".
  ⇒ **This is NOT this repo's debt to accept, and it supersedes a line in SPT's charter** *(verified 2026-08-13: SPT's `ARCHITECTURE.md` records inconsistent envelopes as accepted debt; superseded there in SPT PR #581, so the two charters agree rather than conflict)*, which recorded them under a *match-the-neighbouring-endpoint* rule. That rule was correct while nobody intended to fix it; it is now superseded by a decision to unify.
  ⇒ **Why it bites here specifically:** `DWLFClient` returns `response.data` **raw** — six call sites, no unwrapping — so the variance is pushed out to every one of the ~100 tools individually. Unifying upstream lets the client unwrap **once**, which is the concrete payoff and the reason this repo cares about someone else's response shapes. ❗ Deliberately **not** recorded as accepted debt, and **not** attributed to a "v3" — a deferral to an unscheduled version is indistinguishable from never.
- ❗ **No automated tests — and Andy has decided this should change** *(2026-08-13: "we should add some tests if we don't have them")*. **~100 tools, zero automated coverage**, which is now the largest untested surface on the platform and — after the bespoke agent's removal — the *only* agent surface. `package.json` has no `test` script; `docs/TESTING.md` is a manual
  curl/MCP-client checklist *(inferred from: `package.json` scripts; `docs/TESTING.md`)*.

## Org context

- Single-maintainer repo (Andy Williams / DWLF), MIT-licensed and published publicly, unlike the
  private `@andywilliams/*` packages *(inferred from: `LICENSE`, `package.json` author/license,
  `publishConfig.access: public`)*.
- **Downstream of the API, outside the `GH_PACKAGES_TOKEN` cascade**: a new tool is only shippable
  once its backend endpoint is live; releasing is merge-to-master → npm publish → agent reconnect
  *(inferred from: `publish.yml` `on: push: branches: [master]`; every tool being an HTTP call)*.
- **The scarce resource is the agent's context window, not latency or money** — hence summary-first
  defaults, page caps, and pre-aggregated tools like `dwlf_get_price_picture` *(inferred from:
  `src/tools/backtests.ts:61-64`, `market-data.ts:291`)*.
- Roadmap pressure visible in PR cadence is agent-UX polish over architecture: 30 merged PRs are
  overwhelmingly new tools, defaults, and footgun documentation *(inferred from: PR titles #39–#68)*.

**Local derivation is in scope in exactly one place, and the mirror is the bigger question** *(2026-08-13)*. `dwlf_get_price_picture` collapses, sorts and caps events client-side; under the API-first rule that logic arguably belongs behind an endpoint so non-MCP clients inherit it.
⭐ **The stronger case is `src/data/strategyNodeMetadata.ts` — 408 lines hand-mirroring `visualStrategyExecutor.js`'s `supportedNodes` in `dwlf-scheduled-jobs`, consumed by `src/tools/strategies.ts`. I could not cheaply verify it, and that IS the finding**: the two are structured differently (this file carries gates, signals and exits the executor handles outside `supportedNodes`) and the executor's block is not trivially delimited, so naive extraction yields garbage rather than an answer. ⇒ **A mirror whose correctness cannot be checked in one command will drift silently** — and five doc-drift PRs say it already has. That is an argument for an API-served catalog independent of anyone's view on duplication. **DECIDED 2026-08-13 (Andy): make it API-served — one source of truth** ("it sounds like we're repeating ourselves, and we want one source of truth if we can get it").
⚠️ **Scope it honestly: this is authoring, not wiring.** The executor knows *which* nodes exist and how to run them, but carries **no `description`, no `params` schema and no `notes`** — that prose exists only here. So API-serving means **moving that content upstream and building an endpoint**, not exposing something that already exists. It would also collapse a **fifth** description surface for node types, on top of the four-site registry SYSTEM.md already tracks.
⇒ **Cheap interim if the endpoint is deferred**: a test asserting every `nodeType` here exists in the executor's `supportedNodes`. That catches deletions and typos — not stale descriptions, which is the failure that has actually happened.
