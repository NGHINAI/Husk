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

### Post-v0 sequencing (sketch, refined at each milestone)

| Milestone | Theme | Approx. duration |
|---|---|---|
| **v0.1** | **DOM-drift router pillar** — cross-deploy semantic-ID resolution, self-healing selectors, replay-based regression tests for site graphs | 6–8 weeks |
| **v0.2** | **Auth pillar** — cookie vault, TOTP, SSO/SAML/OIDC redirect chaining, per-site session graphs, human-in-the-loop hooks for SMS/push MFA | 6–8 weeks |
| **v0.3** | **Husk Cloud (open core)** — managed runtime on Fly.io/Modal, API keys, billing, multi-tenancy, observability dashboard | 8–10 weeks |
| **v1.0** | **Pre-indexing pipeline** — offline crawler builds site graphs for top sites, vertical recipes (insurance / mortgage / prior auth) | 12 weeks |
| **v2.0** *(aspirational, needs team)* | **Hybrid engine** — stripped Chromium fork for high-compat sites; runtime routes by site complexity (lightpanda for simple, stripped Chromium for complex) | 6 months |

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

---

*End of design document.*
