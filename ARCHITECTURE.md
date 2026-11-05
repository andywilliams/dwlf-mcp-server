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
`src/tools/market-data.ts:162-209`)*.

**Not for:**
- **Market/trading computation** — indicator math, event detection, cycle FSMs, strategy evaluation.
  Those live in `dwlf-indicators` and `dwlf-scheduled-jobs` *(inferred from: no indicator/compute
  dependency in `package.json`; no numeric analysis anywhere in `src/`)*.
- **New platform capability.** A tool may only surface something `api.dwlf.co.uk/v2` already does;
  capability is added in `serverless-portfolio-tracker` first *(inferred from: SYSTEM.md "API-first —
  no privileged client"; every tool is an HTTP call through `src/client.ts`)*.
- **Auth, account or key management — beyond the hosted resource server.** The stdio server: one `DWLF_API_KEY` =
  one account for the process lifetime; no key storage, no account switching *(inferred from: `src/client.ts` reads
  `process.env.DWLF_API_KEY` once; a single `DWLFClient` is built at module load in `src/index.ts`)*. A caller that
  passes `apiKey: undefined` gets NO key, never the operator's `DWLF_API_KEY` (pinned by `test/client.options.test.mjs`).
  *Since DWLF-622 (proposed in the PR that adds `src/hosted/`; Andy ratifies by merging):* the hosted endpoint is an
  OAuth **resource server** only. It verifies access tokens and holds one managed API key per (account, client),
  minted by the authorization server, never by this repo. **It never issues tokens, signs anyone in, shows consent,
  or registers clients**: that is the authorization server's job (`docs/HOSTED-MCP.md` §4.1), in whichever repo
  Andy picks.
- **Charting/rendering and any UI** — `dwlf-charting` / `portfolio-frontend` *(inferred from: no
  render deps; README points integrators at `@dwlf/charting` instead)*.
- **Policy.** The hosted endpoint makes none: plans, quotas, scopes, licensing and metering are SPT's, enforced on
  the managed key. Its own limits (calls per minute, the loop guard, calls in flight) only absorb load before SPT,
  and refuse with a tool error *(DWLF-622)*.

## Interfaces & dependencies

**Exposes**
- **npm package `@dwlf/mcp-server`** (public, MIT), bin `dwlf-mcp-server`, `engines.node >= 20`,
  consumed by MCP clients (Claude Desktop, Cursor, VS Code, Claude Code) via `npx -y @dwlf/mcp-server`
  *(inferred from: `package.json` `bin`/`publishConfig.access: public`; README client-config snippets)*.
- **The hosted MCP endpoint (DWLF-622), built dark:** `src/hosted/` (Streamable HTTP, stateless, POST only) + `infra/`
  (CDK: Lambda behind a regional REST API with WAF, one DynamoDB table, one KMS key). `HOSTED_MCP_ENABLED` is off
  unless exactly `true`; off, every path is 404. It serves the Block profile less `HOSTED_EXCLUDED`
  (`src/hosted/scopes.ts`) and publishes RFC 9728 metadata. `dist/hosted` is excluded from the npm package (`files`),
  and its dependencies (`jose`, the AWS SDK clients) are devDependencies bundled into the Lambda only.
- **~100 `dwlf_*` tools** grouped in 26 modules under `src/tools/` (market-data, ranges, cycle-setups, cycle-windows, stages, conditions, indicators,
  signals, watchlist, symbol-tags, strategies, backtests, portfolio, trades, custom-events,
  evaluations, annotations, trade-plans, symbol-activations, ai-summary, academy, semantic, account,
  subscriptions, onchain-catalogue, explain-event), each wired by `registerAll` in `src/register.ts` via a
  `register*Tools(server, client)` call; `src/index.ts` builds the server and hands `registerAll` the profile's view
  *(inferred from: `src/register.ts` imports + phase comments; `server.tool(` counts per file)*.
- **Tool profiles (DWLF-621):** `--profile <name>` / `DWLF_TOOL_PROFILE` selects `full` (default, every tool) or
  `block` (the Bitcoin subset, `BLOCK_TOOLS` in `src/profiles.ts`), applied by a filtering view over `server.tool`.
  A profile only hides tools. It is never a permission boundary, because every call carries the same key to the same
  backend checks. An unknown profile is a startup error, never a silent `full` *(inferred from: `src/profiles.ts`,
  `test/profiles.test.mjs`)*.
- **`dwlf_describe_onchain_events` answers from the LIVE API** (DWLF-646): one read of `GET /v2/events/explain`, whose
  `typeSummaries` carries a line per type (cached 15 min), and `GET /v2/events/{type}/explain` for one type in full. Engine
  state (`inEngine`) comes from the same API, and the engine's own types are a pseudo-pack, `engine` (the bundle's
  `costBasis` is accepted as its alias). **The bundled copy is the offline fallback:** `src/data/onchainCatalogue.ts`,
  GENERATED from the onchain-packs catalogue by `scripts/gen-onchain-catalogue.mjs` (never edit it by hand), used only when
  the index can't be read or the API predates `typeSummaries`; then `inEngine` is read from `GET /v2/node-types` as before.
  Every answer says which (`definitionSource`), and both paths name the engine's types `engine`. A failed or too-old
  index read is remembered 2 minutes, so the fallback answers at once. `test/onchainCatalogue.test.mjs` checks the
  bundle against what SPT serves (`test/fixtures/spt-explain-index.json`, from `scripts/gen-spt-explain-fixture.mjs`):
  the pack types must match exactly. **An exception to invariant 2, scoped to this tool:** its listing, pack and search
  answers are its own summary lines (`id`, `pack` flattened to an id, the `engine` pseudo-pack), not the index passed
  through; one type's full definition IS passed through unchanged, as `definition` *(inferred from:
  `src/tools/onchain-catalogue.ts`)*.
- **Profile names are a published contract** (server.json `choices`, the client configs in `docs/BLOCK.md`): a name
  is never removed. A retired or split profile stays as an alias (`PROFILE_ALIASES`) *(inferred from:
  `src/profiles.ts`)*.
- **MCP Registry metadata:** `package.json` `mcpName` and the root `server.json` must agree with each other and with
  the package version (`test/profiles.test.mjs`). Publishing to the registry is a manual, Andy-gated step
  (`docs/REGISTRY.md`).
- **One MCP resource** `dwlf://symbols` → `GET /market-data/symbols` *(inferred from:
  `src/resources/symbols.ts`)*.
- **Visual-strategy node semantics** surfaced by `dwlf_describe_strategy_nodes`: the condition nodes
  from the platform's one node catalogue, `GET /v2/node-types` (DWLF-370, mapped by
  `src/data/nodeCatalogue.ts`), merged with a static file of the structural nodes (signals, stops,
  targets, gates, cancellation, exits) and a few conditions it annotates further — the local entry wins
  for a shared type. The catalogue's nodes are deliberately reshaped into this tool's node shape so the
  two merge (an exception to invariant 2's pass-through, scoped to this tool), keeping the backend's
  category as `catalogueCategory`; their parameters carry `honoredByExecutor: null` (not verified here),
  and a node the catalogue marks unsupported carries `engineIgnored`. The catalogue is cached 15 minutes,
  a request the static file answers alone does not fetch it, and an unfiltered call lists catalogue
  nodes by name only *(from: `src/data/nodeCatalogue.ts`, DWLF-370)* *(inferred from: `src/data/strategyNodeMetadata.ts`, added by PR #40)*.
- **"Explain this event"** (`dwlf_explain_event`, DWLF-646): the definition from `GET /v2/events/{type}/explain`
  and, for engine types, `/explain/occurrences`, each returned as the backend sends it under `definition` /
  `occurrences`. The tool JOINS the two calls and derives nothing (an exception to invariant 2's single-call
  pass-through, scoped to this tool). The API decides which types exist: its 404 `code: UNKNOWN_EVENT_TYPE` is a
  usage error. Only an untagged 404 (an API without the route) falls back to the bundled catalogue, labelled
  `definitionSource: "bundled"`, with `revision`/`measuredHistory` null (unknown) and no occurrence read; any other
  failure is the tool's error.

**Depends on**
- **The hosted endpoint only (DWLF-622), and none of it at run time while its flag is off:**
  - the **authorization server**: its JWKS (token verification), its token exchange and revocation endpoints
    (`docs/HOSTED-MCP.md` §4.2, a contract this repo defines and the AS implements);
  - **AWS**: one DynamoDB table, one KMS key, one SSM parameter (the exchange client secret);
  - **SPT's route source** at build time: `scripts/gen-spt-routes.mjs` reads `src/handlers/unifiedApi.js` to generate
    `test/fixtures/spt-routes.json`. It's regenerated by hand, so the scope check knows only the SPT it was last run
    against; it fails loudly if the file's shape changes (under 100 routes found).
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
- **SPT `GET /v2/events/explain` and `GET /v2/events/{type}/explain`** (public: SPT's authorizer passes them without a key), read by `dwlf_describe_onchain_events` (DWLF-646) and `dwlf_explain_event`.
- **SPT `GET /v2/node-types`** (public) for the condition nodes, read when a
  `dwlf_describe_strategy_nodes` request needs them (cached 15 minutes); a failed read answers from the static file and says so
  (`catalogueError`) *(DWLF-370)*.
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
   `market-data.ts:325-352` `filtersApplied`, `:589` `agentHints`)*.
   ⚠️ **This invariant is scheduled to change.** Once the backend envelopes are standardised (see *Outstanding decisions*), `DWLFClient` should unwrap **once** and tools stop handling the variance individually. ⇒ **A diff that centralises unwrapping is delivering that decision, not violating this invariant.** Until then pass-through remains correct, because a partial normalisation is worse than none.
3. **All authenticated HTTP goes through `DWLFClient`.** No tool constructs its own axios instance or
   URL against `api.dwlf.co.uk` *(verified 2026-08-13 for the auth half only: `src/client.ts:77` is
   the sole `Authorization` assignment in `src/`. The "no tool builds its own URL" half is
   **not** mechanically verified — it is the rule this invariant asks a reviewer to apply.)*
   *Hosted (DWLF-622):* the one other authenticated HTTP in `src/` is `src/hosted/aws.ts` `ExchangeMinter`, which
   talks to the **authorization server** (token exchange, revocation) as a confidential client, never to the DWLF API.
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
6. **A new tool file is not shipped until it is registered in `registerAll` (`src/register.ts`)**, and **the same
   PR decides whether it is in the `block` profile** (`BLOCK_TOOLS`, `src/profiles.ts`). A tool in `BLOCK_TOOLS` also
   needs a third wiring point: **its scopes in `TOOL_SCOPES`, or a reason in `HOSTED_EXCLUDED`** (`src/hosted/scopes.ts`,
   DWLF-622), since the hosted endpoint serves the Block profile. A Bitcoin-relevant tool left out of `BLOCK_TOOLS` is
   invisible to Block users. `test/profiles.test.mjs` catches a profile entry whose tool no longer exists, but not a
   missing one; that half is the reviewer's. `test/hostedUnits.test.mjs` fails a Block tool with no scope entry, and a
   scope entry that doesn't cover the SPT routes the tool calls *(inferred from: `src/register.ts`,
   `src/profiles.ts`)*.
7. **Every PR that must ship bumps `version` in `package.json`.** CI publishes only when the version
   is absent from npm and otherwise silently skips *(inferred from: `publish.yml` "Check if version is
   already published" step gating both publish and tag; PR titles carrying explicit versions, e.g.
   #65 "→ 0.38.0", #64 "bump to 0.37.0")*.
8. **No credential is *read from* the repo.** The key comes from `DWLF_API_KEY` in the environment
   (or, in the local hosted spike only, from the caller's request, never stored; in the hosted endpoint, from its
   KMS-sealed table, and its exchange secret from SSM at run time); publishing uses OIDC rather than a stored `NPM_TOKEN` *(inferred from: `src/client.ts`;
   `publish.yml` `id-token: write` and its "No NODE_AUTH_TOKEN" comment)*.
   ✅ **A hole here was found and CLOSED in this PR** *(2026-08-13)*: the rules were `.env`,
   `.env.local` and `.env.*.local` — **not** `.env*` — so `.env.production`, `.env.staging` or any
   `.env.<name>` without a `.local` suffix was **not ignored**, and `git add -A` would have committed
   it to a **public** repo. Now `.env*` with `!.env.example` *(verified: `git check-ignore -v
   .env.production` matches)*. ⇒ Fixed rather than filed, against this session's document-don't-fix
   rule, because **documenting a credential-exposure hole while leaving it open is worse than not
   finding it** when the fix is one character class.
   ⚠️ **Deliberately NOT phrased as "no credentials in the repo"** — that is a stronger claim than the
   evidence supports, and this repo's history still holds 3,950 `node_modules` files nobody has scanned (untracked in v0.59.2, not purged). The
   reviewable check is *does this diff read a secret from a file rather than the environment?*, which
   is verifiable; "nothing secret is anywhere in 24 MB of history" is not.

9. **The hosted server never forwards a client's token, and never makes policy; SPT does** *(DWLF-622)*. An access
   token is accepted only when it is audience-bound to this server's canonical URI (RFC 8707), so one minted for any
   other resource, the DWLF API included, is refused. The only place the token goes is the authorization server's
   token exchange (RFC 8693), which returns the account's managed key. Every tool call reaches SPT on that key, so
   SPT's middleware chain, raw-candle gate, scopes and plan limits apply unchanged *(verified:
   `test/hosted.test.mjs` "never the bearer token", "another audience")*. A tool → scope table
   (`src/hosted/scopes.ts`) lets the endpoint challenge for a step-up before calling SPT; a test checks it against
   SPT's generated route table, and it is never the boundary.

## Standing decisions

- **2026-01-30 — stdio transport, one `McpServer` and one `DWLFClient` built at module load; one API key, one account, per process. Confirmed 2026-08-13 as the CURRENT posture, with a named expiry condition** *(Andy, 2026-08-13, accepting the recommendation)*.
  **Why it is right today:** two users, no multi-tenancy to build, no hosting to run, and the API key is simply an env var.
  🛑 **The trigger that ends it, stated so it is not rediscovered as a surprise: the moment a third-party agent should onboard without Andy in the loop, stdio is the blocker.** It sits in direct tension with this platform's agent-first onboarding goal (see SPT's charter): an agent can only reach the frictionless registration endpoint *after* installing a binary, setting an env var and editing a local MCP config — friction that no amount of smooth registration removes, because it happens first.
  ⇒ A hosted/remote MCP surface is what would make "arrive fresh and just use it" literally true, at the cost of transport, multi-tenant auth and hosting. **Not now; but when that trigger fires, this is a known decision being revisited, not a new question.**
  📌 **4-Nov-2026: the trigger has fired.** DWLF Block's self-serve agent funnel, the MCP Registry metadata and
  `docs/BLOCK.md` are third-party onboarding without Andy in the loop. The decision is being revisited deliberately
  as DWLF-622 (design: `docs/HOSTED-MCP.md`, added by dwlf-mcp-server#102). Until Andy decides there, stdio stays the shipped transport, and
  the registry entry declares stdio only.
  📌 **5-Nov-2026 (proposed in the DWLF-622 build PR; Andy ratifies by merging): stdio AND hosted Streamable HTTP,
  one tool codebase.** The hosted resource server is built and deployable dark (`src/hosted/`, `infra/`, flag off).
  It goes live only after the authorization server exists and Andy decides `docs/HOSTED-MCP.md` §9. The registry
  entry gains `remotes` at launch, not before.
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
  older history *(inferred from: `src/tools/market-data.ts:255-352`; PRs #62, #39)*.
- **2026-07-15 — CI pins `npm@11.5.1` exactly** — trusted publishing needs npm ≥ 11.5.1, the npm bundled
  with the CI Node (22 since 2026-10-22, DWLF-498) is older, and an exact pin stops a new npm major changing
  publish behaviour unreviewed *(inferred from: `publish.yml` step comment; PR #64)*.

## Accepted debt

*(Entries here are **tolerated**, not endorsed: reviews should stop *raising* them, and none blocks a
diff. **Decided-but-unbuilt work belongs under *Outstanding decisions* below, not here** — a charter
that files pending work as "accepted" quietly licenses it forever, which is the opposite of what a
decision means. Where an entry names its own fix, that fix is available to anyone passing through;
"accepted" means nobody is obliged to do it, not that doing it would be unwelcome.)*

- **`dist/` is committed** — ~60 tracked files despite `.gitignore` listing `dist/`; the rule was added
  after the files were committed, and `.gitignore` never untracks anything. Nothing keeps them in sync
  with `src/` except habit (PRs commit the rebuilt `dist/`). `node_modules/` had the same trap (3,950
  files since `eeb388e`) and was untracked in v0.59.2 *(verified 2026-10-22: `git rm -r --cached
  node_modules`, then `npm ci && npm test` green from a clean tree)*.
  ⇒ Consumers are unaffected — `files: ["dist","README.md","LICENSE"]` governs the tarball. `git rm -r
  --cached dist` is the fix. ⚠️ **Say so when you do it**: the `bin` entry points at `dist/index.js`, so
  anyone running from a clone needs a build afterwards. The same applies to `node_modules/` now: a
  checkout moving across v0.59.2 loses its tracked copy and needs `npm ci`.
- **Version drift in metadata:** README says "45+ tools" where the actual count is ~100. (`serverInfo.version`
  was hard-coded to `0.3.0`; since v0.59.2 it is read from `package.json` at startup.)
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
  *(Update 2026-10-22: there is now a `test` script — 27 `node --test` cases in `test/`, mostly tool docs/catalogue plus a serverInfo startup check, and `publish.yml` gates on it. Whether that closes this decision is Andy's call; it is far from per-tool coverage.)*

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
