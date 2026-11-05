# Hosted MCP (v1.1): design

*DWLF-622 (BA-21). Claude for Andy, 4-Nov-2026: a design plus a local-only spike (§10). 5-Nov-2026: the resource
server is built, dark behind a flag (§11), and §4.1's recommendation is revised. Nothing is deployed, and no listing
or OAuth client exists.*

## 1 · Why, and what it ends

- **The trigger the charter named has fired.** The charter's stdio standing decision (2026-01-30, confirmed
  2026-08-13) said: *"the moment a third-party agent should onboard without Andy in the loop, stdio is the
  blocker."* Block's agent funnel (autopilot design §5) is exactly that case.
- **The high-reach directories want remote plus OAuth, not stdio** (GTM plan §6.1):
  - Claude's Connectors Directory: remote HTTPS, OAuth, 401 not 403, tool titles and read-only hints.
  - ChatGPT apps: public HTTPS MCP, OAuth or no auth, never API-key auth.
  - GitHub's registry.
- **What doesn't change:** the stdio package stays, with the same tools and the same profiles. The hosted server
  is the same tool code behind a different transport (§10 proves it).

## 2 · Protocol baseline (checked 4-Nov-2026)

- **The spec is MCP 2026-07-28.**
  - **Streamable HTTP is stateless now:** one POST endpoint; no `Mcp-Session-Id`; no GET stream; no resumable SSE.
    Each request carries its own `_meta` (protocol version, client info, capabilities), mirrored into the
    `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers.
  - A server **MUST** validate `Origin`, and **MUST** reject a header/body mismatch with `400` / `-32020`.
  - GET or DELETE from an older client gets `405`.
- **The SDK lags the spec.** This repo uses `@modelcontextprotocol/sdk` 1.32.1, which speaks up to **2025-11-25**.
  Its **stateless mode** (`sessionIdGenerator: undefined`) already matches the 2026 shape: no session, a fresh
  server per request.
  - ⇒ Build on stateless mode now. Take the SDK release that adds 2026-07-28, which brings the header mirroring and
    validation, before listing.
  - Clients on 2025-era revisions keep working through the spec's version fallback.
- **Authorization** follows the spec's OAuth 2.1 profile:
  - the MCP server is a **resource server**;
  - **Protected Resource Metadata** (RFC 9728) is required;
  - authorization-server discovery is RFC 8414 or OIDC;
  - **PKCE**;
  - **resource indicators** (RFC 8707), with tokens audience-bound to the MCP server;
  - the `iss` parameter (RFC 9207);
  - **Client ID Metadata Documents** are the preferred registration. **Dynamic Client Registration is deprecated
    but allowed.** Claude's directory accepts either, so support both. DWLF-622's title says "DCR"; CIMD is now
    the primary mechanism.
  - **Token passthrough is forbidden:** the MCP server must not accept or forward tokens not issued for it.

## 3 · Shape

| | |
|---|---|
| Endpoint | `https://mcp.block.dwlf.co.uk/mcp` (profile `block`). A `full` endpoint (`mcp.dwlf.co.uk`) only when there is a reason. |
| Transport | Streamable HTTP, POST only, JSON responses. The tools are request/response: no progress streams, no `subscriptions/listen` in v1. |
| Runtime | One Lambda behind API Gateway (HTTP API). A fresh `McpServer` + `DWLFClient` per request, built from the caller's credential. The spike's three requests (Block profile, ~50 tools) took ~30 ms in total; no timing is pinned in a test, and `full` (~100 tools) is unmeasured. |
| Shared caches | ⚠️ A per-request build loses the registration-time caches. The node-catalogue loader (15 min) is created inside `registerStrategyTools` / `registerOnchainCatalogueTools`, so on the hosted shape every `dwlf_describe_strategy_nodes` / `dwlf_describe_onchain_events` call would refetch `GET /v2/node-types`. **The hosted entry hoists caller-independent caches to process scope.** The node catalogue is public and the same for every caller, so `registerAll(server, client, { shared })` takes one loader per process. Nothing caller-specific is ever shared. |
| Where it lives | Recommended: **this repo**, as a second entry point (`src/http.ts`) with its own small CDK stack. The tools stay one codebase; SPT stays the front door for data (see §4); the stack holds only the Lambda, the route, WAF, a KMS key and one credential table. |
| What it calls | `api.dwlf.co.uk/v2`, exactly as the stdio server does, so SPT's middleware chain (SPT charter inv. 3), raw-candle gate (SPT inv. 4), scopes (SPT inv. 5), quotas and metering apply unchanged. **The hosted MCP holds no data and makes no policy.** |

## 4 · Auth: OAuth 2.1 in front, an on-behalf-of credential behind

```
MCP client ──(OAuth access token, aud = https://mcp.block.dwlf.co.uk/mcp)──▶ hosted MCP ──(per-account API key)──▶ SPT /v2
                     ▲                                                    │
                     └── authorization server: sign-in, consent, tokens ◀─┘ (JWKS for local verification)
```

### 4.1 The authorization server (decision for Andy)

| Option | For | Against |
|---|---|---|
| **A. dwlf-identity** (recommended) | It already issues audience-scoped ES256 tokens with JWKS, Google and email-link sign-in, and rotating, revocable refresh tokens. It is the platform's identity service by charter. It lines up with DWLF-642 (Block as its own product). | It needs an OAuth surface it doesn't have: `/authorize` with a consent page, `/token` with PKCE and `resource`, CIMD fetching, DCR, RFC 8414 metadata. D1 (DWLF-613) puts Block v1 accounts in SPT, so identity has to map its user to an SPT account (§4.2). |
| B. SPT-native | Consistent with D1. One codebase for Block accounts. | It puts an authorization server inside the engine, which identity's charter says is not the engine's job. That is a second identity system to retire later. |
| C. Managed (WorkOS / Stytch / Auth0, which offer MCP auth) | Fastest to a compliant flow, CIMD and DCR included. | A vendor and a cost. The account link to SPT is still ours to build. User data sits with a third party, which needs a privacy-policy line. |

**5-Nov-2026: the recommendation changes to B, because of D1.** Writing the build showed what A depends on.
- Block accounts live in SPT (D1, decided 4-Nov). They're created by `/v2/agent/register` with a random password,
  so a Block user has **no sign-in anywhere**: only an API key and the email that activated it.
- dwlf-identity doesn't know them. Its email links go only to invited or known addresses, and accounts are created
  by staff. Before identity could sign a Block user in at `/authorize`, it would need self-serve accounts for SPT's
  Block users, which is BA-41 (Block as its own product), weeks away.
- And under A, minting the managed key needs either the user's SPT session or a privileged "mint for this account"
  path into SPT. Under B the authorization server IS SPT, so the key is minted in-process.
- ⇒ **Recommended: B (SPT-native) for v1.1, moving to identity together with the rest of Block's accounts in
  BA-41.** It adds no debt that D1 hasn't already accepted, and the exit is the same one. SPT gains:
  - an email one-time code sign-in for Block accounts (the billing portal's `requireSession` needs one too);
  - `/oauth/authorize` (consent), `/oauth/token` (authorization code + PKCE + `resource`, refresh rotation, and the
    token exchange in §4.2), `/oauth/register` (DCR), CIMD fetching, `/oauth/revoke`;
  - RFC 8414 metadata and a JWKS for its ES256 access tokens.
- C (managed) still needs the same Block sign-in link and a privileged minting path, so it saves less than it looks.

### 4.2 Upstream credential: no passthrough

The access token is for the MCP server only, and forwarding it to SPT would break the spec. On first consent the
hosted MCP gets the account a **managed API key**: minted for the SPT account behind the signed-in user, with only
the scopes the client was granted, labelled `hosted-mcp:<client_id>`.
- It is stored KMS-encrypted in the MCP stack's credential table, keyed by `(sub, client_id)`.
- Every request maps the verified token's `sub` + `client_id` to that key and calls SPT with it.
- Revoking the client's grant deletes the key.

**How the key is minted (built 5-Nov; the authorization server's side of the contract):** a token exchange
(RFC 8693) at the authorization server, which is the only place the access token ever goes.
```
POST {token endpoint}            Authorization: Basic <the hosted MCP's client id:secret>   (secret in SSM)
  grant_type=urn:ietf:params:oauth:grant-type:token-exchange
  subject_token=<the caller's access token>   subject_token_type=urn:ietf:params:oauth:token-type:access_token
  requested_token_type=urn:dwlf:params:oauth:token-type:api-key   resource=https://api.dwlf.co.uk/v2
→ 200 { access_token: <managed API key>, issued_token_type: urn:dwlf:params:oauth:token-type:api-key,
        key_id, scope: <exactly the token's scopes>, expires_in: <seconds: the key expires at SPT with the grant> }
POST {revocation endpoint}       token=<managed API key>&token_type_hint=urn:dwlf:params:oauth:token-type:api-key
```
- The AS must check that the grant behind the token is still live, and mint with exactly its scopes. The host
  refuses and revokes a broader key anyway.
- **The key expires with the grant** (SPT keys take an expiry): a grant that lapses rather than being revoked leaves
  no live key behind. The host's record carries the same expiry as its TTL, and an expired record counts as absent.
- **Records are keyed by (issuer, sub, client_id)**, hashed, and the KMS encryption context names all three. When
  Block's accounts move to dwlf-identity (BA-41), the issuer changes, so new records start and old ones are never
  reused. The migration's job is to revoke the old managed keys at SPT (they're labelled `hosted-mcp:<client_id>`),
  and the old records then expire. Disconnecting an account is the same: the AS revokes its keys, and each record
  drops on SPT's 401. Nothing here scans the table.
- The key is minted internally (as `/v2/agent/register` does), not through `POST /v2/api-keys`, whose allow-list
  omits `markets:read`, the scope most Block tools need.
- Revoking a grant revokes its key at the source. The host learns of it from SPT's 401 on the next call, drops the
  record, and the next call re-exchanges (which a revoked grant refuses).

**Why a key, not a new trust path into SPT:**
- SPT's limits, quotas, licensing and metering are already per key (DWLF-506 usage table, DWLF-615/618 tier
  limits, `apiKeyRateLimit` compute units).
- A per-client key makes "what did this agent do" one usage query, and a leaked token revocable without touching
  the user's other keys.
- The alternative is a signed service assertion (`acting_for: accountId`) that SPT trusts. It is cleaner long-term,
  but it is a new authenticator in SPT's middleware chain (SPT charter inv. 3).

### 4.3 Scopes

OAuth scopes are SPT's API-key scopes, so one vocabulary does both jobs. `scopes_supported` lists the minimum:
`markets:read`, `events:read`. Writes are requested on demand: `strategies:write`, `backtests:run`,
`subscriptions:write`.
- A tool that needs more answers `403` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…",
  resource_metadata="…"`, and the client steps up.
- **Which scope each tool needs** is a tool → scope table in this repo, generated from SPT's route → permission map
  (the routes each tool calls). A test fails when a tool calls a route the table doesn't cover. The MCP layer checks
  it before calling SPT, so the challenge names the scopes up front instead of after a round trip.
- **The managed key follows the grant.** The key record stores its scope set. On each request, if the verified
  token's scopes differ from the key's (after a step-up, or a narrowed grant), the host mints a key with exactly the
  token's scopes, swaps it in, then revokes the old one. A key is never broader than the live grant, and a step-up
  never loops on SPT's 403.
- `401` (never `403`) means no token or an invalid token, as Claude's directory requires.
- `offline_access` is not advertised by the resource (spec).

### 4.4 Client registration

- **CIMD first.** Fetch the client's `client_id` URL with SSRF guards: HTTPS only, no private or link-local
  addresses after DNS resolution, ≤ 5 KB, 5 s timeout, cached by `Cache-Control` (max 24 h).
- **DCR** as the fallback, rate-limited per IP, with unused registrations expiring after 30 days.
- **Pre-registered** entries for the directories that issue fixed client ids.
- **Consent page:**
  - shows the client name from its metadata and the **redirect host**, verbatim;
  - lists the scopes in plain words;
  - states "conditions, not calls: this agent can read market conditions and, if you allow it, create strategies
    and alerts in your account".

## 5 · Quotas per tier

- **Enforcement stays in SPT**, on the per-account managed key:
  - the tier limits from DWLF-615 (free / basic / pro / power);
  - enforced by DWLF-618, which also brings the 429 body with `upgradeUrl` and the plan table;
  - metered in the DWLF-506 usage table.
- **They are enforced for Block accounts since 4-Nov-2026** (DWLF-618, SPT #728: per account on RateLimitsTable
  counters; the 429 carries `upgradeUrl`). Before then they were log-only (DWLF-506). **The launch checklist (§11)
  re-checks it**: the MCP layer's limits fail open on the strength of SPT's.
- **The MCP layer adds only what SPT can't see:**
  - SPT's 429 becomes a tool error that carries `upgradeUrl` (agents tell their human);
  - an MCP-level `tools/call` ceiling per `(account, client_id)` per minute, there to absorb agent loops before they
    reach SPT;
  - a cap on concurrent in-flight requests **per account**, across all its clients (default 4), so registering more
    clients (DCR) doesn't buy more concurrency.
- **Per-call credits** (ideas #3) attach to the existing `conditionsMetering` seam in SPT (DWLF-597), not here.

## 6 · Abuse limits

| Threat | Control |
|---|---|
| Unauthenticated floods on `/mcp`, `/authorize`, `/token`, `/register` | API Gateway throttles plus WAF rate-based rules per IP. `/register` and CIMD fetches get their own tighter buckets. |
| Agent loops (the same tool and arguments, many times a minute) | Loop guard: an identical `(tool, args)` hash > 10/min per client answers a tool error explaining the repeat. It is counted, never silent. |
| Oversized or slow requests | Body cap (256 KB, as in the spike). Each `tools/call` runs under a **host deadline of 24 s** (an `AbortController` around the handler): on expiry the host returns an `isError` tool result ("took too long; try a narrower request"), never a gateway 504. Each upstream request gets `DWLFClient({ timeoutMs: 20000 })` (the option exists now; the stdio default stays 30 s). Multi-page tools (`dwlf_get_events` follows up to 40 pages; `dwlf_get_setup_transitions` up to 50 requests) need the remaining deadline passed into their loops, so they stop paging and say they were truncated. That is a build-step change to those two tools. If 24 s proves too tight, a Lambda Function URL (no 29 s cap) is the fallback. |
| DNS rebinding / browser CSRF | Server-side clients only in v1: any request carrying `Origin` is refused (`403`), and there is no CORS. Browser clients would need an allowlist plus CORS. No cookies on `/mcp`. |
| CIMD SSRF, metadata poisoning | The fetch guards in §4.4. Redirect URIs must match the document exactly. Consent always shows the redirect host. |
| Consent phishing (a lookalike client name) | The verified host is shown. Clients previously denied are blocked per user. Staff can block a client id globally. |
| Token theft | Short access tokens (~15 min, identity's default), rotating refresh tokens, audience binding, revocation on grant removal. Tokens are never logged; logs hold `sub` hashes. |
| Free-account farming, key sharing | DWLF-636 (one free account per verified email, key-sharing heuristic). The per-client managed key makes sharing visible. |
| Prompt injection through tool output | Tool output is data. Descriptions carry no instructions to call external URLs. The Block profile's instructions cover framing only. |

## 7 · Directory readiness (beyond the transport)

- **Tool annotations:** each tool gets a `title`, plus `readOnlyHint`, `destructiveHint` and `openWorldHint`
  (Claude's directory requires titles and read-only hints). That is a follow-up in this repo, and the stdio
  package benefits too.
- **Pages:** privacy policy, docs, support contact, icon, a test account, and at least three example prompts
  (DWLF-614 / DWLF-627 own the pages; `docs/BLOCK.md` has the prompts).
- **Policy gates (Andy):**
  - Claude's directory policy §4A says it "does not generally allow cryptocurrency software". It needs a written
    exception.
  - ChatGPT bars crypto "offerings involving speculation".
  - The "conditions, not calls" framing, and the absence of trading, transfers and advice, is the case to make.
    DWLF-598 (wording review) comes before any submission.
- **The MCP Registry entry gains `remotes`** (`streamable-http`, the URL above) beside the npm package
  (`docs/REGISTRY.md`).

## 8 · Phasing

1. **Prerequisites:**
   - DWLF-618: tier limits enforced, and the 429 body;
   - DWLF-615: the tier model;
   - the authorization-server decision (§4.1);
   - an SDK release with 2026-07-28.
2. **Build:** `src/http.ts` + the CDK stack; OAuth resource-server checks (JWKS verify, `aud` = the canonical
   URI, scopes); the credential table and minting; the MCP-level limits; tool annotations.
3. **AS work** (in the chosen home): authorize/consent, token with PKCE + `resource`, CIMD, DCR, RFC 8414
   metadata, revocation.
4. **Staging:** `mcp.staging…` with a test account. Run the MCP Inspector and a Claude custom connector against
   it. Then a pen-test pass on the OAuth endpoints.
5. **Live, then listings.** Each listing is a separate Andy decision.

**Charter:** this ends the stdio standing decision. When step 2 starts, amend the charter in the same PR:
- the decision becomes "stdio and hosted Streamable HTTP, one tool codebase";
- the "Not for: hosting a remote endpoint" line goes;
- a new invariant: **the hosted server never forwards a client's token and never makes policy; SPT does**.

## 9 · Decisions for Andy

1. Authorization server: A (dwlf-identity), **B (SPT-native)** or C (managed). **Recommended B since 5-Nov** (§4.1:
   Block accounts have no sign-in, and identity can't know them before BA-41). The resource server takes any
   issuer by configuration, so this choice changes no code here.
2. Upstream credential: **per-account managed API key** (recommended) or a signed service assertion SPT trusts.
3. Domain: `mcp.block.dwlf.co.uk` (recommended), or `mcp.dwlf.co.uk/block`.
4. Which tiers may use the hosted endpoint (all, with tier limits; or paid only).
5. Whether to apply to Claude's directory given §4A, or to start with custom-connector use (users paste the URL)
   and the MCP Registry.
6. **The OAuth scope vocabulary** (raised by the 5-Nov arch review). Today the scopes ARE SPT's permission names
   (`markets:read`, `settings:write`, …). Once clients hold grants for them, SPT can't rename or split a permission
   without breaking those grants. And consent is only as fine-grained as SPT's RBAC: alerts need `settings:write`,
   which also covers webhooks and Telegram settings.
   - **Recommended: a small public vocabulary, decided before launch** (it costs nothing while dark).
     - `block:read` covers every read.
     - `block:build` covers custom events, strategies, backtests and evaluations.
     - `block:alerts` covers subscriptions.
   - The AS expands each public scope to SPT permissions when it mints the key, so the map lives in SPT, beside the
     permissions it names. This repo's `TOOL_SCOPES` would switch to the public names.
   - The alternative is to keep SPT's names and treat them as frozen once listed.

## 10 · Spike (local only): `spike/hosted-http.mjs`

`npm run build && node spike/hosted-http.mjs [--port 8787]` serves the **Block profile** over stateless Streamable
HTTP on `127.0.0.1`. It isn't shipped (`spike/` is outside `files`).
- **Proved** (`test/hostedSpike.test.mjs`, 5 passing):
  - `initialize`, `tools/list` and a real `tools/call` (`dwlf_describe_onchain_events`) each work as independent
    POSTs, with no session id minted;
  - the tool list is exactly `BLOCK_TOOLS`, and the profile's instructions arrive;
  - no credential → `401` with `WWW-Authenticate: Bearer resource_metadata=…`, and the RFC 9728 metadata is served;
  - GET/DELETE → `405`;
  - a foreign `Origin` → `403`;
  - a body over 256 KB → `413` before any server is built.
- **Measured, loosely:** three requests, each building a fresh Block-profile server (~50 tools), in ~30 ms total.
  This is from one local run; no test pins it.
- **Deliberately not done:** OAuth. The spike's Bearer value is a DWLF API key forwarded to the API, the
  passthrough §2 forbids. It exists only to prove the transport and the per-request build. §4 is the design for
  the real auth.
- **Needed for it:** `DWLFClient` takes `{ apiKey, baseURL, timeoutMs }` (backwards compatible), so a host can build
  one client per caller. `apiKey: undefined` means no key, never the operator's (`test/client.options.test.mjs`).
- **Not in the spike:** shared caches (each request refetches the node catalogue), the per-tool deadline, scopes.

## 11 · Build (5-Nov-2026): the resource server, dark

What exists, behind `HOSTED_MCP_ENABLED` (off unless exactly `true`; off, every path is 404 and nothing else is read):
- **`src/hosted/handler.ts`:** a Web-standard `Request → Response` handler, driven by the Lambda adapter and the
  tests alike. Stateless Streamable HTTP, POST only, JSON responses, a fresh `McpServer` + `DWLFClient` per request,
  serving the Block profile less `HOSTED_EXCLUDED` (`dwlf_register_agent`, and `dwlf_get_market_data`, which SPT
  refuses to every key but the owner's).
- **`auth.ts`:** tokens verified locally against the issuer's JWKS: ES256, `typ: at+jwt` (RFC 9068), `iss`, `aud` =
  the canonical URI, `sub` and `client_id` required. 401 (never 403) with `resource_metadata`; RFC 9728 metadata at
  both well-known paths. A failure to read the JWKS is a 503 with `Retry-After`, never a 401, so an outage of the
  authorization server doesn't make every client throw its token away.
- **Tools only:** the hosted server registers no resources or prompts, so nothing but a scoped, limited, keyed tool
  call ever reaches the DWLF API.
- **`scopes.ts`:** the tool → scope table. `test/hostedUnits.test.mjs` reads each tool's calls from its source and
  checks them against SPT's route → permission table (`test/fixtures/spt-routes.json`, from
  `npm run gen:spt-routes -- <SPT checkout>`). A missing scope answers 403 `insufficient_scope` naming the held and
  the needed scopes.
- **`credentials.ts` + `aws.ts`:** the managed key (§4.2).
  - It's exchanged, then KMS-sealed with an encryption context naming (issuer, account, client), and cached opened
    for 5 minutes per instance.
  - Each record remembers the grant it was minted for: the token's scopes and `iat`. A newer token with other scopes
    re-mints under a conditional write, and the loser of a race revokes its own key. An older token reuses the newer
    key rather than flipping it back.
  - A key is dropped on SPT's 401. An exchange the AS refuses with `invalid_grant` answers 401 `invalid_token` (the
    client re-authorises), logged as an ordinary event and not alarmed.
- **`limits.ts`:** on the table, all as tool errors: 60 calls a minute and 10 identical calls a minute (the loop
  guard) per (account, client); 4 in flight per account (leases that lapse on their own). A table outage lets calls through (SPT's
  plan limits still hold) and is logged.
- **Deadline:** 24 s from the request's arrival, so the token check and the credential work count against it.
  - A `tools/call` races it. On expiry the host aborts the caller's upstream requests (`DWLFClient({ signal })`) and
    answers an `isError` result.
  - Each upstream request's timeout is capped at the time left, less 1 s (and at 20 s anyway).
  - `dwlf_get_events` stops auto-paging when under 3 s remain, or when a page runs out of time, and returns the pages
    it has, marked `incomplete`, with a cursor.
- **SPT's plan 429** reaches the agent as a tool error carrying `upgradeUrl` (the stdio package too).
- **Shared caches:** one node-catalogue loader per instance, on a client with no key (filed item 2 from #102).
  `DWLFClient` now refuses a non-finite or non-positive `timeoutMs` (filed item 3).
- **`infra/`:** a CDK stack, deployed by hand only.
  - Lambda: Node 22, arm64, 27 s, reserved concurrency 25.
  - A regional REST API, chosen because WAF can't attach to an HTTP API. Only `/mcp` and the metadata paths reach
    the function. The stage throttle is 50 rps with a burst of 100, and request bodies are never logged.
  - WAF: 1,000 requests per 5 minutes per IP, plus AWS's common rule set (its 8 KB body rule only counts).
  - The table is retained and deletion-protected, with TTL and point-in-time recovery. The KMS key is retained and
    rotates.
  - Alarms to an SNS topic (`-c alarmEmail=…` subscribes) on Lambda errors, throttles and API 5xx, and on the log
    events that mean degraded-but-answering: an unexpected 500, the limits failing open, a revocation that failed,
    a caller who couldn't get a key, and an unreadable JWKS. The handler writes bare JSON lines to stdout, which
    `console.log` would prefix, so the JSON metric filters match.
  - `npm run test:infra` synthesises it, bundling included, and the new PR workflow (`.github/workflows/ci.yml`)
    runs it with the package tests.

**Not built here, and why:**
- **The authorization server** (§4.1): it waits on §9.1, and under B it is an SPT PR.
- The custom domain and certificate: they wait on §9.3.
- The per-tool annotations (§7).
- The SDK release with 2026-07-28: not out yet.
- The `remotes` registry entry: it lands at launch.

**Launch checklist** (each item is an Andy decision or a separate PR):
0. SPT's Block tier limits still enforced (DWLF-618), and `npm run gen:spt-routes` re-run against SPT main, with
   the scope test passing;
1. §9 decided;
2. the AS live, with the exchange contract above;
3. the SSM secret set;
4. the domain;
5. `-c enabled=true` deployed to staging, then the MCP Inspector and a Claude custom connector run against it;
6. a pen-test pass on the AS endpoints;
7. live.

