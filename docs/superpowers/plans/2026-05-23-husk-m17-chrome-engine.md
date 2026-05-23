# Husk M17 — Chrome Engine Adapter + Smart Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make Husk work on *any* site Chrome works on — LinkedIn, Gmail, Salesforce, modern GitHub, Notion, Linear, anything React-heavy. Add a `ChromeEngine` parallel to the existing `LightpandaEngine`. `husk_create_session({engine: "lightpanda" | "chrome" | "auto"})` selects the engine. Default `"auto"` tries lightpanda first (fast: 50MB, 10ms startup) and transparently falls back to Chrome (~500MB, ~1.5s) when the page can't render (BroadcastChannel-style polyfill gaps, empty AX on rich pages, hydration timeout). **Same MCP surface** — `engine` is just a param on `husk_create_session`.

**Architecture:** Both lightpanda and Chrome speak CDP. The existing `Session` class is engine-agnostic at the protocol level — it sends `Page.navigate`, `Network.setCookies`, `Runtime.evaluate`, etc. M17 reuses ~80% of M16's Chrome plumbing (`spawnChrome`, `ChromeWatcher`, profile management) and adds:
1. A `ChromeEngine` factory that hands out CDP handles in the same shape `EnginePool` does for lightpanda
2. A page-health detector run after `goto` (when `engine: "auto"`)
3. A `fallbackToChrome(session)` path that captures current URL+cookies, closes lightpanda, spins up Chrome with the same state, returns a new session_id (the agent sees a fresh snapshot which already invalidates stable_ids — natural transition point)
4. A separate Chrome pool (heavier lifecycle than lightpanda's pool)

**Tech stack:** TypeScript orchestrator. Reuses M16's `chrome-launcher.ts` (cross-platform Chrome detection, `findFreePort`, `createHandoffProfileDir`) and `chrome-watcher.ts` (CDP connection). New: Chrome pool manager, page-health detector, engine factory abstraction. **No new npm deps.** AGPL.

**Spec references:** §5.12 (NEW — Chrome Engine Adapter). Lands in T8.

**Design locks:**
- **`engine: "auto"` is the new default for `husk_create_session`.** Tries lightpanda first; falls back to Chrome on detected failure. Explicit `"lightpanda"` or `"chrome"` overrides.
- **Chrome is headless by default.** `engine: "chrome-headed"` for the rare case the user wants to watch (useful for debugging). Watch UI already shows what's happening, so headed is usually redundant.
- **Per-session Chrome profile** (`~/.husk/chrome-sessions/<session_id>`), deleted on session.close. Different from M16's per-handoff profile, but same mechanism.
- **Memory-aware pool sizing** — Chrome sessions ~500MB each. Pool max parallel = `min(50, free_mem_mb / 500)`. Compare to lightpanda's `min(50, free_mem_mb / 30)`.
- **CDP is shared** — the existing CdpClient class works against both engines. No protocol wrapper.
- **Smart-routing fallback is transparent** to the agent on the JSON-RPC return type — `husk_goto` returns the same shape, but if a fallback happened, the response includes `engine: "chrome", fellback_from: "lightpanda"`.

---

## Walkthrough: smart routing on LinkedIn

```
Agent                          Husk orchestrator                     Engines
─────                          ─────────────────                     ───────
husk_create_session({})        defaults to engine: "auto"
                               EnginePool.acquire(engine: "auto")
                               → lightpanda handle returned (fast path)
◄── { session_id: "s1", engine: "lightpanda", watch_url }

husk_goto({ url: "linkedin.com/in/xyz" })
                               lightpanda.Page.navigate(linkedin.com/...)
                               → page loads
                               → eager-snapshot fires (M9)
                               → Page-health detector inspects snapshot:
                                   - meta.title = "Denise T. | LinkedIn"
                                   - root has only 4 AX nodes
                                   - console has BroadcastChannel error
                                   - "Reintentar" / error pattern detected
                               → FAILURE markers exceeded threshold
                               
                               Auto-fallback triggered:
                               1. capture lightpanda's cookies for linkedin.com
                               2. close lightpanda session
                               3. ChromePool.acquire() → spawn Chrome with profile
                               4. Chrome.Network.setCookies(captured)
                               5. Chrome.Page.navigate(linkedin.com/in/xyz)
                               6. wait for Page.loadEventFired + network-idle
                               7. fresh snapshot via Chrome's AX tree
                               8. session_id stays "s1" — same logical session,
                                  different underlying engine
                                  
◄── { ok: true, snapshot: { /* full Chrome-rendered AX tree */ },
       engine: "chrome", fellback_from: "lightpanda" }

husk_click({ intent: "Connect" })
                               Now resolves against Chrome's snapshot
                               → click fires, button responds
◄── { ok: true, snapshot, diff }

[Agent continues normally — no awareness of engine swap]
```

---

## Failure markers (when to fall back)

The page-health detector runs after lightpanda's `goto` completes. It returns `should_fallback: true` if ANY of these fire:

1. **Polyfill-gap errors in `snapshot.console`** — known fatal errors:
   - `BroadcastChannel is not defined`
   - `IndexedDB is not defined`
   - `ServiceWorker is not defined`
   - `customElements is not defined`
   - `MutationObserver is not defined` (rare, but kills SPAs)

2. **Empty/error AX tree on a content-rich URL:**
   - Total AX nodes ≤ 5 AND URL is on a top-1000 site (LinkedIn, Gmail, Twitter, Facebook, GitHub, Salesforce, Notion, Linear, Asana, etc. — kept in a small static list)
   - OR AX tree's only meaningful node is `text-content: ~/error|problem|reintentar|try again|something went wrong/i`

3. **Hydration timeout** — page loaded > 5s ago (loadEventFired fired) but AX tree hasn't changed in last 2s AND has fewer than 20 nodes.

4. **Empty `meta.jsonld`, `meta.og`, `forms`, and < 10 text-bearing AX nodes** on a non-blank URL.

The detector is conservative — false positives just trigger an unnecessary fallback (cost: a few seconds of latency + 500MB of Chrome). False negatives are worse (agent works against a broken page). Lean toward fallback.

---

## File structure

**New files:**
- `orchestrator/src/engine/chrome-engine.ts` — Chrome process management (parallel to existing lightpanda code in `engine/binary.ts` + pool entries)
- `orchestrator/src/engine/chrome-pool.ts` — Chrome session pool with memory-aware sizing
- `orchestrator/src/engine/engine-router.ts` — `acquire(engine: EngineKind)` factory; routes to lightpanda or Chrome pool
- `orchestrator/src/engine/page-health.ts` — failure-marker detector + known-site list
- `orchestrator/src/engine/fallback.ts` — captures state, closes engine A, spins up engine B, restores state
- 5 test files

**Modified files:**
- `orchestrator/src/engine/pool.ts` — `EnginePool` becomes either factory-pattern or stays lightpanda-only with the new router handling cross-engine concerns
- `orchestrator/src/session/session.ts` — knows its `engine: EngineKind`; exposes it in `snapshot.engine` (new field) and on action results; can call `fallback()` to swap engines
- `orchestrator/src/session/manager.ts` — `create({engine})` routes via engine-router
- `orchestrator/src/http/methods.ts` — `create_session` accepts `engine` param; `goto` runs page-health when `engine: "auto"`
- `orchestrator/src/snapshot/types.ts` — `engine: "lightpanda" | "chrome"` in Snapshot
- `mcp/src/tool-surface.ts` — `husk_create_session` description + inputSchema gains `engine`
- SDKs (TS + Py) — `engine` param on createSession
- Spec §5.12 + README + memory

---

## Task map

| # | Task | Model | Est |
|---|---|---|---|
| T1 | `ChromeEngine` — spawn + ready-poll + CDP-handle factory (reuses M16's chrome-launcher) | Sonnet | 2.5h |
| T2 | `ChromePool` — memory-aware sizing, lifecycle, profile dir management | Sonnet | 2.5h |
| T3 | `engine-router` — `acquire(kind)` routes to right pool; exposes uniform handle | Sonnet | 2h |
| T4 | `page-health` detector — failure markers (polyfill errors, empty AX, hydration timeout) + known-site list | Sonnet | 2h |
| T5 | `fallback` — capture cookies/URL from engine A, close it, spin engine B with state, restore | Sonnet | 2.5h |
| T6 | Wire `engine` param into create_session + Session class + `auto` routing in goto | Sonnet | 2.5h |
| T7 | MCP description + SDKs (engine param) + integration test (against real Chrome, gated by HUSK_SMOKE_CHROME=1) | Sonnet | 2h |
| T8 | Spec §5.12 + README + memory + tag v0.0.16-m17 + merge --no-ff + push | Haiku | 1h |

**Total:** 8 tasks, ~17h (~2 days). **MCP surface unchanged at 21** — `engine` is a new param on existing `husk_create_session`.

---

## Task 1 — ChromeEngine

**Files:**
- Create: `orchestrator/src/engine/chrome-engine.ts`
- Test: `orchestrator/tests/engine/chrome-engine.test.ts`

### Steps

- [ ] **Step 1: Failing test** — mocked spawn, asserts the engine produces a CdpClient-compatible handle and a `.kill()` method.

- [ ] **Step 2: Implement**

```typescript
import { spawnChrome, findFreePort, findChrome, createHandoffProfileDir } from "../handoff/chrome-launcher.js";
import { CdpClient } from "./cdp-client.js";

export interface ChromeEngineHandle {
  cdp: CdpClient;
  port: number;
  profileDir: string;
  child: ChildProcess;
  kill(): Promise<void>;
  release(): Promise<void>;  // matches LightpandaEngine signature
}

export async function spawnChromeEngine(sessionId: string, opts: { headless?: boolean } = {}): Promise<ChromeEngineHandle> {
  const binary = findChrome();
  if (!binary) throw new Error("Chrome-family browser not found on this machine");
  const port = await findFreePort();
  const profileDir = await createHandoffProfileDir(`session-${sessionId}`);
  const spawned = spawnChrome({
    binaryPath: binary,
    targetUrl: "about:blank",  // navigate later via goto
    profileDir,
    port,
    extraArgs: opts.headless !== false ? ["--headless=new"] : [],  // headless by default
  });
  await spawned.whenReady(15_000);

  // Connect to the page target via /json/list
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = (list as Array<{ type: string; webSocketDebuggerUrl?: string }>)
    .find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error("Chrome has no page target");

  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  if (typeof (cdp as any).ready === "object") await (cdp as any).ready;

  return {
    cdp, port, profileDir, child: spawned.child,
    kill: async () => { spawned.child.kill(); },
    release: async () => {
      spawned.child.kill();
      const { rm } = await import("node:fs/promises");
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
```

(Note: requires extending `spawnChrome` to accept `extraArgs` — if it doesn't already, add it minimally. Headless mode + isolated profile is the production default.)

- [ ] **Step 3: Test**: verify shape, kill/release semantics. Real-Chrome smoke gated by `HUSK_SMOKE_CHROME=1`.

- [ ] **Step 4: Commit** — `feat(engine): ChromeEngine factory (spawn + CDP handle + lifecycle)`

---

## Task 2 — ChromePool

**Files:**
- Create: `orchestrator/src/engine/chrome-pool.ts`
- Test: `orchestrator/tests/engine/chrome-pool.test.ts`

### Design

Parallel to `EnginePool` (M9). Differences:
- Smaller pool (memory budget): `maxParallel = min(50, freeMb / 500)` instead of `/30`
- Slower spinup: ~1.5s vs lightpanda's ~10ms — keep `minWarm` at 1 (vs 4), trade memory for latency
- Same elastic-shrink + idle-reap pattern from M9

### Methods
- `acquire(): Promise<ChromeEngineHandle>` — returns warm handle or spins one up
- `release(handle): void` — returns to pool OR shuts down if over warm threshold
- `close(): Promise<void>` — terminate all

### Steps
- [ ] Test (mocked spawn), implement, commit `feat(engine): ChromePool with memory-aware sizing`

---

## Task 3 — engine-router

**Files:**
- Create: `orchestrator/src/engine/engine-router.ts`
- Test: `orchestrator/tests/engine/engine-router.test.ts`

### Design

```typescript
export type EngineKind = "lightpanda" | "chrome" | "auto";

export interface EngineHandle {
  kind: "lightpanda" | "chrome";  // resolved kind ("auto" picks one)
  cdp: CdpClient;
  release(): Promise<void>;
}

export interface EngineRouter {
  acquire(kind: EngineKind): Promise<EngineHandle>;
}

export function createEngineRouter(opts: { lightpandaPool: EnginePool; chromePool: ChromePool }): EngineRouter {
  return {
    async acquire(kind) {
      if (kind === "chrome") {
        const h = await opts.chromePool.acquire();
        return { kind: "chrome", cdp: h.cdp, release: h.release };
      }
      // "lightpanda" OR "auto" — both start with lightpanda; auto upgrades on failure
      const h = await opts.lightpandaPool.acquire();
      return { kind: "lightpanda", cdp: h.cdp, release: h.release };
    },
  };
}
```

The router is thin — the actual "auto" decision happens AFTER `goto` (in T4-T5). On creation, "auto" means "start with lightpanda."

### Steps
- [ ] Test, implement, commit `feat(engine): engine-router (lightpanda | chrome | auto factory)`

---

## Task 4 — Page-health detector

**Files:**
- Create: `orchestrator/src/engine/page-health.ts`
- Test: `orchestrator/tests/engine/page-health.test.ts`

### Implementation

```typescript
import type { Snapshot } from "../snapshot/types.js";

const FATAL_POLYFILL_ERRORS = [
  /BroadcastChannel is not defined/i,
  /IndexedDB is not defined/i,
  /ServiceWorker is not defined/i,
  /customElements is not defined/i,
];

const KNOWN_RICH_SITES = new Set([
  "linkedin.com", "gmail.com", "salesforce.com", "github.com",
  "twitter.com", "x.com", "facebook.com", "instagram.com",
  "notion.so", "linear.app", "asana.com", "monday.com",
  "slack.com", "discord.com", "youtube.com", "docs.google.com",
  // Top sites known to be JS-heavy and likely to need Chrome
]);

const ERROR_PATTERN = /\b(reintentar|try again|something went wrong|problem|error|unavailable)\b/i;

export interface HealthVerdict {
  should_fallback: boolean;
  reasons: string[];
}

export function detectPageHealth(snapshot: Snapshot, opts?: { hydrationTimeoutMs?: number }): HealthVerdict {
  const reasons: string[] = [];

  // 1. Polyfill errors in console
  const consoleErrors = (snapshot.console ?? []).filter((m) => m.level === "error");
  for (const err of consoleErrors) {
    for (const re of FATAL_POLYFILL_ERRORS) {
      if (re.test(err.text)) {
        reasons.push(`polyfill_gap:${re.source.split(" ")[0]}`);
        break;
      }
    }
  }

  // 2. Empty AX on known-rich site
  const nodeCount = countNodes(snapshot.root);
  let isKnownRich = false;
  try {
    const host = new URL(snapshot.url).hostname.replace(/^www\./, "");
    isKnownRich = [...KNOWN_RICH_SITES].some((s) => host === s || host.endsWith("." + s));
  } catch { /* invalid url */ }

  if (isKnownRich && nodeCount <= 5) reasons.push("empty_ax_on_rich_site");

  // 3. Only-error content
  const onlyText = (snapshot.root.n ?? "") + flattenText(snapshot.root);
  if (nodeCount <= 5 && ERROR_PATTERN.test(onlyText)) reasons.push("only_error_text");

  // 4. Minimal content + no metadata
  const noMeta = !snapshot.meta?.jsonld?.length && !Object.keys(snapshot.meta?.og ?? {}).length;
  const noForms = !snapshot.forms?.length;
  if (isKnownRich && noMeta && noForms && nodeCount < 20) reasons.push("minimal_content_on_rich_site");

  return { should_fallback: reasons.length > 0, reasons };
}

function countNodes(node: { c?: unknown[] } | undefined): number {
  if (!node) return 0;
  let n = 1;
  const walk = (x: { c?: unknown[] } | undefined) => {
    if (!x) return;
    n++;
    if (Array.isArray(x.c)) for (const c of x.c) walk(c as any);
  };
  if (Array.isArray(node.c)) for (const c of node.c) walk(c as any);
  return n;
}

function flattenText(node: { n?: string; c?: unknown[] }): string {
  let s = node.n ?? "";
  if (Array.isArray(node.c)) for (const c of node.c) s += " " + flattenText(c as any);
  return s;
}
```

### Steps
- [ ] Test with synthetic snapshots: LinkedIn-error-page (should fallback), Wikipedia (should NOT), HN-bare (should NOT), etc.
- [ ] Commit `feat(engine): page-health detector (polyfill gaps + empty AX + error-pattern)`

---

## Task 5 — fallback (engine swap with state transfer)

**Files:**
- Create: `orchestrator/src/engine/fallback.ts`
- Test: `orchestrator/tests/engine/fallback.test.ts`

### Implementation

```typescript
import type { Session } from "../session/session.js";
import type { ChromePool } from "./chrome-pool.js";

export interface FallbackResult {
  ok: boolean;
  new_engine: "chrome";
  cookies_transferred: number;
  ms_elapsed: number;
}

/**
 * Swap a session's underlying engine from lightpanda to chrome. Preserves URL + cookies.
 * Returns a new EngineHandle for the chrome process. The Session's stable_ids invalidate
 * (different DOM); the agent's next snapshot reveals the fresh tree.
 */
export async function fallbackToChrome(session: Session, chromePool: ChromePool): Promise<FallbackResult> {
  const start = Date.now();

  // 1. Capture state from current (lightpanda) engine
  const currentUrl = session.getCurrentUrl?.() ?? "about:blank";
  const cookies = await session.exportCookies();  // new method: Network.getAllCookies on the current cdp

  // 2. Acquire Chrome handle
  const chromeHandle = await chromePool.acquire();

  // 3. Release current engine BEFORE swapping (no overlap)
  await session.releaseEngine();

  // 4. Swap in the chrome handle
  await session.swapEngine(chromeHandle);

  // 5. Restore cookies + navigate
  await session.importCookies(cookies);
  await session.goto(currentUrl);  // re-uses M9's goto with eager-snapshot

  return {
    ok: true,
    new_engine: "chrome",
    cookies_transferred: cookies.length,
    ms_elapsed: Date.now() - start,
  };
}
```

This requires `Session` to expose `releaseEngine()`, `swapEngine(handle)`, `exportCookies()`. T6 wires them.

### Steps
- [ ] Test (mocked), commit `feat(engine): fallback — engine swap with cookie + URL preservation`

---

## Task 6 — Wire engine param + Session swap support + auto routing in goto

**Files:**
- Modify: `orchestrator/src/session/session.ts` — `engine: EngineKind` field; `swapEngine` / `releaseEngine` / `exportCookies`; goto runs page-health when `engine: "auto"`
- Modify: `orchestrator/src/session/manager.ts` — accept `engine` param, route via engine-router
- Modify: `orchestrator/src/http/methods.ts` — `create_session` accepts `engine`
- Modify: `orchestrator/src/snapshot/types.ts` — `engine: "lightpanda" | "chrome"` in Snapshot

### Auto-routing in goto (the critical wiring)

When session was created with `engine: "auto"`:
1. lightpanda goto runs as today
2. Eager snapshot fires
3. `page-health.detectPageHealth(snapshot)` runs
4. If `should_fallback === true`, call `fallbackToChrome(session, chromePool)`. Return the post-fallback snapshot to the agent. Result includes `engine: "chrome", fellback_from: "lightpanda", fallback_reasons: [...]`.

When session created with `engine: "lightpanda"` or `"chrome"`: no health check, no fallback. Agent gets what they asked for.

### Steps
- [ ] Wire all four files; integration tests pass; commit `feat(engine): wire engine param + Session swap + auto-routing in goto`

---

## Task 7 — MCP + SDKs + integration test

### MCP description

Append to `husk_create_session`:

```
ENGINE SELECTION:
- "auto" (default): tries the fast headless engine first; auto-falls-back to Chrome on detected failure (LinkedIn, Gmail, Salesforce, etc.). Best general default — fast on simple sites, full compat on hard ones.
- "lightpanda": forces the fast engine. Use when you need maximum speed and KNOW the site is simple (static pages, server-rendered content).
- "chrome": forces real Chrome (~500MB, ~1.5s spinup). Use when you KNOW you'll need full SPA compat from the start (saves the fallback round-trip).

The chosen engine appears on snapshot.engine. If a fallback fired, the goto result includes fellback_from + fallback_reasons.
```

### SDKs

TS + Py: add `engine?: "lightpanda" | "chrome" | "auto"` to `createSession`.

### Integration test

`orchestrator/tests/integration/m17-engine-routing.test.ts` (gated by `HUSK_SMOKE_CHROME=1`):
- Create session with `engine: "chrome"`, goto Wikipedia, snapshot.engine === "chrome", node count > 50
- Create session with `engine: "auto"`, goto a fixture that triggers polyfill error (or actual linkedin.com if env says ok), verify fellback_from === "lightpanda"
- Create session with `engine: "lightpanda"`, goto same problematic URL, verify NO fallback fires (lightpanda-only)

### Steps
- [ ] All wiring, integration tests, commit `feat(engine): MCP+SDK engine param + integration tests`

---

## Task 8 — Docs + tag + merge + push

### Spec §5.12

Sections:
1. Motivation — the lightpanda compat ceiling; the Chrome engine adapter
2. Engine kinds — lightpanda / chrome / auto
3. Smart routing flow + failure markers
4. Per-session Chrome profile + memory-aware pool sizing
5. Decision X — auto is the new default for create_session
6. Decision Y — engine swap is transparent (same session_id, fresh AX tree, agent unaware)
7. Decision Z — Chrome is headless by default; "chrome-headed" is optional escape hatch
8. MCP surface unchanged at 21

### README

"Engine Selection (M17)" section. Examples for each kind. The "any site" promise.

### Memory
- `husk-roadmap.md`: `v0.0.16-m17`
- `husk-architecture.md`: Decisions X, Y, Z
- `husk-overview.md`: capability list includes "auto engine routing"

### Tag + merge
```
git tag -a v0.0.16-m17 -m "M17: Chrome Engine Adapter + Smart Routing
- ChromeEngine + ChromePool (memory-aware, ~500MB per session)
- engine: 'lightpanda' | 'chrome' | 'auto' on create_session
- 'auto' tries lightpanda first, falls back to Chrome on polyfill errors / empty AX / hydration failure
- page-health detector with known-rich-site list (LinkedIn, Gmail, Salesforce, etc.)
- transparent engine swap: same session_id, cookies+URL preserved, fresh AX tree
- MCP surface unchanged: 21 tools (engine is a param on husk_create_session)"
git checkout main
git merge --no-ff m17-chrome-engine -m "Merge Milestone 17 (Chrome engine adapter + smart routing)"
git push origin main && git push origin v0.0.16-m17
```

---

## Self-review

**Spec coverage:** 8 tasks, all 5 capabilities (Chrome engine, pool, router, health detector, fallback) covered. ✓

**Tool bloat check:** **+0 new MCP tools.** `engine` is a param on `husk_create_session`. Per Decision N this is a fold-in. ✓

**Reuse from M16:** chrome-launcher.ts (T1), CDP plumbing (T1, T3), profile dir management (T1, T2). ~60% of M17 builds on M16. ✓

**Backward compat:** existing `husk_create_session()` calls (no engine param) default to "auto" which behaves like "lightpanda" for simple sites — no surprise. The fallback path is invisible to agents that don't read `snapshot.engine`. ✓

**Edge cases:**
- Chrome not installed → `engine: "chrome"` fails with `chrome_not_found`; `engine: "auto"` falls back to lightpanda only (no Chrome to swap TO)
- Memory exhausted → ChromePool refuses to spawn beyond `freeMb/500` limit; returns `pool_exhausted`
- User explicitly forced lightpanda but site needs Chrome → agent sees rendering failure but no fallback; they can re-create session with `engine: "chrome"` ✓

**Performance:**
- Lightpanda-happy path: unchanged (no health check fires because no triggers match)
- Auto-fallback path: 200-500ms page-health check + ~1.5s Chrome spinup + ~500ms goto = ~2.2s overhead vs pure lightpanda. Acceptable for sites that wouldn't work at all otherwise.
- Pure Chrome path: ~1.5s spinup vs lightpanda's ~10ms. Trade-off for compat.

---

## Execution

Same flow as M15/M16: subagent-driven, two-stage review per task, continuous execution. Branch: `m17-chrome-engine` (to cut from main after plan commit). Tag at end: `v0.0.16-m17`.
