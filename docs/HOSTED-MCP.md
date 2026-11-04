# Hosted MCP (v1.1): design

*DWLF-622 (BA-21). Claude for Andy, 4-Nov-2026. A design plus a local-only spike (§10). Nothing is deployed, and no
listing or OAuth client exists.*

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
| Runtime | One Lambda behind API Gateway (HTTP API). A fresh `McpServer` + `DWLFClient` per request, built from the caller's credential. The spike measured ~10 ms per request to build the server with every tool registered. |
| Where it lives | Recommended: **this repo**, as a second entry point (`src/http.ts`) with its own small CDK stack. The tools stay one codebase; SPT stays the front door for data (see §4); the stack holds only the Lambda, the route, WAF, a KMS key and one credential table. |
| What it calls | `api.dwlf.co.uk/v2`, exactly as the stdio server does, so SPT's middleware chain (inv. 3), raw-candle gate (inv. 4), scopes (inv. 5), quotas and metering apply unchanged. **The hosted MCP holds no data and makes no policy.** |

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

### 4.2 Upstream credential: no passthrough

The access token is for the MCP server only, and forwarding it to SPT would break the spec. On first consent the
hosted MCP gets the account a **managed API key**: minted for the SPT account behind the signed-in user, with only
the scopes the client was granted, labelled `hosted-mcp:<client_id>`.
- It is stored KMS-encrypted in the MCP stack's credential table, keyed by `(sub, client_id)`.
- Every request maps the verified token's `sub` + `client_id` to that key and calls SPT with it.
- Revoking the client's grant deletes the key.

**Why a key, not a new trust path into SPT:**
- SPT's limits, quotas, licensing and metering are already per key (DWLF-506 usage table, DWLF-615/618 tier
  limits, `apiKeyRateLimit` compute units).
- A per-client key makes "what did this agent do" one usage query, and a leaked token revocable without touching
  the user's other keys.
- The alternative is a signed service assertion (`acting_for: accountId`) that SPT trusts. It is cleaner long-term,
  but it is a new authenticator in invariant 3's chain.

### 4.3 Scopes

OAuth scopes are SPT's API-key scopes, so one vocabulary does both jobs. `scopes_supported` lists the minimum:
`markets:read`, `events:read`. Writes are requested on demand: `strategies:write`, `backtests:run`,
`subscriptions:write`.
- A tool that needs more answers `403` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…",
  resource_metadata="…"`, and the client steps up.
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
- **Today these limits are log-only** (`API_KEY_TIER_LIMITS` unset, DWLF-506). **Hosted MCP must not launch before
  they are enforced**, or an OAuth client gets the free tier's ceiling without enforcement.
- **The MCP layer adds only what SPT can't see:**
  - SPT's 429 becomes a tool error that carries `upgradeUrl` (agents tell their human);
  - an MCP-level `tools/call` ceiling per `(sub, client_id)` per minute, there to absorb agent loops before they
    reach SPT;
  - a cap on concurrent in-flight requests per account (default 4).
- **Per-call credits** (ideas #3) attach to the existing `conditionsMetering` seam in SPT (DWLF-597), not here.

## 6 · Abuse limits

| Threat | Control |
|---|---|
| Unauthenticated floods on `/mcp`, `/authorize`, `/token`, `/register` | API Gateway throttles plus WAF rate-based rules per IP. `/register` and CIMD fetches get their own tighter buckets. |
| Agent loops (the same tool and arguments, many times a minute) | Loop guard: an identical `(tool, args)` hash > 10/min per client answers a tool error explaining the repeat. It is counted, never silent. |
| Oversized or slow requests | Body cap (256 KB, as in the spike). The Lambda timeout sits under the 29 s gateway limit. Per-tool upstream timeout 25 s. |
| DNS rebinding / browser CSRF | `Origin` validated on every request (`403` when present and unknown). No cookies on `/mcp`. |
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

1. Authorization server: **A (dwlf-identity)**, B (SPT-native) or C (managed). Recommended A.
2. Upstream credential: **per-account managed API key** (recommended) or a signed service assertion SPT trusts.
3. Domain: `mcp.block.dwlf.co.uk` (recommended), or `mcp.dwlf.co.uk/block`.
4. Which tiers may use the hosted endpoint (all, with tier limits; or paid only).
5. Whether to apply to Claude's directory given §4A, or to start with custom-connector use (users paste the URL)
   and the MCP Registry.

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
- **Measured:** three requests, each building a fresh server with the profile, in ~30 ms total.
- **Deliberately not done:** OAuth. The spike's Bearer value is a DWLF API key forwarded to the API, the
  passthrough §2 forbids. It exists only to prove the transport and the per-request build. §4 is the design for
  the real auth.
- **Needed for it:** `DWLFClient` takes `{ apiKey, baseURL }` (backwards compatible), so a host can build one client
  per caller.
