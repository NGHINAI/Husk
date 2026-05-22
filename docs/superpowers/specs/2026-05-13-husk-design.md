# Husk — Browser Engine for AI Agents
**Design Document v1**

| Field | Value |
|---|---|
| Status | Brainstorm complete · awaiting implementation plan |
| Date | 2026-05-13 |
| License | AGPL v3 (core) · MIT (examples, protocol schemas) · CLA required for external contributions |
| Project root | `/Users/nirmalghinaiya/Desktop/husk/` |
| Engine basis | Consumes [lightpanda](https://lightpanda.io) (AGPL v3) as a binary dependency for v0. Fork remains as `engine/upstream` submodule for v0.1+ patches. *(Amended post-M2-spike — see [DECISION.md](./../spikes/2026-05-14-m2-lightpanda-audit/DECISION.md).)* |
| Tech stack | TypeScript/Node (orchestrator + canonical SDK + adapter) · Python (shim SDK) · Zig 0.15.2 *(optional, only for engine extensions in v0.1+ — v0 consumes prebuilt lightpanda binary)* |
| v0 target | **5–6 weeks**, single engineer *(revised from 6–8 weeks post-M2-spike; M2 production drops to 2 weeks of pure TS work)* |

---

## 1. Executive Summary

**Husk is an open-source browser engine purpose-built for AI agents.** Unlike every existing "AI browser" product on the market (Browserbase, browser-use, Stagehand, Skyvern, StableBrowse — all of which wrap a full Chromium binary with Playwright), Husk is an actual browser engine: forked from lightpanda, it has no paint pipeline, no GPU compositor, no pixel rasterization. The page is parsed, JavaScript executes, the DOM is computed — and then the output is emitted as a semantic, agent-friendly JSON-LD structure with stable IDs, rather than as a framebuffer no human looks at.

Husk ships with a deterministic **watchdog** that physically prevents agents from clicking elements that don't exist, performing actions forbidden by policy, or proceeding past missing required state. The v0 sales line is: *the only OSS browser where your agent **cannot** click a button it hallucinated.*

The v0 wedge is the watchdog pillar. The auth pillar (full SSO/MFA/SAML) and the DOM-drift router pillar (cross-deploy semantic-ID resolution with self-healing selectors) ship in v0.2 and v0.1 respectively. v0 trades web compatibility for engine purity — Gmail, Salesforce, LinkedIn, and other JS-heavy enterprise apps do not work in v0; they are scheduled for the v2.0 "hybrid engine" milestone that introduces a stripped-Chromium runtime alongside the lightpanda one.

---

## 2. Problem, Positioning, and Competitive Landscape

### The status quo

Every production "AI agent browser" today is a wrapper around full Chromium driven via Playwright or raw CDP. This means:

- **Resource-heavy:** ~500MB RAM and ~800ms cold-start per session, mostly burned on layout-and-paint work nobody looks at.
- **Brittle by design:** CSS class names are webpack-generated and mutate on every deploy. Selectors built on them break weekly.
- **No safety floor:** when an LLM hallucinates a selector like `#submit-3`, the browser cheerfully passes the click event through to nothing, and the agent's downstream logic gets a confusing silent failure rather than a clean rejection.
- **Confusing positioning:** vendors market "browser engine for AI agents" while actually shipping bespoke runtimes on top of stock Chromium. The "engine" claim is largely marketing.

### Husk's differentiation

| Claim | How we deliver it |
|---|---|
| **Real browser engine for agents** | Forked lightpanda (Zig, no paint, ~50 MB, ~10 ms cold-start). Not a Chromium wrapper. |
| **Cannot hallucinate clicks** | Deterministic watchdog rejects actions targeting non-existent / invisible / disabled / policy-forbidden elements before they reach the engine. |
| **Resilient to DOM drift** | Per-site semantic stable IDs computed from role + accessible name + landmark path. Cached in a per-domain site graph; fuzzy-resolved on miss. |
| **Token-efficient snapshots** | a11y-tree-based JSON-LD with diff emission. ~99% reduction vs raw HTML, ~80% vs the a11y tree alone. |
| **Open source, AGPL** | Permissive enough for downstream agents to remain proprietary; copyleft enough that competing managed offerings must contribute back. |
| **LLM-neutral** | No LLM dependency baked in. Husk is a library + protocol. Your LLM, your loop. |

### Competitive landscape

| Product | License | Engine | Pillar focus | Notes |
|---|---|---|---|---|
| **StableBrowse** | Closed | Probably stock Chromium + bespoke runtime | Auth, DOM-drift, watchdog | Marketing positions as "engine" but no public evidence of engine-level work |
| **Browserbase** | Closed | Stock Chromium | Managed cloud + dev tooling | Infra-first |
| **Stagehand** | MIT | Playwright wrapper | Developer experience | By Browserbase |
| **browser-use** | MIT | Playwright wrapper | Python agent loop | LLM-bundled, hard to use library-only |
| **Skyvern** | AGPL | Playwright wrapper | Vision-first agent | Closest peer for licensing model |
| **Steel.dev / steel-browser** | Apache | Stock Chromium | Managed cloud | |
| **lightpanda** | AGPL v3 | Own engine (Zig + V8) | Engine only | The foundation we fork — does not ship agent-side primitives. License is aligned with Husk's core (both AGPL). |
| **Husk (this project)** | AGPL | Forked lightpanda | Watchdog wedge → all 3 pillars | The only player at the intersection of "real engine" + "agent-purpose-built" + "AGPL OSS" |

The position is empty. No one is shipping a real browser engine for agents under a strong-copyleft license with a deterministic safety floor as the v0 wedge.

### Target adopters (v0)

- Indie AI agent builders who self-host and want OSS visibility into every layer
- Series A vertical-AI startups (insurance / mortgage / prior auth) already running on Browserbase-class tools but seeking OSS for compliance / cost
- OSS contributors and researchers exploring agent infrastructure

### Explicitly **not** targets for v0

- Anyone needing to automate Gmail, Salesforce, LinkedIn, banking apps, or other JS-heavy enterprise web apps (web-compat gap inherited from lightpanda)
- Anyone needing Cloudflare bypass / TLS-fingerprint stealth (out of OSS scope, legal/ethical rabbit hole)

---

## 3. v0 Scope

### Includes

- Forked lightpanda engine with patches:
  - CDP domain `Snapshot` — emits compressed JSON-LD page representation
  - CDP domain `SemanticId` — computes stable IDs on every DOM commit
  - Mutation observer aggregator with diff emission
  - Hooks into the a11y tree builder for our extractor
- TypeScript orchestrator binary (`husk`) exposing JSON-RPC 2.0 over HTTP/2:
  - Session manager (engine subprocess pool, 1:1 with sessions)
  - Site graph cache (SQLite, per-domain `stable_id → current_selector` map)
  - Watchdog rule engine (sanity + policy layers, deterministic)
  - Action planner (intent → CDP `Input` operations)
  - CDP client to engine subprocesses
- TypeScript SDK (`@husk/sdk`) — canonical, zero-LLM-dependency
- Python SDK (`husk-sdk`) — generated shim against the same JSON-RPC spec
- LLM tool-calling manifests (OpenAI, Anthropic, generic JSON Schema)
- MCP server (`@husk/mcp`) — bridges Husk to MCP-aware clients (Claude Desktop, Cursor, etc.)
- CLI (`husk start`, `husk eval`, `husk run`, `husk inspect`)
- Three working example agents in `/examples`:
  1. `01-wikipedia-research` — snapshot quality + text preservation under load
  2. `02-static-form-fill` — action planner + watchdog policy rules end-to-end
  3. `03-shopify-pricecheck` — semantic-ID consistency across multi-page navigation
- README with one 10-second demo GIF per example
- Quickstart docs (`docs/quickstart.md`) and architecture docs (`docs/architecture.md`)
- GitHub Releases pipeline (npm publish, PyPI publish, binary releases for macOS arm64/x64 + Linux x64)

### Excludes (deferred to later milestones)

| Item | Milestone |
|---|---|
| Auth pillar beyond basic cookie persistence (full SSO, SAML, OIDC, MFA, TOTP, push) | v0.2 |
| DOM-drift router (cross-deploy semantic-ID resolution, self-healing selectors) | v0.1 |
| Pre-indexing pipeline (offline crawler for site graphs) | v1.0 |
| Cloud-hosted managed Husk (open core SaaS) | v0.3 |
| Vertical recipes (insurance, mortgage, prior auth playbooks) | v1.0 |
| Sites needing WebGL / WebRTC / WebAssembly / complex video/audio | inherited from lightpanda upstream |
| Anti-bot bypass / Cloudflare challenge solving / TLS fingerprint stealth | permanently out of scope |
| LLM intent validator watchdog (Layer 3) | post-v0, opt-in |
| Stripped-Chromium hybrid runtime for high-compat sites | v2.0 (needs team) |

### Non-goals for v0

- **Not** a general-purpose web automation tool. Husk is for AI agents. Humans writing fixed scripts should use Playwright.
- **Not** an LLM framework. We don't bundle an LLM client. We don't have an agent runtime. The customer's code (or LLM-loop framework) drives Husk via our SDK.
- **Not** a closed/hosted product. v0 ships only as OSS binaries + libraries.

---

## 4. System Architecture

### Two processes, three protocols

```
┌──────────────────────────────────────────────────────────────────────┐
│  CUSTOMER'S AGENT CODE     (their LLM loop, Python or TypeScript)    │
│  client.act("submit the form")                                       │
│  client.snapshot()                                                   │
│  client.goto("https://example.com")                                  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  HTTP/2 + JSON-RPC 2.0
                               │  (public Husk protocol, intent-level)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR  ─  Node binary (`husk`, TypeScript)                   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  HTTP API server (Hono on Node)                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────┬──────────────┬──────────────┬─────────────────┐   │
│  │  Session      │  Site Graph  │  Watchdog    │  Action         │   │
│  │  Manager      │  Cache       │  Rule Engine │  Planner        │   │
│  │  (engine pool)│  (SQLite)    │  (det. rules)│  (intent→ops)   │   │
│  └───────────────┴──────────────┴──────────────┴─────────────────┘   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  CDP client  (talks to engine subprocess over WebSocket)       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  Chrome DevTools Protocol over WS
                               │  (engine is spawned as child process,
                               │   one engine process per session)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ENGINE  ─  Zig binary (`husk-engine`, forked lightpanda)            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Upstream lightpanda (we don't modify, only pin):              │  │
│  │   • V8 (JavaScript)                                            │  │
│  │   • Blink-lite DOM, CSS layout (no paint/composite/raster)     │  │
│  │   • Network stack (fetch, HTTP/2, WebSocket, cookies)          │  │
│  │   • CDP base (Page, DOM, Runtime, Network, Input domains)      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Husk patches (our differentiation, in /engine/patches/):      │  │
│  │   • CDP domain `Snapshot` (new) — emits compressed JSON-LD     │  │
│  │   • CDP domain `SemanticId` (new) — resolve/persist stable IDs │  │
│  │   • Mutation observer aggregator (diff-based emission)         │  │
│  │   • A11y tree builder hooks                                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Protocol boundaries

- **Agent ↔ Orchestrator:** Husk's *public protocol*. JSON-RPC 2.0 over HTTP/2. Intent-level (`act`, `snapshot`, `goto`). Documented in `protocol/jsonrpc.openapi.yaml`. **Stable, semver'd.**
- **Orchestrator ↔ Engine:** CDP (with our custom `Snapshot` and `SemanticId` domains). WebSocket. Engine-internal. **Not stable, not exposed to customers.**
- **Engine ↔ Browser-runtime:** Internal lightpanda C++/Zig boundary. Upstream concern, we don't touch.

This separation is non-negotiable. The public protocol is the brand; CDP is implementation detail. Letting CDP leak into the SDK is what makes other products feel like "another Playwright."

### Component responsibilities

| Component | Process | Language | Responsibility |
|---|---|---|---|
| Customer agent code | theirs | Py / TS | Calls into Husk SDK in their LLM loop |
| TypeScript SDK | theirs | TS | Canonical client, generated against JSON-RPC spec |
| Python SDK | theirs | Py | Generated shim against same JSON-RPC spec |
| HTTP API server | orchestrator | TS | Public protocol surface, auth tokens (later), rate limits (later) |
| Session Manager | orchestrator | TS | Pool of engine subprocesses, 1:1 with sessions, lifecycle, restarts |
| Site Graph Cache | orchestrator | TS | Per-domain `(stable_id) → current_selector` SQLite store |
| Watchdog Rule Engine | orchestrator | TS | Pre-action validation (sanity + policy layers, deterministic) |
| Action Planner | orchestrator | TS | Translates intent strings to CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` ops |
| CDP client | orchestrator | TS | Speaks CDP to engine subprocesses |
| Engine core | engine | Zig | Upstream lightpanda — JS, DOM, network |
| Snapshot domain | engine | Zig | Husk patch — emits compressed page representation |
| SemanticId domain | engine | Zig | Husk patch — computes/resolves stable IDs in commit phase |

### Example request flow — `client.click(stable_id="btn:submit")`

1. SDK sends `POST /v1/jsonrpc` with `{method: "act", params: {session_id, action: "click", stable_id: "btn:submit"}}`
2. Orchestrator's HTTP handler routes to Action Planner
3. Action Planner asks Engine for current snapshot via CDP `Snapshot.capture`
4. Engine returns compressed JSON-LD (~200 lines for a typical page)
5. Action Planner resolves `btn:submit` via Site Graph Cache → current CSS/XPath selector
6. **Watchdog sanity pass:** does the element exist in snapshot? visible? enabled? interactive?
7. **Watchdog policy pass:** does any active policy rule forbid this action on this element?
8. If watchdog rejects → orchestrator returns `{ok: false, reason: "...", candidates: [...]}` to SDK; engine never touches it
9. If watchdog approves → orchestrator calls CDP `Input.dispatchMouseEvent` at element rect center
10. Engine fires the click; DOM mutates
11. Mutation-observer aggregator batches the resulting changes; emits diff snapshot
12. **Watchdog post-assertion pass:** did expected mutation occur within 500ms? any new error alerts?
13. Orchestrator returns `{ok: true, snapshot_diff: {...}, events: [...]}` to SDK
14. SDK returns result to agent code

If step 6, 7, or 12 fails, the agent receives a structured error and can re-plan. *This is the v0 wedge in motion.*

### Process lifecycle

- `husk start` — orchestrator boots, binds HTTP `:7777`, engine pool starts empty
- `POST /v1/jsonrpc {method: "create_session"}` — orchestrator spawns one engine subprocess, opens CDP WebSocket, returns `session_id`
- Subsequent calls operate within a named session
- `DELETE /v1/sessions/:id` (or `{method: "close_session"}`) — orchestrator sends CDP `Browser.close`, waits, force-kills engine PID if needed
- Engine crash detection: WebSocket disconnect → session marked dead → next agent call returns `{ok: false, reason: "session_dead"}`; no auto-restart in v0 (customer creates new session)

---

## 5. The Three Novel Subsystems

The orchestrator + engine architecture is non-novel — many projects have a similar shape. The *novel work*, where v0's differentiation actually lives, is in three subsystems.

### 5.1 Semantic Stable IDs

**Problem.** Modern web frameworks (React, Vue, Angular, Solid, Svelte) all generate CSS class names at build time via webpack/Vite/Turbopack. A button's class might be `class="x-9j2 a-7k1"` today and `class="m-3p2 b-4z9"` next week — same button, same code, different selector. Every Playwright script that relies on these selectors breaks within weeks of deployment. *This is the single biggest reason web automation feels brittle.*

**Solution.** Identify each element by features that mirror how a human (or a screen reader) identifies it, not by features the build pipeline produces.

```
stable_id = blake3(
  role            || '\0' ||
  name_norm       || '\0' ||    -- lowercase, trim, collapse whitespace
  landmark_path   || '\0' ||    -- "main > form#quote > footer"
  ordinal         || '\0' ||    -- 3rd interactive of this role in landmark
  context_window                -- 5 words before + 5 after in text content
)[:16]
```

Outputs a 16-byte (128-bit) URL-safe base64 identifier — 22 characters, no padding. Each input contributes:

- **Role** — ARIA role (`button`, `link`, `textbox`, `combobox`, `checkbox`, ...). Invariant across CSS rebuilds. Computed by the a11y tree builder during DOM commit.
- **Accessible name** — per WAI-ARIA accessible-name computation (`aria-labelledby` > `aria-label` > inner textContent > `placeholder` > `title`). Changes only when the user-facing label changes (i.e., when the product team intentionally edits copy).
- **Landmark path** — chain of ARIA landmarks from root to element. Uses landmark roles (`main`, `navigation`, `search`, `form`, `dialog`, `banner`, `contentinfo`, `region`). Structural, not stylistic.
- **Ordinal** — index of this element among siblings of the same role within the same landmark. Disambiguates `[3]` button "Submit" from `[1]` button "Submit" when both exist in one form.
- **Context window** — 5 words preceding + 5 words following the element in text content of the same landmark. Catches the rare edge case of identical role + identical name + identical landmark + identical ordinal (e.g., two pagination toolbars at top and bottom).

**Where it runs.** In the engine, during DOM commit (after layout, before any external observer is notified). The stable_id is attached to each interactive / landmark / text node and emitted as part of snapshots. Computing it in-engine is fast (a single blake3 hash + an a11y tree walk we'd do anyway) and ensures every snapshot has stable_ids without orchestrator round-trips.

> **v0 simplification (post-M2-spike).** The full hash above (with `landmark_path`, `ordinal`, `context_window`) is the *v0.1+ target*. The M2 spike ([DECISION.md](./../spikes/2026-05-14-m2-lightpanda-audit/DECISION.md)) found that lightpanda's upstream a11y tree does not yet track landmark paths (adding it requires ~150 lines of Zig patches). For **v0**, the simplified algorithm is:
>
> ```
> stable_id = blake3(role || '\0' || name_norm || '\0' || xpath)[:16]
> ```
>
> where `xpath` comes directly from upstream's `Accessibility.getFullAXTree` output. The xpath provides sufficient disambiguation for v0 within a single page (validated by the M2 spike PoC). `landmark_path`, `ordinal`, and `context_window` are deferred to v0.1 alongside the corresponding lightpanda patch. Where it runs also changes for v0: stable_id computation moves from *in-engine* to *orchestrator-side* (TypeScript), because we consume the prebuilt lightpanda binary unmodified. v0.1 may move it back into the engine when the landmark patch lands.

**Storage and lookup.** Per-domain SQLite at `~/.husk/site-graph/{domain}.db`:

```sql
CREATE TABLE selectors (
  stable_id      TEXT PRIMARY KEY,
  current_css    TEXT,
  current_xpath  TEXT,
  role           TEXT,
  name_norm      TEXT,
  landmark_path  TEXT,
  last_seen_at   INTEGER,  -- unix ms
  hit_count      INTEGER DEFAULT 0,
  miss_count     INTEGER DEFAULT 0
);
CREATE INDEX idx_selectors_role_name ON selectors(role, name_norm);
```

Resolution order (on agent's `click(stable_id)` call):

1. Lookup `current_css` for `stable_id`. If element resolves and matches expected role/name → use it.
2. Else, fuzzy resolve: query by `role` + `name_norm` against live snapshot. If exactly one match → update `current_css`, increment `hit_count`, use it.
3. Else, fuzzy resolve relaxed: role-only match, then closest-match by Levenshtein on `name_norm`. If best candidate scores ≥ 0.7 normalized-similarity (configurable per session via `client.set_fuzzy_threshold()`) → use it.
4. Else, drift event: stable_id is dead, record `miss_count++`, return `{ok: false, reason: "element_not_found", candidates: [...]}` to agent.

**Similarity score** = `1 - levenshtein(a, b) / max(len(a), len(b))`. Default threshold `0.7` chosen for v0 as a conservative balance — high enough to reject obvious mismatches, low enough to tolerate minor copy edits ("Submit" → "Submit Application"). Customers tune per use case.

**Out of scope for v0:** cross-domain knowledge graph (the StableBrowse-marketed "knowledge graphs route around DOM drift" claim, generalized). Just per-domain caching. Cross-domain reasoning ships in v0.1.

### 5.2 Snapshot Compression

**Problem.** Raw DOM on a typical SPA has 3,000–10,000 nodes, most of which are layout `<div>` chains, decorative elements, hidden tabs, ad slots, and other noise. Sending this to an LLM eats tokens, dilutes attention, and changes shape on every cosmetic CSS tweak.

**Pipeline.**

1. **Start from the a11y tree, not the raw DOM.** Lightpanda's accessibility tree builder already prunes the DOM to the semantic-only view that screen readers see. We extend it.

2. **Keep only nodes that matter:**
   - Interactive (`button`, `link`, `textbox`, `combobox`, `checkbox`, `radio`, `slider`, `switch`, `menuitem`, `tab`, `option`, ...)
   - Landmarks (`main`, `navigation`, `search`, `form`, `region`, `dialog`, `banner`, `contentinfo`, `complementary`)
   - Headings (with level: `h1`–`h6`)
   - Text content (`role=text` nodes with non-empty content) — **preserved in full per user requirement**, not summarized
   - Media with alt text (images, video with descriptions)
   - Lists + listitems (preserve list structure as tree)

3. **Collapse single-child non-semantic chains.** `<div><div><div>X</div></div></div>` → just `X`. Preserves layout-only wrappers' parent-child relationship without emitting them.

4. **Emit short-key JSON-LD.** Each kept node:

   ```json
   {
     "i": "btn:abc123",       // 16-byte stable_id
     "r": "button",            // role
     "n": "Submit Application",// accessible name
     "t": null,                // raw text content (null for non-text nodes)
     "s": ["e", "v"],          // states: e=enabled, v=visible, c=checked, f=focused, ...
     "b": [432, 1240, 120, 40],// bounding rect [x,y,w,h] in viewport coords
     "c": [...]                // children (nested)
   }
   ```

   Text-content nodes:

   ```json
   { "r": "text", "t": "Albert Einstein (14 March 1879 – 18 April 1955) was a German-born theoretical physicist..." }
   ```

5. **Diff after first snapshot.** Mutation observer batches DOM changes per microtask, emits diffs as `{op: "added"|"removed"|"changed", path: "...", value: ...}`. Agents maintain their own page model by applying diffs to the last full snapshot. Agent can request a full re-sync at any time via `Snapshot.capture(full=true)`.

   > **v0 simplification (post-M2-spike).** Upstream lightpanda implements `MutationObserver` inside V8 (472 LOC, 9 tests) but does not wire mutation events to CDP. For **v0**, the orchestrator polls `Accessibility.getFullAXTree` after each agent action and computes the diff in TypeScript. v0.1 either contributes a small upstream patch (~50 lines) that emits CDP `Page.mutationRecorded` events, or wires the in-engine MutationObserver to CDP via an orchestrator-facing subscription. See [M2 DECISION.md](./../spikes/2026-05-14-m2-lightpanda-audit/DECISION.md).

6. **Brotli on the wire.** JSON-LD compresses extremely well with brotli (textual, repetitive structure). *(M2 spike PoC measured 89.1% compression on a small fixture page before brotli — see [SPIKE-REPORT §7](./../spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md).)*

**Text content mode.** Per the v0 design decision, full raw text content is preserved by default (not truncated, not summarized). Snapshots accept a `text_mode` parameter on `client.snapshot({text_mode: "full" | "labels-only" | "summarized"})`:

- `"full"` (default) — every text node included verbatim. Best for research / reading agents. Larger snapshots.
- `"labels-only"` — text included only for interactive elements' accessible names + headings; body paragraphs replaced with `{r:"text", t:null, len: N}`. Best for form-filling / navigation agents. ~10× smaller.
- `"summarized"` — body text truncated to first sentence per paragraph. *Compromise mode. Note: ships in v0.1, not v0, to keep v0 watchdog scope strictly deterministic with no in-engine NLP.*

**Expected sizes are page-shape-dependent.** Two representative cases:

*Wikipedia "Albert Einstein" article (text-heavy, ~25K words):*

| Representation | Size |
|---|---|
| Raw HTML | ~250 KB |
| Raw DOM (post-JS) | ~400 KB |
| Husk JSON-LD, `text_mode: "full"` | ~165 KB (text dominates) |
| Husk JSON-LD, `text_mode: "full"` + brotli | ~40 KB |
| Husk JSON-LD, `text_mode: "labels-only"` | ~6 KB |
| Husk JSON-LD, `text_mode: "labels-only"` + brotli | ~2 KB |

*Salesforce-style dashboard mock (interaction-heavy, ~50 interactive elements, ~5K text words):*

| Representation | Size |
|---|---|
| Raw DOM (post-JS) | ~600 KB |
| Husk JSON-LD, `text_mode: "full"` + brotli | ~8 KB |
| Husk JSON-LD, `text_mode: "labels-only"` + brotli | ~3 KB |

**Honest framing of the StableBrowse "70% reduction" claim:** for interaction-heavy pages (their target verticals — insurance forms, healthcare portals, dashboards), our compression matches or beats theirs comfortably. For text-heavy reading pages with full text preserved, the reduction is ~85% in `full` mode and ~99% in `labels-only` mode. Either is excellent; we expose the tradeoff explicitly rather than burying it in marketing.

### 5.3 Watchdog Rule Engine

**The v0 wedge.** Two layers. Both deterministic. No LLM. **Scope: Option D from the brainstorm — sanity + policy, no LLM intent validator.**

#### Layer 1 — Sanity rules (always on, hard-coded, ~5 ms overhead per action)

**Pre-action checks (in order, fail-fast):**

| Check | What | Failure mode |
|---|---|---|
| `exists` | `Snapshot.findById(stable_id)` returns non-null | `reason: "element_not_found"` |
| `visible` | opacity > 0, in viewport (or scrollable into view), not occluded by a modal | `reason: "element_not_visible"` |
| `enabled` | not `disabled`, not `aria-disabled="true"` | `reason: "element_disabled"` |
| `interactive` | role is compatible with the action verb (click → button/link/menuitem/checkbox/radio; type → textbox/combobox/searchbox) | `reason: "wrong_role_for_action"` |

**Post-action assertions (after dispatch, before returning to agent):**

| Check | What | Failure mode |
|---|---|---|
| `mutation_observed` | at least one DOM mutation event fired within 500 ms of action | `reason: "no_mutation_observed"` (warn, not hard fail) |
| `no_error_alert` | no new `[role=alert]` or new `[aria-live=assertive]` with negative content (matching `/error|failed|invalid|denied/i`) appeared | `reason: "error_alert_appeared"`, returned alongside `ok: true` so agent can react |
| `url_consistent` | for navigation actions URL changed as expected; for non-nav actions URL did not change unexpectedly | `reason: "unexpected_navigation"` |

**Result envelope:**

```json
{
  "ok": false,
  "reason": "element_not_found",
  "stable_id_attempted": "btn:submit-3",
  "candidates": [
    { "stable_id": "btn:submit-application", "role": "button", "name": "Submit Application", "score": 0.82 },
    { "stable_id": "btn:submit-quote",       "role": "button", "name": "Submit Quote",       "score": 0.71 }
  ],
  "snapshot_at_attempt": { ... }
}
```

The `candidates` array lets the agent's LLM immediately re-plan with concrete alternatives — *this is what makes watchdog rejection a feature rather than a wall*.

#### Layer 2 — Policy rules (opt-in per session, declarative YAML)

Customer loads a policy via `client.set_policy(yaml_string)` or `husk start --policy ./policy.yaml`. Schema in `protocol/policy.schema.json`. Example:

```yaml
flow: insurance_quote

forbidden:
  - role: button
    name_matches: "(?i)(delete account|remove account|close account)"
    severity: hard            # never executes
  - selector: "[data-action=delete]"
    severity: hard
  - role: textbox
    name_matches: "(?i)(ssn|social security|tax id|ein)"
    on: type
    severity: warn            # logs, requires explicit agent-side ack
    message: "Agent is typing into a sensitive identifier field. Confirm intent."

required_before:
  - action: submit_form
    prereq:
      - role: checkbox
        name_matches: "(?i)i agree|i accept"
        state: checked

allow_domains:
  - "*.state-farm.com"
  - "*.geico.com"
deny_domains:
  - "*"   # implicit catch-all, overridden by allow
```

The rule engine is a pure matcher. No fuzzy semantics, no LLM. Rules are evaluated in declaration order; `severity: hard` rules always win over `allow` rules.

#### Layer 3 — LLM intent validator (NOT in v0)

Second-pass LLM call: *"given the agent's stated goal X, is the proposed action Y consistent?"*. Adds ~500 ms latency and ~$0.001/call. Out of v0 to keep the v0 watchdog story strictly deterministic and demoable without LLM dependencies. Revisit when a paying customer specifically requests it.

### 5.4 Cookie Vault (M8a — shipped 2026-05-15)

Per-profile cookie persistence so sessions survive across `husk start` restarts. Foundation for M8b (login forms + TOTP) and M8c (SSO/OIDC + MFA).

**Storage:** per-profile SQLite at `~/.husk/vault/{profile}.db` (overridable via `HUSK_VAULT_DIR`). File mode 0600. Cookies stored in CDP `Network.Cookie` format verbatim. Optional AES-256-GCM at-rest encryption via `HUSK_VAULT_KEY` env (base64 32-byte key, scrypt-derived with fixed salt `husk-vault-v1`).

**Capture:** `Network.getAllCookies` polled on session close (best-effort). Lightpanda lacks `requestWillBeSentExtraInfo` events, so we can't intercept Set-Cookie in flight; close-time capture is sufficient for cookie-based SSO.

**Restoration:** on `Session.create({ profile })`, the orchestrator calls `Network.enable` + `Network.setCookies` before any user-initiated navigation.

**Profile concept:** free-form string, validated `^[A-Za-z0-9_.-]{1,64}$`. Default is no profile (cookies not persisted). Sessions without a profile get a clean jar every time.

**Threat model:** file mode 0600 protects against accidental disclosure (shared folders, backup uploads). `HUSK_VAULT_KEY` adds AES-GCM for at-rest attackers without process env access. NOT designed for adversaries with local read of the orchestrator process — that's M10 cloud's job.

**Known gaps (M8b/c territory):**
- `localStorage` / `sessionStorage` not persisted — lightpanda's Shed is in-memory only.
- IndexedDB absent in lightpanda upstream — Firebase Auth, AWS Amplify, Auth0 SPA SDK auth tokens will fail silently.
- Cookie partition keys (`Partitioned` attribute / CHIPS) silently ignored.
- Login form auto-fill, TOTP, OIDC redirect capture, SAML, MFA hooks — all M8b/c.

### 5.5 Login + TOTP (M8b — shipped 2026-05-15)

Builds on M8a's cookie vault. Adds credential storage and automated login.

**Credential storage:** per-profile SQLite at `~/.husk/credentials/{profile}.db` (overridable via `HUSK_CREDENTIALS_DIR`). File mode 0600. Encrypted with the same `HUSK_VAULT_KEY` as the cookie vault but with a different scrypt salt (`husk-credentials-v1`) — domain separation so a vault-key compromise doesn't trivially leak credentials. Schema: `(key, username, password, totp_secret)` with `password` and `totp_secret` AES-256-GCM encrypted when a key is set.

**TOTP:** RFC 6238 with HMAC-SHA1, 30-second period, 6-digit codes. Pure Node `crypto`. Verified against RFC test vectors (T=59 → 287082, T=1111111109 → 081804, T=1234567890 → 005924).

**Login form locator:** ARIA-first heuristics over the snapshot tree.
- Username: `textbox`/`combobox`/`searchbox` whose name matches `/user(name)?|e[\s-]?mail|login|account|handle|sign[\s-]?in/i`. Falls back to the first non-password visible textbox.
- Password: `textbox` whose name matches `/password/i`.
- Submit: `button` matching `/sign in|log in|submit/i`, fallback `/verify|continue|next|enter|proceed/i`. Disabled buttons de-prioritised.
- TOTP: `textbox` matching `/one[\s-]?time|2fa|two[\s-]?factor|authenticator|verification|tot[pj]|code/i`.

**Login flow:** `Session.login({username, password, totp_secret?})` —
1. Snapshot the current page.
2. Locate fields. If absent (or unreachable through CDP — see lightpanda caveat below), try the JS fallback.
3. Type username, password, optional TOTP. Watchdog rejections surface as `watchdog_rejected`.
4. Click submit; if URL doesn't change and the password field is still present, press Enter on the password field as a belt-and-suspenders fallback.
5. Re-snapshot. Success if URL changed OR password field is gone. Otherwise `login_did_not_advance`.

**Lightpanda CDP gaps discovered during M8b T11 integration:**
1. `<input type="password">` is assigned `role="none"` in lightpanda's AX tree, not `"textbox"` — so `locateLoginFields` cannot find password fields through the snapshot tree alone.
2. `DOM.focus { backendNodeId }` returns `-31998 UnknownMethod`.
3. Mouse click followed by `Input.dispatchKeyEvent {type: "char"}` does not update input values (focus succeeds, but char events don't write).
4. The only working mechanism in lightpanda is `Runtime.evaluate` with `element.value = "..."` + `form.submit()`.

**JS form fallback (watchdog caveat):** When `performLogin` returns `login_form_not_found`, `Session.login` falls back to `jsFormLogin` — a Runtime.evaluate-based path that fills fields by CSS selector and calls `form.submit()`. **The watchdog does NOT gate the JS fallback** because it bypasses the action primitives. This is a deliberate tradeoff for v0: without the fallback, login is impossible on lightpanda. v0.1+ should either (a) push an upstream patch to lightpanda's AX tree to surface password inputs, or (b) wrap the JS fallback in a watchdog "JS execution" policy gate.

**HTTP methods:**
- `credentials_set` / `credentials_remove` / `credentials_list` / `credentials_list_profiles`
- `login(session_id, profile, key)` — looks up credential by `(profile, key)` and invokes `Session.login`.

**SDKs (TS + Py):** `Husk.credentials.set/list/remove/listProfiles`; `Session.login({profile, key})`.

**MCP tools:** `husk_login`, `husk_credentials_set`. Other credential ops intentionally CLI-only (admin operations).

**CLI:** `husk login --profile <p> --key <k>` reads username/password/optional-totp-secret from stdin; `husk login --list --profile <p>` enumerates without passwords; `husk login --remove --profile <p> --key <k>`.

**Known gaps (M8c territory):**
- Two-page split flows (username on page 1, password on page 2) — not supported in v0. Most major auth providers do this (Google, Microsoft, Okta).
- SSO/OIDC redirect chains, SAML POST-binding.
- CAPTCHA — permanently out of scope.
- "Remember me" checkboxes — not toggled in v0.
- Account creation, password reset — login only.
- JS fallback ungated by watchdog (see caveat above).

### 5.6 Inherent Parallelism + Diff-by-Default (M9 — shipped 2026-05-15)

The agent never names a concurrency knob. The engine handles it.

**Engine pool.** At orchestrator startup, K=4 lightpanda processes are pre-spawned (configurable via `HUSK_POOL_MIN_WARM`). Under concurrent demand, the pool elastically scales up to `MAX_PARALLEL`, defaulting to `min(50, free_memory_MB / 30)` (one lightpanda ≈ 30MB resident). After 30s of idle, the pool shrinks back to K. `acquire()` waits when at capacity rather than failing.

**Eager snapshot in goto.** `Session.goto(url)` performs the navigation AND captures the AX-tree snapshot, caching it as `lastSnapshot`. The agent's next `husk_snapshot` call is a memory hit (<5ms), not a CDP round-trip.

**Snapshot freshness.** `Session.snapshot({maxAgeMs})` returns `lastSnapshot` if captured within the window (default 500ms). Pass `maxAgeMs: 0` (or `force: true` server-side) to force re-capture.

**Diff-by-default.** Every action method (`click`/`type`/`scroll`/`press_key`) returns its result with a `diff: {added, removed, changed}` field comparing the post-action snapshot against the pre-action one. Saves ~5KB per response vs returning a full new snapshot. Watchdog rejections do NOT include `diff` (the action never happened).

**On-demand diff.** `husk_snapshot_diff(session_id)` returns the diff between the current page state and the previous snapshot tracked in the session. Cheap "what changed" call for agent loops that need to react to async page updates.

**Why no batch tool.** Claude's native parallel tool use means N concurrent `husk_*` calls in a single turn fan out automatically through the pool. The architectural premise is "primitives the agent already knows + an engine that's parallel by construction" — not "a special batch method the agent must remember to use." Same simplicity as map-reduce being parallel without an explicit `map_parallel` primitive — the runtime does it.

**Performance contract (measured 2026-05-15):** 50-URL concurrent workflow — 3.9 seconds wall clock; per-URL avg 2.67s including 1.5s `goto` settle; throughput 12.8 URLs/sec. Pool warmup ~120ms. See `orchestrator/bench/parallel-bench.ts`.

### 5.7 Batch Primitive + Targeted Extract (M11 — shipped 2026-05-15)

M9 made individual operations fast via the engine pool. **In practice agents like Claude reason sequentially between tool calls, never returning 50 tool_use blocks in one response.** The pool's parallelism is wasted for batch workloads when the agent serializes calls itself.

M11 fixes this with two surfaces:

**`husk_extract(session_id, css)`** — Run `document.querySelector(css).textContent` via CDP `Runtime.evaluate`. Returns a string (trimmed) or null. ~100ms latency, ~200 bytes payload. Use after `husk_goto` when the agent knows the specific element it wants — much cheaper than `husk_snapshot` for targeted reads.

**`husk_batch_visit(urls, extract?)`** — Single tool call from the agent's POV. Internally fans out across the engine pool: one session per URL, all navigations + extractions happen in parallel via `Promise.all`. Returns an array preserving input URL order; per-URL errors are isolated (one bad URL doesn't break the rest). When `extract` is supplied, returns just the matched text per URL (~200 bytes each). Without `extract`, returns terse snapshots (see below).

**Terse snapshot mode.** A new `mode: 'terse'` option on `husk_snapshot` drops `navigation` / `banner` / `contentinfo` / `complementary` roles AND their subtrees from the output. Default in `batch_visit` when no `extract` is supplied. Default in `husk_snapshot` remains `'full'` for backward compatibility.

**Decision K (architectural exception).** Decision J (M9) said "no concurrency knobs on primitives." It still holds for `husk_goto/snapshot/click/etc.` — those stay as single-action verbs. `husk_batch_visit` is a NEW primitive with a DIFFERENT shape (a collection verb), not a concurrency knob added to an existing primitive.

**Caveat: client-side-rendered selectors.** The `extract` path uses `Runtime.evaluate` against the current DOM. Lightpanda renders most HTML but does NOT execute the full JS pipeline modern apps rely on for hydration. Selectors that match elements injected by client-side React/Vue/etc. (e.g. GitHub's `.f4.my-3` description div) won't be found via batch_visit + extract against lightpanda. For those targets, either use a server-rendered selector (e.g. `meta[name='description']`) or wait for the Chrome adapter (v0.1+).

**Performance contract (measured 2026-05-15):** 50-URL `batch_visit` with extract — ~2.5s wall clock, ~200 bytes per result row (when selectors match server-rendered HTML). 50-URL `batch_visit` without extract (terse snapshots) — ~4s wall clock, ~170KB per result (real-world repo pages). 50-URL `pool` baseline (full snapshot per URL) — ~2.7s wall clock, ~43KB per result.

---

### 5.8 Dynamic Workflow Primitives + Watch UI (M13 — shipped 2026-05-16)

#### Motivation

Through M11, Husk could navigate, snapshot, click/type/scroll, persist cookies, log in with TOTP, batch-visit, and extract single CSS selectors. To handle *any* workflow — dynamic-form job applications, multi-field captures, intent-routed actions, file uploads, page-readiness — five primitives were missing. M13 adds them while *reducing* MCP surface bloat through fold-in.

#### Surface change

Net **+2 MCP tools** (not +5 as originally scoped):
- `husk_wait_for` (new)
- `husk_upload` (new)
- `find()` folded into `click`/`type`/`scroll`/`upload` via `{intent}`
- `capture` folded into existing `husk_extract` via `{selectors}`
- `watch_url` folded into existing `husk_create_session` response

#### Primitives

**`husk_wait_for({session_id, ...condition, timeout_ms?})`** — Poll until one condition is true:
- `text: string` — substring match against any AX node name
- `role + name: string` — exact match (both required)
- `url_matches: string` — regex against current URL
- `network_idle: number` — N ms since last `performance.getEntriesByType("resource")` entry
- `selector_visible: string` — CSS selector with non-zero bbox + visibility:visible + display!=none

Default `timeout_ms = 10_000`. Poll interval 100ms. Returns `{ok, condition_met?, reason?, waited_ms, stable_id?}`. Throws on no-condition.

**Intent-routed actions** — `husk_click`/`husk_type`/`husk_scroll`/`husk_upload` now accept EITHER `{stable_id}` OR `{intent: "..."}`. Internal resolver is deterministic Jaro-Winkler + token-best composite over the AX tree; threshold 0.55; top-3 candidates. Ambiguity (top-2 within 0.05) returns watchdog-style envelope `{ok:false, reason:"ambiguous_intent", candidates}`. No-match: `reason:"no_match"`.

**`husk_upload({session_id, stable_id|intent, file_path | content_base64+filename})`** — Routes through M5 watchdog, then CDP `DOM.setFileInputFiles`. `filename` is `basename`-stripped to prevent traversal. Tempfile cleanup deferred (TODO M14: clean on session.close).

**Multi-selector `husk_extract({session_id, css | selectors})`** — `{selectors: {k: css}}` returns `{k: text|null}` in ONE `Runtime.evaluate` round-trip; each key wrapped in try/catch.

**Page-ready (no surface change)** — `goto` now resolves on `Page.loadEventFired` + 500ms network-idle (max-wait 8s), replacing the M9 fixed `setTimeout(1500)`.

#### Watch UI

When the orchestrator is bound to 127.0.0.1, three things happen:
1. `GET /watch` serves a single-file HTML viewer (~7KB; AX tree left, color-coded event log right; GitHub-dark aesthetic).
2. `GET /watch/stream/:session_id` opens an SSE stream of `{snapshot, action, rejection, navigation, find}` events.
3. `husk_create_session` returns `{session_id, watch_url}`. Agents proactively offer the URL with prompts like "want to watch what I'm seeing?".

When bound to `0.0.0.0` (or anything non-localhost), `/watch` and `/watch/stream/*` are NOT registered, and `watch_url` is `null`. Defense in depth: no remote attack surface.

#### Decisions

**Decision L — Watch UI is local-only by design.** No token auth, no remote bind. Rationale: the only safe demoable surface is one that lives on the developer's loopback. Anything else needs auth, which dramatically complicates the "want to watch what I'm seeing?" flow.

**Decision M — `find()` is deterministic-only.** No LLM in the resolver path. Husk's LLM-neutrality is load-bearing for AGPL+MIT licensing and for sub-millisecond latency. Plug-in semantic resolvers are an opt-in escape hatch for M14+, not a default.

**Decision N — Tool-surface fold-in rule.** New capability adds a new MCP tool only when the verb is genuinely distinct (`wait_for`, `upload`). Capability variants of existing verbs (intent vs stable_id, single vs multi-selector, watch-url discovery) MUST fold into the existing tool's parameter space. This rule prevents AI-agent decision fatigue at the tool-choice layer.

#### Limitations

- Lightpanda does not implement CDP `DOM.setFileInputFiles` (returns `-31998: UnknownMethod`). The unit tests verify the orchestrator's CDP-call shape; the integration test detects and logs the gap rather than failing. M12 (Chrome adapter) resolves this.
- Lightpanda's AX tree does not promote `textContent` changes without `aria-label` updates. Workflows requiring dynamic content matching via `wait_for(text)` should target elements with stable `aria-label`s, or use `selector_visible` instead.
- Tempfiles from `husk_upload` base64 mode are not auto-cleaned. macOS does not sweep `/tmp` on reboot. M14 backlog: clean on session.close.

---

### 5.9 Snapshot Maximalism + AI-First Ergonomics (M14 — shipped 2026-05-17)

#### Motivation

Through M13, an agent's typical workflow was `goto → snapshot → click → snapshot → extract` (5 turns). Every turn costs an LLM round-trip plus context bytes. M14 reduces this to `goto → click → extract` (3 turns) by making `husk_snapshot` a universal context dump and folding the post-action snapshot into every action result.

M14 also adds the two missing loop primitives — `scroll-until` and `extract.paginate` — that turn 10-turn polling loops into 1 tool call.

**Zero new MCP tools.** All 14 capabilities fold into existing verbs.

#### Snapshot envelope (the universal context dump)

`husk_snapshot` returns:

| Field | Source | Why |
|---|---|---|
| `root, url, mode` | existing (M1+) | The AX tree itself |
| `signature: {dom_hash, network_fingerprint, url}` | T1 | Lets agent detect "I'm back where I was" |
| `meta: {title, canonical, og[], jsonld[]}` | T4 | Structured data already on every site |
| `forms: [{fields[], submit_text, action, method}]` | T5 | Fill any form in 1 turn |
| `network: {recent[], likely_api_endpoints[]}` | T2 + T10 | Discover the JSON API behind the UI |
| `console: [{level, text, ts}]` | T3 | Free debugging |
| `summary: string` | T7 | Rule-based: "Login page — fields: email, password" |
| `session_history: [last 10 actions]` | T9 | Agent stops re-tracking its own state |
| `image_b64` | T8 | Optional via `include_image:true` |

New mode: `mode: "visible"` filters to nodes whose bbox intersects the current viewport — 60-80% token reduction on long pages.

#### Action results carry post-action snapshot

`husk_click`/`husk_type`/`husk_scroll`/`husk_press_key`/`husk_upload`/`husk_goto`/`husk_login` all return `{ok, diff, snapshot, ...}` by default. The snapshot is cached (M9 freshness window), so it costs ~nothing. Agents stop calling `husk_snapshot` after every action.

Opt out via `include_snapshot: false`.

#### Find ergonomics

`find()` candidates now carry `viewport: {x, y, region}` (e.g., `region: "top-left"`) so agents disambiguate by visual location. Per-node reliability scoring (M4 cache `success_count`/`failure_count`) weights ranking — selectors that historically worked stay reliable; flaky ones decay.

#### Loop primitives

**`husk_scroll({until: <predicate>})`** — same predicate as `husk_wait_for`. Replaces "scroll, snapshot, check, repeat" loops.

**`husk_extract({css|selectors, paginate: {next, max_pages, stop_when?}})`** — extracts across N pages with click-next loop. Returns `{pages, total_pages, stopped_reason}`.

#### Decisions

**Decision O — Snapshot Maximalism.** `husk_snapshot` is the agent's universal context dump. New observability folds into the snapshot envelope. New MCP tools require a genuinely distinct verb (per Decision N).

**Decision P — Post-action context is the default.** Every action returns its post-state. Opt-out is explicit. Eliminates the click→snapshot anti-pattern.

**Decision Q — Loop primitives over loop tools.** Instead of `husk_paginate` and `husk_scroll_until` as new tools, the loop semantic is a parameter on the existing verb. Single-source-of-truth for the verb; agents never wonder which scroll tool to pick.

#### MCP surface

**18 tools, unchanged from M13.**

---

### 5.10 Multi-Context + Human-in-the-Loop (M15 — shipped 2026-05-19)

#### Motivation

Through M14, agents could read a rich snapshot, drive any action, and return results in 3 turns instead of 5. But three big gaps remained: (a) only one tab per session (no comparison shopping, no multi-account), (b) no way to ask the human a question when ambiguous, (c) no clean handoff for things only a human can solve (captchas, 2FA, OAuth consent, KYC, payment confirmation, identity verification, etc.).

M15 closes all three with **+3 new MCP tools**: `husk_ask_human`, `husk_handoff`, `husk_resume`. Multi-tab folds into existing `husk_create_session`. Dialog auto-handling and Shadow DOM piercing fold into snapshot.

**Surface goes 18 → 21.** Per Decision N, the three new tools earn their slots because each represents a genuinely distinct verb (wait-for-human-input is not click/type; pause-the-session is not click/type; resume-on-behalf-of-human is the chat-side mirror of a Watch UI button — needed so the agent can resolve from chat-side).

#### Multi-tab

`husk_create_session({parent_session_id})` creates a sibling session that shares the parent's cookie profile. Each `husk_snapshot` includes `sibling_sessions: string[]` so the agent never needs a `husk_list_tabs` tool. Closing the root tears down the entire group; closing a child only closes that child.

**Cookie sharing across siblings** requires an explicit `profile` on the parent (M8a cookie vault). Without a profile, siblings are sandboxed by the engine.

#### Dialog handling

`alert()` / `confirm()` / `prompt()` / `beforeunload` previously deadlocked the page. M15 auto-dismisses any dialog after 100ms. Agents can opt into manual handling via the `dialog` JSON-RPC method (not in MCP surface — rare). `snapshot.dialog` surfaces pending dialogs.

#### Shadow DOM piercing

Web Components (Stripe Checkout, design systems) hid their content from the AX tree. M15 walks shadow roots on `generic`/`Unknown`/`none` AX nodes via CDP `DOM.describeNode` + `Accessibility.getPartialAXTree`. Engine-dependent; degrades gracefully on engines without these CDP calls.

#### `husk_ask_human` — non-blocking, dual-surface

Agent calls `husk_ask_human({question, options?, timeout_ms?})`. Returns IMMEDIATELY with `{pending, token, watch_url, surface: {question, options?}}`.

Two surfaces to answer from, whichever the user reaches first:
- **Watch UI**: clicks an option button (or types into a textarea). POSTs to `/ask/:token/answer`. Bus resolves; Watch UI updates.
- **Agent chat**: user types reply directly in the chat client (Claude Desktop, etc.). The LLM hears the answer and proceeds; optionally calls `husk_resume({token, answer})` to log it in `session_history`.

#### `husk_handoff` — non-blocking pause for ANY human task

Agent calls `husk_handoff({reason, suggested_action?, need_cookies_back?, timeout_ms?})`. The session pauses immediately; any subsequent action call returns `{ok: false, reason: "session_paused", token, handoff_url}` until resumed. The method returns `{pending, token, handoff_url, surface: {reason, suggested_action?, current_url?}}`.

**Use cases**: captcha, 2FA email/SMS, OAuth consent, account verification, KYC/identity check, connecting external accounts (Plaid/Stripe/Google), payment confirmation, destructive-action approval, unrecoverable engine error. Not just captcha — anywhere a human is the only path forward.

**Handoff page** at `/handoff/:token` is a dark-themed single-file HTML viewer that:
- Shows the reason + suggested action
- Provides a clickable link to `current_url` (opens in a new tab)
- Offers three cookie-capture options:
  1. **Bookmarklet**: drag to bookmarks, click on the target domain after solving
  2. **Devtools paste**: textarea accepting `name=value` lines or full `document.cookie`
  3. **No cookies**: "Resume agent" button without any transfer

**Cookie roundtrip**: when the user POSTs cookies (any of the three modes), `Session.importCookies` calls CDP `Network.setCookies` to install them into the lightpanda session. Engine-dependent — gracefully degrades if `Network.setCookies` isn't implemented.

#### `husk_resume` — agent-side resume entry

Mirror of the Watch UI's Resume button, but callable from the agent. When the user completes a handoff or answers a question **in chat**, the agent calls `husk_resume({token, answer?, index?, cookies?, note?})`. Auto-routes to whichever bus has the token (question or handoff). Unknown tokens return `{ok: false, reason: "unknown_token"}`.

Same backend as `/ask/:token/answer` and `/handoff/:token/resume` — whichever surface fires first wins; the other observes a `resolved` SSE event and clears its banner.

#### Watch UI v2

Builds on M13's `/watch` viewer. New components:
- **Sibling tab chips** in the header — clickable, switches the viewer to that session
- **Status badge** now has multiple states: `live` (green), `paused (handoff)` (warn), `needs answer (question)` (accent), `disconnected` (red)
- **Question banner** — full-width, accent-colored, with option buttons or textarea + send button
- **Handoff banner** — full-width, warn-colored, with link to handoff page

Same dark / monospace aesthetic. Self-contained HTML (~12 KB), no external assets.

#### Decisions

**Decision R — HITL is local-only.** Both `/ask/:token/answer` and `/handoff/:token/resume` are gated by `host === "127.0.0.1"`, matching the Watch UI policy. No remote attack surface. If the orchestrator is bound to `0.0.0.0`, watch_url and handoff_url are `null` — agents see this and skip the Watch-UI offer.

**Decision S — Tab groups share cookies, never JS/DOM state.** Each session is an independent engine process. Tabs in a group are semantically siblings (like browser tabs on the same domain) but DOM/JS state is per-tab. Sharing is via the M8a cookie vault profile.

**Decision T — Both-surface answer/resume is the rule.** Every HITL primitive (`ask_human`, `handoff`) accepts resolution from EITHER the chat surface (via `husk_resume`) OR the Watch UI surface (via POST). Both paths converge on the same internal bus method. Whichever fires first wins.

#### MCP surface

**21 tools, +3 from M14**: `husk_ask_human`, `husk_handoff`, `husk_resume`. All other M15 capabilities fold into existing verbs:
- Multi-tab: `husk_create_session({parent_session_id})`
- Dialog: snapshot.dialog field (JSON-RPC `dialog` method exists, not in MCP)
- Shadow DOM: snapshot AX tree (silent enrichment)
- Sibling tabs: snapshot.sibling_sessions field

#### Limitations

- Lightpanda may not implement `Page.javascriptDialogOpening`, `DOM.describeNode` shadowRoots, or `Network.setCookies`. All three degrade gracefully. The Chrome adapter (v0.3) will close these gaps.
- Cookie sharing across siblings requires explicit `profile` on parent. Default behavior is sandboxed per-session.
- `husk_resume` is global (not per-session) — tokens are UUIDs and identify the session implicitly via the bus.

---

## 6. Developer Experience — How Agents Access Husk

Four interfaces. All v0. All routed through the same JSON-RPC orchestrator.

### Interface 1 — Direct SDK

Foundation of the others. Used by developers writing explicit agent loops.

**Python:**

```python
from husk import Husk

async with Husk(base_url="http://localhost:7777") as h:
    session = await h.create_session()
    await session.goto("https://en.wikipedia.org/wiki/Albert_Einstein")

    snap = await session.snapshot()
    # snap.nodes : flat list of {id, role, name, text, state, rect}
    # snap.tree  : nested form for layout reasoning
    # snap.find(role=..., name_matches=...) : semantic query

    edit_btn = snap.find(role="link", name_matches=r"Edit")
    result = await session.click(stable_id=edit_btn.id)

    if not result.ok:
        # watchdog rejected — agent can re-plan
        print(result.reason, result.candidates)
    else:
        await session.type(stable_id="txt:search", text="Quantum")
        await session.press(key="Enter")
        await session.wait_for(text="Quantum mechanics")
```

**TypeScript** (canonical):

```ts
import { Husk } from "@husk/sdk";

const h = new Husk({ baseUrl: "http://localhost:7777" });
const session = await h.createSession();
await session.goto("https://en.wikipedia.org/wiki/Albert_Einstein");
const snap = await session.snapshot();
const editBtn = snap.find({ role: "link", nameMatches: /Edit/ });
const result = await session.click({ stableId: editBtn.id });
```

Both SDKs are **zero-LLM-dependency** — they do not import OpenAI or Anthropic. LLM choice is the customer's; we just provide the browser primitives.

### Interface 2 — LLM tool-calling manifests

Generated from the JSON-RPC schema. Published in three formats:

- `husk-tools.openai.json` — OpenAI function-calling format
- `husk-tools.anthropic.json` — Anthropic tools schema
- `husk-tools.schema.json` — generic JSON Schema (for everything else)

Tools surface:

| Tool | Purpose |
|---|---|
| `husk_create_session` | Returns `session_id` |
| `husk_goto` | Navigate to URL |
| `husk_snapshot` | Return compressed page state — the LLM reads this to decide what to do next |
| `husk_click` | Click element by `stable_id` |
| `husk_type` | Type into element by `stable_id` |
| `husk_press` | Press a keyboard key |
| `husk_wait_for` | Wait for text / element / URL pattern |
| `husk_close_session` | Tear down |

Husk never knows which LLM is calling. Browser primitives only.

### Interface 3 — MCP server

Shipped as `@husk/mcp`. Bridges MCP protocol to Husk JSON-RPC. Users of Claude Desktop, Cursor, Continue, Windsurf, etc., add one config line:

```json
{
  "mcpServers": {
    "husk": { "command": "npx", "args": ["-y", "@husk/mcp"] }
  }
}
```

The MCP server spawns a local orchestrator + engine on first use. Free distribution channel — every MCP-aware client gains Husk capability with one line of config.

### Interface 4 — CLI

```sh
# Install
npm i -g husk
# or: brew install husk
# or: pip install husk-sdk[cli]

# Start the orchestrator on :7777
husk start

# Run a packaged example (LLM-neutral — examples bring their own LLM client)
husk run examples/01-wikipedia-research

# Inspect a live session (streams snapshot deltas + watchdog events)
husk inspect <session_id>

# Optional: one-shot eval (requires user-provided LLM API key in env)
# Bundled in a separate package `@husk/cli-eval` to preserve core LLM-neutrality.
ANTHROPIC_API_KEY=sk-... husk eval \
  --goal "summarize https://en.wikipedia.org/wiki/Albert_Einstein" \
  --llm anthropic:claude-sonnet-4-5
```

**LLM-neutrality stance:** the core `husk` CLI, the SDK, and the orchestrator have zero LLM dependencies. `husk eval` is a thin convenience wrapper packaged separately (`@husk/cli-eval`), supports any provider, and requires a user-provided API key. Installing core Husk never installs an LLM SDK. This decoupling is what stops Husk from becoming "another browser-use."

All four interfaces converge on the same orchestrator. No interface gets a special code path. The HTTP/JSON-RPC layer at the orchestrator is the single source of truth.

---

## 7. Repository Layout

```
husk/                                # monorepo root
├── engine/                          # Zig — fork of lightpanda
│   ├── upstream/                    # git submodule, pinned to a lightpanda commit
│   ├── patches/
│   │   ├── snapshot-domain.zig
│   │   ├── semantic-id-domain.zig
│   │   ├── mutation-observer.zig
│   │   └── a11y-tree-hooks.zig
│   ├── tests/
│   ├── build.zig
│   └── UPSTREAM_LICENSE             # lightpanda AGPL v3, preserved
├── orchestrator/                    # TypeScript — Node binary
│   ├── src/
│   │   ├── http/                    # Hono HTTP server, JSON-RPC endpoints
│   │   ├── session/                 # engine subprocess pool, lifecycle
│   │   ├── cdp/                     # CDP client (ws + JSON-RPC)
│   │   ├── snapshot/                # decoder, diff applier, find() impl
│   │   ├── stable-id/               # site graph cache, fuzzy resolver
│   │   ├── watchdog/                # sanity + policy rule engines
│   │   ├── action/                  # intent → CDP ops translator
│   │   ├── telemetry/               # structured logs, replay capture
│   │   └── index.ts                 # CLI entrypoint
│   ├── tests/
│   └── package.json
├── sdk-ts/                          # TypeScript SDK (npm @husk/sdk)
│   ├── src/
│   ├── tests/
│   └── package.json
├── sdk-py/                          # Python SDK (PyPI husk-sdk)
│   ├── husk/
│   ├── tests/
│   └── pyproject.toml
├── mcp/                             # MCP bridge (npm @husk/mcp)
│   ├── src/
│   └── package.json
├── protocol/                        # SINGLE SOURCE OF TRUTH
│   ├── jsonrpc.openapi.yaml         # public protocol (agent ↔ orchestrator)
│   ├── snapshot.schema.json         # JSON-LD snapshot shape
│   ├── policy.schema.json           # watchdog policy YAML schema
│   └── tools-manifest/
│       ├── openai.json              # generated
│       ├── anthropic.json           # generated
│       └── jsonschema.json          # generated
├── examples/
│   ├── 01-wikipedia-research/
│   ├── 02-static-form-fill/
│   └── 03-shopify-pricecheck/
├── docs/
│   ├── superpowers/specs/2026-05-13-husk-design.md   # this file
│   ├── quickstart.md
│   ├── architecture.md
│   ├── policy-rules.md
│   └── mcp-setup.md
├── .github/workflows/
│   ├── ci.yml                       # build + test all packages
│   ├── release.yml                  # tag → npm + PyPI + binary releases
│   └── engine-build.yml             # cross-compile engine for macOS arm64/x64, Linux x64
├── Makefile                         # `make engine`, `make orchestrator`, `make sdks`, `make all`
├── pnpm-workspace.yaml
├── LICENSE                          # AGPL v3
├── LICENSE-EXAMPLES                 # MIT (covers /examples and /protocol)
├── CLA.md                           # contributor license agreement text
├── CONTRIBUTING.md
└── README.md
```

**Why monorepo:** the `protocol/` folder is the contract between SDKs, orchestrator, and engine. If it lives in one repo, schema refactors stay atomic and CI catches drift across all consumers. The cost (slightly heavier clone) is acceptable for v0; sub-packages can split out later if they gain independent traction.

**Build orchestration:** root `Makefile` with composable targets. CI runs `make all` plus per-package tests on every PR.

---

## 8. License & Legal

### Core: AGPL v3

All Husk-written code under AGPL v3. This:

- **Protects against SaaS rebranding.** If AWS/Cloudflare/a competitor forks Husk and hosts it as a service, AGPL forces them to publish their service modifications under AGPL too. They either contribute back or buy a commercial license from us.
- **Permits proprietary agents to use Husk.** Customers' agent code that calls Husk over our HTTP API is *not* a derivative work (the network boundary is the standard delineator). They keep their agent code proprietary.
- **Matches peer projects.** Skyvern (closest neighbor) and Posthog/Plausible (proven OSS-startup playbook) all use AGPL v3.

### Examples + protocol schemas: MIT

`/examples/` and `/protocol/` ship under MIT, so:

- Customers can copy-paste example agent code into their proprietary codebases without contaminating it.
- Other tools can implement the Husk protocol without taking on AGPL obligations.

### Lightpanda upstream: AGPL v3, aligned

Lightpanda is AGPL v3-licensed (per their [`LICENSING.md`](https://github.com/lightpanda-io/browser/blob/main/LICENSING.md)). This is the same license we chose for Husk's core, so the upstream/fork relationship is license-aligned by default — no compatibility analysis or relicensing dance required.

- `engine/UPSTREAM_LICENSE` contains lightpanda's full LICENSE text (AGPL v3).
- Non-differentiating fixes (bug fixes, perf improvements unrelated to our pillars) are contributed back upstream as AGPL v3 PRs.
- Our additive patches (`Snapshot` domain, `SemanticId` domain, mutation observer aggregator, a11y tree hooks) live in `engine/patches/` and are AGPL v3 under Husk's copyright (assigned via our CLA).

**Implication for dual-licensing strategy:** the orchestrator, SDKs, MCP bridge, protocol schemas, and examples are all under our CLA and remain dual-licensable later if needed (e.g., for an enterprise commercial license). The engine layer is AGPL by virtue of upstream's license; dual-licensing the engine itself would require coordination with lightpanda upstream (or replacing the engine, which is what the v2.0 hybrid-engine milestone with stripped Chromium would enable). For v0–v0.3, this is not a constraint — the planned cloud-hosted Husk business model assumes AGPL throughout.

### CLA

Every external contributor signs a Contributor License Agreement (`CLA.md`) assigning copyright of their contribution to the Husk project entity. This lets us:

- Dual-license to enterprises later (revenue line for the eventual managed-cloud business).
- Migrate licenses cleanly if AGPL ever becomes commercially untenable.
- Defend the project's IP centrally.

CLA flow uses [CLA Assistant](https://cla-assistant.io/) integrated with GitHub PRs.

### Trademark

The Husk name and logo are trademarks of the Husk project entity, registered separately. Code is OSS; the brand is exclusive. Forks must rename (per AGPL norm + trademark policy).

---

## 9. Dependencies

| Package | Component | License | Version | Rationale |
|---|---|---|---|---|
| `lightpanda` (prebuilt binary, v0) | engine | AGPL v3 | release 0.3.0+ | **v0 consumes prebuilt; built from `engine/upstream` only when needed.** *(Added post-M2-spike.)* |
| `lightpanda` (forked submodule, v0.1+) | engine | AGPL v3 | pinned commit | Foundation for engine patches in v0.1+ |
| V8 | engine (via lightpanda) | BSD | bundled | JS execution |
| `blake3` (Zig) | engine | Apache 2.0 / MIT | latest stable | Stable-ID hashing |
| Node.js | orchestrator | MIT | ≥ 20 LTS | Runtime |
| `hono` | orchestrator | MIT | ^4 | HTTP server — small, fast, edge-portable later |
| `better-sqlite3` | orchestrator | MIT | ^11 | Site graph cache, synchronous (fits our use) |
| `ws` | orchestrator | MIT | ^8 | CDP WebSocket client |
| `zod` | orchestrator + SDK-TS | MIT | ^3 | Schema validation across the protocol boundary |
| `pino` | orchestrator | MIT | ^9 | Structured logging |
| `yaml` | orchestrator | ISC | ^2 | Policy file parsing |
| (none) | SDK-TS | — | — | Stay zero-dependency (fetch + zod from peer) |
| `httpx` | SDK-Py | BSD | ^0.27 | Async HTTP client |
| `pydantic` | SDK-Py | MIT | ^2 | Schema validation, generated models |
| `@modelcontextprotocol/sdk` | MCP bridge | MIT | latest | MCP server framework |

**Deliberately not depending on:**

- Playwright, Puppeteer, playwright-core — we don't wrap them; we replace the layer they wrap.
- Any LLM SDK (OpenAI, Anthropic, etc.) — Husk is LLM-neutral.
- `undici` with custom CA bundles — anti-bot/stealth is out of scope.

---

## 10. Roadmap & Milestones

### v0 — week-by-week (6–8 weeks, single engineer)

| Week | Milestone | Done when |
|---|---|---|
| **1** | Foundation | Monorepo scaffolded (pnpm + Zig). Lightpanda forked, builds locally with no patches. CI runs build + lint on every PR. `LICENSE`, `LICENSE-EXAMPLES`, `CLA.md`, `CONTRIBUTING.md`, `README.md` drafted. Husk name + domain registered. |
| **2** | Engine patches | `Snapshot` CDP domain emits a11y tree as JSON-LD. `SemanticId` CDP domain computes stable IDs on every DOM commit. Mutation-observer aggregator batches and emits diffs. Engine builds, passes lightpanda's upstream test suite + 3 Husk-added tests. |
| **3** | Orchestrator skeleton | Hono HTTP server up on `:7777`. Session manager spawns engine subprocesses with WS CDP connection. JSON-RPC endpoints `create_session`, `goto`, `snapshot`, `act`, `close_session` work. Structured logs via pino. |
| **4** | Snapshot + Site graph | Snapshots decoded, diffs applied. Stable-ID compute mirrored in orchestrator for verification. SQLite site graph cache. Fuzzy resolver fallback when cached selector fails. Replay log captures full session. |
| **5** | Watchdog + Action planner | Sanity rule layer (4 pre-checks, 3 post-checks). Policy rule engine loads YAML, matches against snapshot, hard-rejects forbidden actions. Action planner maps intents to CDP `Input` ops. End-to-end smoke: `click("btn:submit")` flows through watchdog and engine cleanly. |
| **6** | SDKs + Examples + Docs | TS SDK published to npm as `@husk/sdk`. Python SDK published to PyPI as `husk-sdk`. Three examples working. Quickstart docs. README with 10-second GIF per example. MCP bridge package working. |
| **7–8** | Buffer / polish / launch | Bug fixes from running examples. GitHub Releases pipeline (binary releases per platform). Show HN draft, ProductHunt assets, Twitter/dev.to launch posts. Launch day = end of week 8. |

### v0 success criteria (objective gates)

- All 3 examples run end-to-end on a fresh clone within 5 minutes (clone → install → run).
- Watchdog correctness: in a synthetic test where the agent attempts to click 100 hallucinated `stable_id`s, 100 / 100 rejected.
- Snapshot compression: measured on Wikipedia's "Albert Einstein" article — ≤ 10 KB compressed JSON-LD vs ~400 KB raw DOM (≥ 97 % reduction).
- Stable-ID resilience: synthetic test that randomizes all CSS class names — the 20 interactive elements on the test page still resolve to their original stable_ids via fuzzy fallback.
- Cold start: session creation (engine boot + first navigation) under 1.5 seconds for `example.com`.
- All four interfaces (SDK, tool manifest, MCP, CLI) functionally tested end-to-end.

If any gate fails, v0 does not ship; the timeline extends until it passes.

### Post-v0 sequencing (committed — refined at each milestone)

> **Sequencing change 2026-05-15:** The original spec listed v0.1 as DOM-drift router and v0.2 as auth pillar. After M3 we promoted **auth to M8 (right after M7 launch)** because every interesting real-world workflow stops at the login page without it. DOM-drift router moves from v0.1 to M9. The numbering renames v0.1 → M9 and so on, but each milestone's *theme* is unchanged. Auth is now the *first* post-launch capability rather than the second.

| Milestone | Theme | Approx. duration | Capability after this milestone |
|---|---|---|---|
| **M8** *(was v0.2)* | **Auth pillar** — cookie vault, TOTP, SSO/SAML/OIDC redirect chaining, per-site session graphs, human-in-the-loop hooks for SMS/push MFA. **First post-M7 milestone.** | 6–8 weeks | Agents can log into ~85% of websites. Tier 1 + login-gated flows. |
| **M9** *(was v0.1)* | **DOM-drift router** — cross-deploy semantic-ID resolution, self-healing selectors, replay-based regression tests for site graphs | 6–8 weeks | Sites can redesign without breaking your agents. |
| **M10** *(was v0.3)* | **Husk Cloud (open core)** — managed runtime on Fly.io/Modal, API keys, billing, multi-tenancy, observability dashboard | 8–10 weeks | Hosted SaaS — revenue model active. |
| **M11** *(was v1.0)* | **Pre-indexing pipeline + vertical playbooks** — offline crawler builds site graphs for top sites, vertical recipes for insurance / mortgage / prior auth / shopping | 12 weeks | Healthcare/insurance/mortgage parity with StableBrowse-class products. |
| **M12** *(was v2.0, aspirational, needs team)* | **Hybrid engine** — stripped Chromium fork for high-compat sites; runtime routes by site complexity (lightpanda for simple, stripped Chromium for complex) | 6 months | Gmail / Salesforce / Workday / Microsoft 365 / modern-SPA compat. Tier 3 unlocked. |

**Capability tiers reachable at each milestone:**

| Tier | Examples | Reached at |
|---|---|---|
| **1** — Most of the web (read, click, type, navigate, search) | Wikipedia, blogs, docs, simple forms, search engines, basic SaaS | M7 launch |
| **1.5** — Tier 1 + login-gated | ~85% of useful websites — banking, payer portals (Aetna etc.), gov sites, healthcare scheduling, mortgage applications, normal e-commerce checkouts | **M8 (auth)** |
| **2** — Polished vertical playbooks | Healthcare prior-auth, insurance broker flows, mortgage applications, structured purchasing flows with high reliability | **M11 (recipes)** |
| **3** — Modern complex SPAs | Gmail, Google Docs, Salesforce, Workday, LinkedIn, Slack web, Discord web, modern Shopify | **M12 (hybrid engine)** |
| **4** — Permanently out of scope | CAPTCHA-protected sites, Cloudflare bot fight mode, WebAuthn-only MFA (hardware keys), DRM video, WebRTC calls, heavy WebAssembly | Never (industry-wide unsolved; not a Husk-specific gap) |

**Time to "agents can do real workflows on real websites" (Tier 1.5):** M7 launch + M8 auth = ~12-14 weeks from M3.
**Time to "match StableBrowse-class vertical demos" (Tier 2):** + M11 = ~9 months from M3.
**Time to "do everything a human does on the typical web" (Tier 1+2+3):** ~12-15 months from M3.

### Permanently out of scope

- Anti-bot bypass / Cloudflare challenge solving / TLS-fingerprint stealth — legal and ethical rabbit hole; if customers need this, they self-host with their own bypass layer
- WebRTC / WebGL / WebAssembly support — until lightpanda upstream adds them or an external contributor delivers them to our fork
- Closed-source proprietary integrations — everything stays AGPL or relicensable via CLA

---

## 11. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | ~~Lightpanda's a11y tree builder is too incomplete to base stable-ID computation on.~~ **RESOLVED by M2 spike.** | ~~Medium~~ | ~~High~~ | **Resolved 2026-05-14 — see [M2 DECISION.md](./../spikes/2026-05-14-m2-lightpanda-audit/DECISION.md).** Outcome: Path A — upstream is rich enough. `AXNode.getName()` ships full WAI-ARIA accessible-name computation; `Accessibility.getFullAXTree` exposes the tree via standard CDP. v0 ships orchestrator-side adapter (~80 LOC TypeScript) with zero engine patches. Landmark-path tracking deferred to v0.1. |
| 2 | Zig learning curve discourages external contributors; PR throughput stays low | High | Medium | Keep the engine surface intentionally small (4 patch files). Document engine-level extension points thoroughly. Most PRs land on the TS orchestrator side, where contributor familiarity is high. |
| 3 | AGPL deters some adopters (solo devs spooked by license; enterprises with policy bans) | Medium | Medium | Clear FAQ: agent code that calls Husk over HTTP is not a derivative work; only redistribution-as-service triggers AGPL. Offer commercial license for enterprises with hard AGPL policy. |
| 4 | Web compat gaps surface during example development — Shopify breaks, complex JS apps don't load | High | High | Pick conservative example URLs (specific pinned pages we've validated). Document supported sites narrowly. Add a "compat status" page in docs tracking known-good and known-broken sites. |
| 5 | Competitive surprise: Browserbase, StableBrowse, or someone announces an OSS engine fork during our 6–8 week build | Low | High | Ship in 6–8 weeks, not 6 months. Don't preview publicly until launch day. Maintain a draft Show HN post from week 4 so launch is one-click ready. |
| 6 | Lightpanda upstream pivots or stagnates, leaving our fork unmaintained | Low | Medium | Hard-fork option always available (we'd then own engine maintenance). Contribute back useful patches to keep upstream healthy. |
| 7 | Watchdog false positives frustrate early users | Medium | Medium | Detailed reasons + candidates in every rejection envelope. `husk inspect` streams watchdog events live. Configurable strictness levels in v0.1. |

---

## 12. Open Questions

Items deferred to implementation or revisit:

- **Engine subprocess pool strategy.** Cold-spawn per session is simple and isolated; pre-warmed pool is faster. v0 picks cold-spawn; revisit if cold-start gate (1.5 s) is missed.
- **Site graph storage path.** `~/.husk/site-graph/{domain}.db` is the default. Multi-user / multi-project scenarios may need explicit path. Acceptable to defer.
- **Authentication on the orchestrator HTTP API.** v0 binds to `127.0.0.1` only, no auth tokens. Cloud milestone (v0.3) introduces API keys.
- **Telemetry opt-in.** Anonymous usage stats (engine version, OS, session count, error categories) would help product decisions, but defaulting to opt-in is the OSS-friendly stance. Decision deferred.
- **Replay log format and retention.** v0 captures structured logs to `husk-replay-{session_id}.jsonl`. Format and retention policy formalized in v0.1.
- **Test fixture corpus for examples.** We need stable test sites for CI. Either host a synthetic test site under `examples/test-site/` (served by Husk's own test harness) or pin to specific Wikipedia revisions. Decision in implementation plan.
- **Default `text_mode` for snapshots.** v0 defaults to `"full"` per the explicit user requirement. Open question for v0.1: should research-class agents and form-filling-class agents have different default presets (e.g., a `--preset` flag at session creation that sets `text_mode` + watchdog strictness together)?

---

## 13. Appendix: Glossary

| Term | Definition |
|---|---|
| **Husk** | This project. Open-source browser engine for AI agents, forked from lightpanda. |
| **Engine** | The Zig binary (`husk-engine`), a forked lightpanda with our patches. |
| **Orchestrator** | The Node binary (`husk`), exposes JSON-RPC over HTTP, manages engine subprocesses, runs watchdog and action planning. |
| **Stable ID** | Hashed semantic identifier for an interactive or landmark element, computed from role + accessible name + landmark path + ordinal + context window. Survives CSS rebuilds. |
| **Site graph** | Per-domain SQLite database mapping `stable_id → current_selector + metadata`. The cross-deploy DOM-drift defense. |
| **Snapshot** | Compressed JSON-LD representation of a page's interactive + semantic content. Computed in-engine from the a11y tree. |
| **Watchdog** | Deterministic rule engine that validates every agent action before it reaches the engine, and asserts expected mutations after. |
| **CDP** | Chrome DevTools Protocol. JSON-RPC schema over WebSocket. Lightpanda speaks CDP; we extend it with `Snapshot` and `SemanticId` domains. |
| **Public protocol** | Husk's JSON-RPC 2.0 protocol exposed by the orchestrator to SDKs. Stable, semver'd, documented in `protocol/jsonrpc.openapi.yaml`. |
| **Tool manifest** | LLM-tool-calling format (OpenAI / Anthropic / JSON Schema) describing Husk's operations. Generated from the public protocol. |
| **a11y tree** | Accessibility tree — the semantic-only view of a page that screen readers see. Pruned of layout-only DOM noise by the engine. |
| **Landmark** | ARIA landmark role (`main`, `navigation`, `search`, `form`, `dialog`, `banner`, `contentinfo`, `region`, `complementary`). Structural anchor used in stable-ID computation. |
| **Lightpanda** | The upstream open-source browser engine (Zig + V8) we fork. AGPL v3-licensed. |

### 5.11 Seamless Session Transfer (M16 — shipped 2026-05-22)

#### Motivation

M15's `husk_handoff` (paste mode) required the user to capture cookies manually via bookmarklet or devtools paste. For real auth flows on modern sites (LinkedIn, Gmail, GitHub — anything with HttpOnly cookies, captcha, or 2FA), that's a clunky multi-step process. M16 makes handoff transparent: Husk launches the user's REAL Chrome at the target URL, watches it via CDP, and pulls cookies back automatically the moment the user navigates past the login page. From the agent's side it's a single blocking tool call; from the user's side they just log in in their normal browser.

**MCP surface unchanged: 21 tools.** Seamless is a `mode` param on existing `husk_handoff`.

#### Seamless flow

1. Agent calls `husk_handoff({mode: "seamless", target_url, need_cookies_back: true, reason})`.
2. Husk pauses the lightpanda session, mints a token.
3. Husk locates a Chrome-family browser on disk (`findChrome()` searches Chrome, Chromium, Brave, Edge, Arc across macOS/Linux/Windows).
4. Husk creates an isolated profile dir (`~/.husk/handoff-profiles/<token>`) — never reuses the user's normal profile.
5. Husk spawns the browser: `chrome --remote-debugging-port=<free> --user-data-dir=<profile> <target_url>`.
6. Husk connects to that Chrome's CDP and injects an overlay button ("✓ I'm done") as a fallback signal.
7. Husk subscribes to `Page.frameNavigated` events on the main frame.
8. **User logs in normally** in their real Chrome — captcha, 2FA, OAuth consent all work natively.
9. On URL change away from the login path (or button click), Husk:
   a. Calls `Network.getAllCookies` on Chrome.
   b. Scopes cookies to the target eTLD+1 (drops third-party trackers).
   c. Imports scoped cookies into the lightpanda session via `Network.setCookies`.
   d. Closes Chrome, removes the profile dir.
10. The blocking `husk_handoff` call returns `{ok: true, mode: "seamless", cookies_imported, ms_paused}`.
11. Agent's next action succeeds with the new authenticated state.

#### Completion detection

**Primary signal: URL pattern.** `detectCompletion(initial_url, observed_url)` returns true when the observed URL is on the same domain (or its subdomains) as initial AND is NOT on a login-y path. Login patterns: `/login`, `/signin`, `/sign-in`, `/auth`, `/oauth`, `/2fa`, `/challenge`, `/verify`, `/checkpoint`. OAuth bounces to third-party domains don't trigger — Husk waits for the redirect back to target.

**Fallback signal: overlay button.** A green "✓ I'm done — return to agent" button is injected via `Page.addScriptToEvaluateOnNewDocument`. Clicking it POSTs `/handoff/:token/seamless-done` and resolves the handoff manually. Used for SPA logins that don't visibly change URL.

**Timeout.** Default 10 minutes. After timeout, paused session resumes; tool returns `{ok: false, reason: "timeout"}`.

#### Cookie scoping

Only cookies whose `domain` matches the target URL's eTLD+1 (or its subdomains) are imported. For `linkedin.com`:
- ✓ `.linkedin.com`, `www.linkedin.com`, `accounts.linkedin.com`
- ✗ `google.com`, `facebook.com`, `doubleclick.net`, `linkedin-fake.com`

This prevents third-party tracker cookies (which Chrome accumulates during normal browsing) from leaking into the agent's session.

#### Decisions

**Decision U — Seamless is the default for `need_cookies_back: true` on 127.0.0.1.** Paste mode remains the fallback for headless environments, non-localhost binds, or when Chrome isn't installed. Falls back to paste with `reason: "chrome_not_found"` so the agent can re-call with explicit `mode: "paste"`.

**Decision V — Per-handoff Chrome profile.** Husk never reuses the user's normal Chrome profile. Each handoff gets a fresh `~/.husk/handoff-profiles/<token>` directory, deleted on completion. Avoids cross-contamination, avoids accidentally signing the user out of their normal browser, and keeps cookie state isolated.

**Decision W — Blocking tool call for seamless.** Paste mode is non-blocking (returns immediately with a token). Seamless is blocking — the tool call doesn't return until completion or timeout. MCP supports multi-minute calls; Claude / Cursor / Continue all tolerate. The blocking model is what makes the UX work: agent waits, user logs in, agent resumes — no polling, no resume call.

#### MCP surface

**21 tools, unchanged from M15.** Seamless is `mode: "seamless"` on existing `husk_handoff`. Return shape differs from paste mode:

| Mode | Behavior | Return shape |
|---|---|---|
| `paste` | Non-blocking | `{pending: true, token, handoff_url, surface}` |
| `seamless` | Blocking | `{ok, mode: "seamless", cookies_imported, ms_paused, reason?}` |

#### Limitations

- Requires Chrome / Chromium / Brave / Edge / Arc installed. Falls back to paste mode if none found.
- Per-handoff profile means the user signs in once per handoff (no persistent profile). For repeated workflows against the same site, this is a trade-off — could be addressed in a future milestone with named handoff profiles.
- eTLD+1 detection uses last-2-parts heuristic, not the Public Suffix List. `example.co.uk` is treated as `co.uk`. Acceptable for v1; PSL integration is a future polish.
- HTTP-only routes for `/handoff/:token` and `/seamless-done` are gated to `host === "127.0.0.1"`. Remote binds use paste mode only.

---

*End of design document.*
