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
- **Hosting a remote/multi-user MCP endpoint** — stdio only today *(inferred from: `src/index.ts`
  uses `StdioServerTransport`; no HTTP server code)*.

## Interfaces & dependencies

**Exposes**
- **npm package `@dwlf/mcp-server`** (public, MIT), bin `dwlf-mcp-server`, `engines.node >= 18`,
  consumed by MCP clients (Claude Desktop, Cursor, VS Code, Claude Code) via `npx -y @dwlf/mcp-server`
  *(inferred from: `package.json` `bin`/`publishConfig.access: public`; README client-config snippets)*.
- **~100 `dwlf_*` tools** grouped in 20 modules under `src/tools/` (market-data, ranges, indicators,
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

**The Academy CDN is a real SECOND outbound contract, and it bypasses `DWLFClient` entirely** *(verified 2026-08-13)*. `src/tools/academy.ts` imports `axios` directly and calls `https://academy.dwlf.co.uk/live` — hard-coded at `:5`, fetched at `:38` and `:99`, 404-checked inline at `:109` — so it carries **no API key, no auth, and none of the client's shared error/retry handling**. ⇒ **This repo has two outbound dependencies, not one**: the authenticated DWLF API via `DWLFClient`, and an unauthenticated public CDN. A reader assuming everything goes through `DWLFClient` is wrong about the whole academy tool surface. **DECIDED 2026-08-13 (Andy): it IS a contract.** The academy exists to teach a fresh agent what DWLF is and how to use it — "we just want to teach agents that come to DWLF fresh what DWLF is all about" — so it is a first-class dependency, not opportunistic reuse. `dwlf-academy-content` owns the schema.
⚠️ **Recorded pushback, accepted by Andy: it does not yet LOOK like a contract.** A hardcoded URL fetched with bare `axios`, no auth, no shared retry and an inline 404 check means that if `academy.dwlf.co.uk/live` moved or changed shape, this repo would break at runtime with nothing declaring the relationship. ⇒ **Calling it a contract is the decision; making the code express one is outstanding work** — a named schema owner and a versioned or discoverable manifest, so a consumer can tell that content changed.
> `dwlf-academy-content` owes us), or opportunistic reuse of a public URL?

## Invariants

A reviewer should be able to test a diff against each of these:

1. **Every user-supplied symbol passes through `normalizeSymbol()` before it reaches the API.** A new
   tool taking a symbol without calling it is a bug *(inferred from: 54 `normalizeSymbol` call sites
   across `src/`; `src/client.ts` docstring)*.
2. **Responses are passed through, not re-enveloped.** Tools return `JSON.stringify(<backend data>)`;
   enrichment is *additive* alongside the backend shape (`agentHints`, `filtersApplied`), never a
   replacement wrapper *(inferred from: ~100 `JSON.stringify` returns in `src/tools/*`;
   `market-data.ts:318-333` `filtersApplied`, `:573` `agentHints`)*.
3. **All authenticated HTTP goes through `DWLFClient`.** No tool constructs its own axios instance or
   URL against `api.dwlf.co.uk`; the sole exception is the unauthenticated Academy CDN *(inferred
   from: `src/client.ts` is the only place `Authorization` is set; `academy.ts` is the only tool file
   importing `axios`)*.
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
8. **No credentials in the repo.** The key comes from `DWLF_API_KEY` only; publishing uses OIDC, not a
   stored `NPM_TOKEN` *(inferred from: `src/client.ts`; `publish.yml` `id-token: write` and its
   "No NODE_AUTH_TOKEN" comment; `.gitignore` `.env*`)*.

## Standing decisions

- **2026-01-30 — stdio transport, one `McpServer` and one `DWLFClient` built at module load; one API key, one account, per process. Confirmed 2026-08-13 as the CURRENT posture, with a named expiry condition** *(Andy, 2026-08-13, accepting the recommendation)*.
  **Why it is right today:** two users, no multi-tenancy to build, no hosting to run, and the API key is simply an env var.
  🛑 **The trigger that ends it, stated so it is not rediscovered as a surprise: the moment a third-party agent should onboard without Andy in the loop, stdio is the blocker.** It sits in direct tension with this platform's agent-first onboarding goal (see SPT's charter): an agent can only reach the frictionless registration endpoint *after* installing a binary, setting an env var and editing a local MCP config — friction that no amount of smooth registration removes, because it happens first.
  ⇒ A hosted/remote MCP surface is what would make "arrive fresh and just use it" literally true, at the cost of transport, multi-tenant auth and hosting. **Not now; but when that trigger fires, this is a known decision being revisited, not a new question.**
  confirm: no rationale is written anywhere in the repo; is stdio-only/one-account-per-process the
  intended permanent posture? *(inferred from: `src/index.ts`, first commit `eeb388e`)*
- **2026-05-07 — symbol normalisation uses a narrow `KNOWN_PAIRED` allow-list, stocks pass through
  unchanged** — because the previous `KNOWN_STOCKS` allow-list appended `-USD` to any unrecognised
  ticker and the API rejected them (PAAS, DRD, HMY, NEM, SPY); the paired list is "much narrower and
  stable — far less maintenance burden than tracking every stock symbol" *(inferred from:
  `src/client.ts` docstring; PR #16)*.
- **2026-05-20 — publish via npm Trusted Publishing (OIDC), no long-lived `NPM_TOKEN`** — because the
  trusted-publisher config on npmjs.com authorises this repo+workflow with a short-lived
  GitHub-issued token instead of a stored secret *(inferred from: `publish.yml` permissions comment;
  PR #32)*.
- **2026-05-27 — ship a hand-maintained catalog of executor node semantics rather than deriving it**
  — because "an agent (or a user) can ask 'what does this SL node actually do at runtime?' without
  having to read engine code"; it is "INTENTIONALLY informational" and updated when the executor
  changes *(inferred from: `src/data/strategyNodeMetadata.ts` header; PR #40)*.
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

- **`node_modules/` is committed** — 3,950 tracked files, present since the first commit `eeb388e`,
  despite `.gitignore` listing `node_modules/` *(inferred from: `git ls-tree -r HEAD | grep
  '^node_modules/'` = 3950)*.
  🛑 **The cause is that `.gitignore` never untracks anything** *(verified 2026-08-13: `node_modules/` is line 2 of `.gitignore`, and 3,950 files remain tracked)*. The rule was added *after* the files were committed, so git faithfully keeps versioning all of them while appearing to ignore them — `.git` is **24 MB**, in a **public** repo. `dist/` is the same trap, smaller: 60 tracked files, also gitignored, and **currently out of sync with `src/`** (15 modified in the working tree).
  ⇒ Consumers are unaffected — `files: ["dist","README.md","LICENSE"]` governs the tarball — so this is hygiene, not a shipping defect. `git rm -r --cached` is the fix for both. ⚠️ **Say so when you do it**: the `bin` entry points at `./dist/index.js`, so anyone running from a clone rather than the published package needs a build afterwards, and "it broke when you deleted dist" is the predictable complaint.
- **`dist/` is committed** (60 files, also gitignored) and is currently out of sync with `src/`; the
  published artifact is rebuilt by `prepublishOnly`/CI regardless *(inferred from: tracked `dist/*`;
  working-tree shows modified `dist/` artifacts; `publish.yml` runs `npm run build`)*.
- ❗ **No automated tests — and Andy has decided this should change** *(2026-08-13: "we should add some tests if we don't have them")*. **~100 tools, zero automated coverage**, which is now the largest untested surface on the platform and — after the bespoke agent's removal — the *only* agent surface. `package.json` has no `test` script; `docs/TESTING.md` is a manual
  curl/MCP-client checklist *(inferred from: `package.json` scripts; `docs/TESTING.md`)*.
- **Backend envelope variance is inherited, not normalised** (`data` / `results` / `manifest` / bare
  objects) — unification deferred rather than papered over in this repo *(inferred from: pass-through
  pattern in `src/tools/*`; the handbook's response-wrapping audit, 87% already `data`)*.
  🛑 **DECIDED 2026-08-13 (Andy): standardise the envelope, and review the API shape generally** — "I definitely would like to standardise the envelope… we probably need to do a review of the API shape in general".
  ⇒ **This is NOT this repo's debt to accept, and it supersedes a line in SPT's charter**, which currently records inconsistent envelopes as accepted debt under a *match-the-neighbouring-endpoint* rule. That rule was correct while nobody intended to fix it; it is now superseded by a decision to unify.
  ⇒ **Why it bites here specifically:** `DWLFClient` returns `response.data` **raw** — six call sites, no unwrapping — so the variance is pushed out to every one of the ~100 tools individually. Unifying upstream lets the client unwrap **once**, which is the concrete payoff and the reason this repo cares about someone else's response shapes. ❗ Deliberately **not** recorded as accepted debt, and **not** attributed to a "v3" — a deferral to an unscheduled version is indistinguishable from never.
  confirm the deferral target ("v3") is a real decision and not just an audit note.
- **Version drift in metadata:** `src/index.ts` advertises `version: '0.3.0'` while the package is at
  `0.41.0`, and README says "45+ tools" where the actual count is ~100 *(inferred from: `src/index.ts`
  vs `package.json`; `server.tool(` count)*.
- **The strategy-node catalog can silently drift from the executor** — it is corrected by hand after
  the fact *(inferred from: PRs #43, #44, #47, #48, #50, all titled as catalog/doc-drift fixes)*.
- **Manual, one-bump-per-PR versioning** with no semantic-release; a missed bump merges but never
  ships *(inferred from: `publish.yml` skip-if-published; PR #46 "bump to 0.29.1 to publish annotation
  tool fix (#45)")*.

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
> caps events client-side *(`src/tools/market-data.ts:540-580`)* — under API-first that logic arguably
> belongs behind an endpoint so non-MCP clients get it too.
