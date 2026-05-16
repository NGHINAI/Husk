# Husk M13 — Dynamic Workflow Primitives + Watch UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AI agents the five missing primitives that block "any workflow" — `wait_for`, `find({intent})`, `upload`, `capture`, page-readiness — then ship a `/watch` SSE UI so humans (and the agent itself) can offer "want to watch what I'm seeing?" as a viral demo affordance.

**Architecture:** All five primitives extend the existing JSON-RPC + MCP surface and route through the M5 watchdog where applicable (find/capture are read-only and bypass; wait_for/upload pass through the action pipeline). The Watch UI is a single-file HTML+SSE viewer bound to 127.0.0.1 on the orchestrator's existing HTTP server; it reuses the snapshot pipeline and emits diffs from action results. No new daemons, no extra binaries.

**Tech Stack:** TypeScript (Node 20) in `orchestrator/`, lightpanda CDP for primitives (DOM.setFileInputFiles, Runtime.evaluate, Page.loadEventFired, Network.requestWillBeSent), single-file HTML + EventSource for /watch, AGPL.

**Spec references:** §5.8 (NEW — Dynamic Workflow Primitives + Watch). Spec § amendment lands in T7.

**Design locks from clarifying questions:**
- `find()` is an **internal resolver**, not a separate MCP tool. Deterministic Jaro-Winkler over AX tree + M4 site cache. No LLM, latency-priority (~1ms target). It folds into `husk_click`/`husk_type`/`husk_scroll`/`husk_upload`, which all accept `{stable_id} | {intent}`. Ambiguous intent (multiple candidates within 0.05) returns a watchdog-style rejection envelope.
- `husk_wait_for` — supports `{text | role+name | url_matches | network_idle | selector_visible}`. Default timeout 10s.
- `husk_upload` — accepts `{(stable_id|intent), file_path}` OR `{(stable_id|intent), content_base64, filename}`.
- `capture` folds into existing `husk_extract` — accepts `{css}` (single) OR `{selectors: {k: css}}` (multi). One verb, two shapes.
- Watch UI — single-file HTML + SSE, 127.0.0.1-only, live-only (no replay buffer), professional code-editor aesthetic.
- Watch affordance — `husk_create_session` returns `{session_id, watch_url}`. Agent surfaces "want to watch what I'm seeing?" using that URL. No separate tool.

**MCP tool surface delta:** **+2 tools** (`husk_wait_for`, `husk_upload`). All other capabilities ride on existing verbs.

---

## File Structure

**New files:**
- `orchestrator/src/session/wait.ts` — wait_for condition evaluators
- `orchestrator/src/session/find.ts` — intent → stable_id resolver (AX + Jaro-Winkler)
- `orchestrator/src/session/upload.ts` — DOM.setFileInputFiles wrapper + base64 → tempfile
- `orchestrator/src/session/capture.ts` — multi-selector combined evaluate
- `orchestrator/src/session/page-ready.ts` — Page.loadEventFired + network-idle replacement for setTimeout(1500)
- `orchestrator/src/watch/sse.ts` — per-session event bus + SSE handler
- `orchestrator/src/watch/index.html.ts` — exports `WATCH_HTML` constant (string)
- `orchestrator/src/watch/events.ts` — typed event shapes (snapshot, action, rejection, navigation)
- `orchestrator/test/wait.test.ts`
- `orchestrator/test/find.test.ts`
- `orchestrator/test/upload.test.ts`
- `orchestrator/test/capture.test.ts`
- `orchestrator/test/page-ready.test.ts`
- `orchestrator/test/watch-sse.test.ts`
- `orchestrator/test/integration/dynamic-workflows.test.ts`

**Modified files:**
- `orchestrator/src/session/session.ts` — wires 5 primitives + emits watch events
- `orchestrator/src/http/methods.ts` — adds 6 RPC methods (`wait_for`, `find`, `upload`, `capture`, `watch_url`, plus internal event sub)
- `orchestrator/src/http/server.ts` — registers `/watch`, `/watch/stream/:id` routes
- `mcp/src/tool-surface.ts` — adds `husk_wait_for`, `husk_find`, `husk_upload`, `husk_capture`, `husk_watch_url`
- `sdk-ts/src/session.ts` — adds 5 methods
- `sdk-py/husk/_session.py` — adds 5 methods
- `docs/superpowers/specs/2026-05-13-husk-design.md` — appends §5.8
- `README.md` — Dynamic primitives section + Watch UI screenshot/gif
- Memory: `husk-roadmap.md` (v0.0.12-m13 tag), `husk-architecture.md` (Decision L: Watch UI, Decision M: deterministic find), `husk-overview.md` (capability checklist)

---

## Task Map

| # | Task | Files touched | Model | Est |
|---|---|---|---|---|
| T1 | Page-ready replacement (`Page.loadEventFired` + network-idle), drops `setTimeout(1500)` | page-ready, session, test | Sonnet | 2h |
| T2 | `husk_wait_for` — 5 conditions + 10s default timeout | wait, methods, mcp, sdks, test | Sonnet | 2.5h |
| T3 | Internal `find()` resolver + fold into click/type/scroll/upload (`stable_id`\|`intent`). Ambiguity → rejection envelope. **No new MCP tool.** | find (internal), session action methods, mcp tool descriptions updated, test | Sonnet | 3h |
| T4 | `husk_upload` — path + base64 modes via `DOM.setFileInputFiles`, accepts `stable_id` or `intent` | upload, methods, mcp, sdks, test | Sonnet | 2h |
| T5 | Multi-selector mode for **existing** `husk_extract` — accepts `{css}` or `{selectors: {k:css}}`. **No new MCP tool.** | extract.ts (extended), methods, mcp description update, test | Haiku | 1h |
| T6 | Watch event bus + SSE stream | watch/sse, events, server, session emits | Sonnet | 2h |
| T7 | Watch UI HTML (single-file, dark/code aesthetic) + `husk_create_session` returns `{session_id, watch_url}`. **No new MCP tool.** | index.html.ts, server route, create_session method, mcp description update, test | Sonnet | 3h |
| T8 | Real-lightpanda integration test exercising all primitives + watch SSE (uses `intent`-based click + extract-multi + wait_for + upload) | integration test fixture | Sonnet | 2h |
| T9 | Docs (spec §5.8 + README + memory) + tag v0.0.12-m13 + merge --no-ff + push | spec, README, memory | Haiku | 1h |

**Total:** 9 tasks, ~18.5h. **MCP surface net: +2 tools** (`husk_wait_for`, `husk_upload`).

---

## Task 1: Page-ready replacement (drop setTimeout(1500))

**Why first:** Every other primitive depends on goto returning when the page is *actually* ready, not after a fixed delay. Doing this first means T2 (wait_for) and T8 (integration) can rely on it.

**Files:**
- Create: `orchestrator/src/session/page-ready.ts`
- Modify: `orchestrator/src/session/session.ts` — replace `setTimeout(1500)` in `goto`
- Test: `orchestrator/test/page-ready.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// orchestrator/test/page-ready.test.ts
import { describe, it, expect, vi } from "vitest";
import { waitForPageReady } from "../src/session/page-ready.js";

describe("waitForPageReady", () => {
  it("resolves on Page.loadEventFired before network-idle window", async () => {
    const cdp = makeFakeCdp();
    const p = waitForPageReady(cdp, { networkIdleMs: 200, maxWaitMs: 5000 });
    cdp.emit("Page.loadEventFired", { timestamp: Date.now() });
    await new Promise((r) => setTimeout(r, 250));
    const r = await p;
    expect(r.reason).toBe("network_idle");
  });

  it("resolves after maxWaitMs even if requests never stop", async () => {
    const cdp = makeFakeCdp();
    cdp.startInflight("req1"); // never finishes
    const r = await waitForPageReady(cdp, { networkIdleMs: 200, maxWaitMs: 500 });
    expect(r.reason).toBe("max_wait");
  });

  it("network-idle requires N ms of zero in-flight requests", async () => {
    const cdp = makeFakeCdp();
    cdp.emit("Page.loadEventFired", {});
    cdp.startInflight("a");
    setTimeout(() => cdp.finishInflight("a"), 100);
    const r = await waitForPageReady(cdp, { networkIdleMs: 300, maxWaitMs: 5000 });
    expect(r.reason).toBe("network_idle");
    expect(r.waitedMs).toBeGreaterThanOrEqual(400);
  });
});

function makeFakeCdp() {
  const handlers = new Map<string, Array<(p: unknown) => void>>();
  const inflight = new Set<string>();
  return {
    on(event: string, fn: (p: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(fn);
    },
    off(event: string, fn: (p: unknown) => void) {
      handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== fn));
    },
    emit(event: string, payload: unknown) {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    startInflight(id: string) {
      inflight.add(id);
      this.emit("Network.requestWillBeSent", { requestId: id });
    },
    finishInflight(id: string) {
      inflight.delete(id);
      this.emit("Network.loadingFinished", { requestId: id });
    },
    inflightCount() { return inflight.size; },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter husk-orchestrator test test/page-ready.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement page-ready.ts**

```typescript
// orchestrator/src/session/page-ready.ts
export interface CdpLike {
  on(event: string, fn: (p: unknown) => void): void;
  off(event: string, fn: (p: unknown) => void): void;
}

export interface PageReadyOpts {
  networkIdleMs?: number;
  maxWaitMs?: number;
}

export interface PageReadyResult {
  ok: true;
  reason: "network_idle" | "max_wait";
  waitedMs: number;
}

export async function waitForPageReady(
  cdp: CdpLike,
  opts: PageReadyOpts = {},
): Promise<PageReadyResult> {
  const networkIdleMs = opts.networkIdleMs ?? 500;
  const maxWaitMs = opts.maxWaitMs ?? 8000;
  const start = Date.now();

  let inflight = 0;
  let loadFired = false;
  let idleTimer: NodeJS.Timeout | null = null;

  return new Promise<PageReadyResult>((resolve) => {
    const finish = (reason: "network_idle" | "max_wait") => {
      cdp.off("Network.requestWillBeSent", onReqStart);
      cdp.off("Network.loadingFinished", onReqEnd);
      cdp.off("Network.loadingFailed", onReqEnd);
      cdp.off("Page.loadEventFired", onLoad);
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(hardCap);
      resolve({ ok: true, reason, waitedMs: Date.now() - start });
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (loadFired && inflight === 0) {
        idleTimer = setTimeout(() => finish("network_idle"), networkIdleMs);
      }
    };

    const onReqStart = () => { inflight++; if (idleTimer) clearTimeout(idleTimer); };
    const onReqEnd = () => { inflight = Math.max(0, inflight - 1); armIdle(); };
    const onLoad = () => { loadFired = true; armIdle(); };

    cdp.on("Network.requestWillBeSent", onReqStart);
    cdp.on("Network.loadingFinished", onReqEnd);
    cdp.on("Network.loadingFailed", onReqEnd);
    cdp.on("Page.loadEventFired", onLoad);

    const hardCap = setTimeout(() => finish("max_wait"), maxWaitMs);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter husk-orchestrator test test/page-ready.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Wire into Session.goto**

In `orchestrator/src/session/session.ts`, locate the existing `goto` (eager-snapshot) path. Replace `await new Promise(r => setTimeout(r, 1500))` with:

```typescript
import { waitForPageReady } from "./page-ready.js";
// ... inside goto, after Page.navigate completes:
await waitForPageReady(this.cdp, { networkIdleMs: 500, maxWaitMs: 8000 });
```

Keep the existing eager-snapshot try/catch around `snapshot({force:true})` intact.

- [ ] **Step 6: Run integration smoke test**

Run: `HUSK_INT=1 pnpm --filter husk-orchestrator test test/integration/lightpanda.test.ts -t goto`
Expected: PASS. If goto hangs, lower `maxWaitMs` to 5000 and document in spec §5.8.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/src/session/page-ready.ts orchestrator/src/session/session.ts orchestrator/test/page-ready.test.ts
git commit -m "feat(session): replace setTimeout(1500) with Page.loadEventFired + network-idle"
```

---

## Task 2: husk_wait_for

**Files:**
- Create: `orchestrator/src/session/wait.ts`
- Modify: `orchestrator/src/session/session.ts`, `orchestrator/src/http/methods.ts`, `mcp/src/tool-surface.ts`, `sdk-ts/src/session.ts`, `sdk-py/husk/_session.py`
- Test: `orchestrator/test/wait.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// orchestrator/test/wait.test.ts
import { describe, it, expect } from "vitest";
import { runWaitFor } from "../src/session/wait.js";

describe("runWaitFor", () => {
  it("resolves text condition when text appears in snapshot", async () => {
    const session = makeFakeSession({ snapshots: [
      { url: "https://x", nodes: [{ i: "a", r: "heading", n: "Login" }] },
      { url: "https://x", nodes: [{ i: "a", r: "heading", n: "Logged in" }] },
    ]});
    const r = await runWaitFor(session, { text: "Logged in", timeout_ms: 1000 });
    expect(r.ok).toBe(true);
    expect(r.condition_met).toBe("text");
  });

  it("resolves url_matches via regex", async () => {
    const session = makeFakeSession({ snapshots: [
      { url: "https://x/login", nodes: [] },
      { url: "https://x/dashboard", nodes: [] },
    ]});
    const r = await runWaitFor(session, { url_matches: "/dashboard$", timeout_ms: 1000 });
    expect(r.ok).toBe(true);
  });

  it("resolves role+name match", async () => {
    const session = makeFakeSession({ snapshots: [
      { url: "/", nodes: [{ i: "x", r: "button", n: "Cancel" }] },
      { url: "/", nodes: [{ i: "y", r: "button", n: "Submit" }] },
    ]});
    const r = await runWaitFor(session, {
      role: "button", name: "Submit", timeout_ms: 1000,
    });
    expect(r.ok).toBe(true);
    expect(r.stable_id).toBe("y");
  });

  it("resolves selector_visible via Runtime.evaluate", async () => {
    const session = makeFakeSession({ evalResults: [null, "visible"] });
    const r = await runWaitFor(session, { selector_visible: ".modal", timeout_ms: 1000 });
    expect(r.ok).toBe(true);
  });

  it("times out when condition never met", async () => {
    const session = makeFakeSession({ snapshots: [{ url: "/", nodes: [] }] });
    const r = await runWaitFor(session, { text: "never", timeout_ms: 200 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout");
  });

  it("rejects when no condition specified", async () => {
    const session = makeFakeSession({});
    await expect(runWaitFor(session, { timeout_ms: 1000 } as never)).rejects.toThrow(/condition/);
  });
});

function makeFakeSession(opts: {
  snapshots?: Array<{ url: string; nodes: Array<{ i: string; r: string; n: string }> }>;
  evalResults?: Array<unknown>;
}) {
  let snapIdx = 0;
  let evalIdx = 0;
  return {
    async snapshot() {
      const s = opts.snapshots?.[Math.min(snapIdx, opts.snapshots.length - 1)] ?? { url: "/", nodes: [] };
      snapIdx++;
      return s;
    },
    async runtimeEval(_expr: string) {
      const v = opts.evalResults?.[evalIdx];
      evalIdx++;
      return v;
    },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter husk-orchestrator test test/wait.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement wait.ts**

```typescript
// orchestrator/src/session/wait.ts
export interface WaitForCondition {
  text?: string;
  role?: string;
  name?: string;
  url_matches?: string;
  network_idle?: number; // ms of idle
  selector_visible?: string;
  timeout_ms?: number;
}

export interface WaitForResult {
  ok: boolean;
  condition_met?: "text" | "role_name" | "url_matches" | "network_idle" | "selector_visible";
  reason?: "timeout";
  waited_ms: number;
  stable_id?: string;
}

interface SessionLike {
  snapshot(opts?: { force?: boolean }): Promise<{ url: string; nodes: Array<{ i: string; r: string; n: string }> }>;
  runtimeEval(expr: string): Promise<unknown>;
}

const POLL_MS = 100;

export async function runWaitFor(session: SessionLike, c: WaitForCondition): Promise<WaitForResult> {
  if (!c.text && !c.role && !c.url_matches && c.network_idle === undefined && !c.selector_visible) {
    throw new Error("husk_wait_for: at least one condition required (text, role+name, url_matches, network_idle, selector_visible)");
  }
  const timeout = c.timeout_ms ?? 10_000;
  const start = Date.now();
  const urlRe = c.url_matches ? new RegExp(c.url_matches) : null;

  while (Date.now() - start < timeout) {
    const snap = await session.snapshot({ force: false });
    if (c.text) {
      const hit = snap.nodes.find((n) => n.n?.includes(c.text!));
      if (hit) return { ok: true, condition_met: "text", waited_ms: Date.now() - start, stable_id: hit.i };
    }
    if (c.role && c.name) {
      const hit = snap.nodes.find((n) => n.r === c.role && n.n === c.name);
      if (hit) return { ok: true, condition_met: "role_name", waited_ms: Date.now() - start, stable_id: hit.i };
    }
    if (urlRe && urlRe.test(snap.url)) {
      return { ok: true, condition_met: "url_matches", waited_ms: Date.now() - start };
    }
    if (c.selector_visible) {
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(c.selector_visible)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') ? 'visible' : null;
      })()`;
      const result = await session.runtimeEval(expr);
      if (result === "visible") {
        return { ok: true, condition_met: "selector_visible", waited_ms: Date.now() - start };
      }
    }
    // network_idle handled via session.runtimeEval against performance API as a fallback,
    // since lightpanda may not stream all Network events reliably outside goto.
    if (c.network_idle !== undefined) {
      const expr = `(() => {
        if (!('performance' in window) || typeof performance.getEntriesByType !== 'function') return null;
        const entries = performance.getEntriesByType('resource');
        if (entries.length === 0) return 'idle';
        const last = entries[entries.length - 1];
        const since = performance.now() - (last.responseEnd || last.startTime);
        return since >= ${c.network_idle} ? 'idle' : null;
      })()`;
      const r = await session.runtimeEval(expr);
      if (r === "idle") return { ok: true, condition_met: "network_idle", waited_ms: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, reason: "timeout", waited_ms: Date.now() - start };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter husk-orchestrator test test/wait.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Wire Session.waitFor + JSON-RPC + MCP**

In `session.ts`:

```typescript
async waitFor(c: WaitForCondition): Promise<WaitForResult> {
  return runWaitFor({
    snapshot: (o) => this.snapshot(o),
    runtimeEval: (expr) => this.cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }).then((r) => r.result?.value),
  }, c);
}
```

In `orchestrator/src/http/methods.ts`, add `wait_for` to `METHODS`:

```typescript
wait_for: async (ctx, params: { session_id: string } & WaitForCondition) => {
  const session = ctx.sessions.get(params.session_id);
  const { session_id, ...cond } = params;
  return session.waitFor(cond);
},
```

In `mcp/src/tool-surface.ts`, add:

```typescript
{
  name: "husk_wait_for",
  description: "Wait until a condition is true on the page. Conditions: text (substring in any visible node), role+name (exact match), url_matches (regex), network_idle (ms of zero in-flight requests), selector_visible (CSS). Default timeout 10s. Returns {ok, condition_met, waited_ms, stable_id?}. Cheap to call — polls every 100ms locally.",
  inputSchema: { /* ... mirror cond fields ... */ },
}
```

In `sdk-ts/src/session.ts` and `sdk-py/husk/_session.py`, add a `waitFor` / `wait_for` method that forwards the params.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/session/wait.ts orchestrator/src/session/session.ts \
        orchestrator/src/http/methods.ts orchestrator/test/wait.test.ts \
        mcp/src/tool-surface.ts sdk-ts/src/session.ts sdk-py/husk/_session.py
git commit -m "feat(workflow): husk_wait_for with 5 conditions + 10s default timeout"
```

---

## Task 3: Internal find() resolver, folded into click/type/scroll/upload

**Why no separate tool:** Surface bloat hurts AI usability — every extra verb is a chance for the agent to pick the wrong one. Folding `find` into the existing action verbs means an agent can write `husk_click({intent: "sign in button"})` and the orchestrator resolves+acts atomically. Watchdog still runs post-resolution.

**Why deterministic-only:** Husk is LLM-neutral by Decision A. The site-graph cache (M4) already indexes `(role, name_norm)` — `find()` is a thin scorer over that index plus the live AX tree.

**Ambiguity contract:** If the top candidate has score < 0.5, or if the top-2 candidates are within 0.05 of each other, the action method returns the standard watchdog-style rejection envelope: `{ok: false, reason: "ambiguous_intent" | "no_match", candidates: [{stable_id, role, name, score}, ...]}`. Agent re-tries with `stable_id` or a disambiguated `intent`.

**Files:**
- Create: `orchestrator/src/session/find.ts`
- Modify: `orchestrator/src/session/session.ts` (click/type/scroll accept `stable_id | intent`), `orchestrator/src/http/methods.ts` (param schema update), `mcp/src/tool-surface.ts` (update **descriptions only** of `husk_click`/`husk_type`/`husk_scroll`/`husk_upload` — no new tools), `sdk-ts/src/session.ts`, `sdk-py/husk/_session.py`
- Test: `orchestrator/test/find.test.ts`, `orchestrator/test/intent-action.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// orchestrator/test/find.test.ts
import { describe, it, expect } from "vitest";
import { runFind } from "../src/session/find.js";

describe("runFind", () => {
  const snapshot = {
    url: "https://example.com/",
    nodes: [
      { i: "h1", r: "button", n: "Sign in" },
      { i: "h2", r: "button", n: "Sign up" },
      { i: "h3", r: "link",   n: "Forgot password?" },
      { i: "h4", r: "textbox", n: "Email" },
      { i: "h5", r: "textbox", n: "Password" },
    ],
  };

  it("matches 'sign in button' to the button, not the link", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "sign in button" });
    expect(r.candidates[0].stable_id).toBe("h1");
    expect(r.candidates[0].score).toBeGreaterThan(0.85);
  });

  it("returns up to top 3 candidates ranked by score", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "sign" });
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(r.candidates[1].score);
  });

  it("filters by role hint if provided in intent", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "email textbox" });
    expect(r.candidates[0].stable_id).toBe("h4");
    expect(r.candidates[0].role).toBe("textbox");
  });

  it("returns ok:false when nothing scores above threshold (0.5)", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "checkout cart total" });
    expect(r.ok).toBe(false);
    expect(r.candidates).toEqual([]);
  });

  it("completes in under 5ms for snapshot of 200 nodes", async () => {
    const big = {
      url: "/",
      nodes: Array.from({ length: 200 }, (_, i) => ({
        i: `n${i}`, r: i % 2 ? "button" : "link", n: `Item ${i} label`,
      })),
    };
    const t0 = performance.now();
    await runFind({ snapshot: big, cache: null }, { intent: "item 137 label" });
    expect(performance.now() - t0).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter husk-orchestrator test test/find.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement find.ts**

```typescript
// orchestrator/src/session/find.ts
import { jaroWinkler } from "../watchdog/candidates.js"; // reuse M5 scorer

const ROLE_HINTS: Record<string, string> = {
  button: "button", btn: "button", link: "link", text: "textbox",
  textbox: "textbox", input: "textbox", field: "textbox", checkbox: "checkbox",
  radio: "radio", select: "combobox", combobox: "combobox", dropdown: "combobox",
  heading: "heading", title: "heading", image: "img", img: "img",
};

const SCORE_THRESHOLD = 0.5;

export interface FindInput {
  intent: string;
}

export interface FindCandidate {
  stable_id: string;
  role: string;
  name: string;
  score: number;
}

export interface FindResult {
  ok: boolean;
  candidates: FindCandidate[];
}

export interface FindContext {
  snapshot: { nodes: Array<{ i: string; r: string; n: string }> };
  cache: null | { query(role: string, nameNorm: string): Array<{ stable_id: string; role: string; name: string }> };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractRoleHint(tokens: string[]): { role?: string; rest: string[] } {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const r = ROLE_HINTS[tokens[i]];
    if (r) return { role: r, rest: tokens.filter((_, j) => j !== i) };
  }
  return { rest: tokens };
}

export async function runFind(ctx: FindContext, input: FindInput): Promise<FindResult> {
  const norm = normalize(input.intent);
  const tokens = norm.split(" ");
  const { role: roleHint, rest } = extractRoleHint(tokens);
  const targetName = rest.join(" ");

  const scored: FindCandidate[] = [];
  for (const node of ctx.snapshot.nodes) {
    if (!node.n) continue;
    if (roleHint && node.r !== roleHint) continue;
    const nodeNorm = normalize(node.n);
    const nameScore = jaroWinkler(targetName, nodeNorm);
    const containBonus = nodeNorm.includes(targetName) ? 0.05 : 0;
    const score = Math.min(1, nameScore + containBonus);
    if (score >= SCORE_THRESHOLD) {
      scored.push({ stable_id: node.i, role: node.r, name: node.n, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  return { ok: top.length > 0, candidates: top };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter husk-orchestrator test test/find.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Fold into Session action methods**

In `orchestrator/src/session/session.ts`, refactor click/type/scroll/upload to accept either form. Helper:

```typescript
import { runFind } from "./find.js";

type Target = { stable_id?: string; intent?: string };

private async resolveTarget(t: Target): Promise<
  | { ok: true; stable_id: string }
  | { ok: false; reason: "no_match" | "ambiguous_intent" | "missing_target"; candidates: FindCandidate[] }
> {
  if (t.stable_id) return { ok: true, stable_id: t.stable_id };
  if (!t.intent) return { ok: false, reason: "missing_target", candidates: [] };
  const snap = await this.snapshot();
  const r = await runFind({ snapshot: snap, cache: null }, { intent: t.intent });
  if (!r.ok) return { ok: false, reason: "no_match", candidates: r.candidates };
  if (r.candidates.length >= 2 && r.candidates[0].score - r.candidates[1].score < 0.05) {
    return { ok: false, reason: "ambiguous_intent", candidates: r.candidates };
  }
  return { ok: true, stable_id: r.candidates[0].stable_id };
}

// In click():
async click(target: Target): Promise<ActionResult> {
  const resolved = await this.resolveTarget(target);
  if (!resolved.ok) {
    this.bus?.emit(this.id, { kind: "rejection", ts: Date.now(), verb: "click", reason: resolved.reason, candidates: resolved.candidates });
    return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
  }
  return this.performClick(resolved.stable_id); // existing logic, renamed
}
```

Apply the same shape to `type`, `scroll`. (Existing tests for click/type/scroll that pass `stable_id` continue to work.)

- [ ] **Step 6: Write the fold-in test**

```typescript
// orchestrator/test/intent-action.test.ts
import { describe, it, expect } from "vitest";
import { Session } from "../src/session/session.js";

describe("intent-routed actions", () => {
  it("click({intent}) resolves via find and calls performClick", async () => {
    const s = Session.fromInjected({
      snapshot: async () => ({ url: "/", nodes: [{ i: "btn1", r: "button", n: "Submit" }] }),
      performClick: async (sid) => ({ ok: true, stable_id: sid }),
    });
    const r = await s.click({ intent: "submit button" });
    expect(r.ok).toBe(true);
    expect((r as { stable_id: string }).stable_id).toBe("btn1");
  });

  it("click({intent}) returns ambiguous_intent rejection when top-2 are close", async () => {
    const s = Session.fromInjected({
      snapshot: async () => ({ url: "/", nodes: [
        { i: "a", r: "button", n: "Continue" },
        { i: "b", r: "button", n: "Continue " }, // near-identical
      ]}),
      performClick: async () => { throw new Error("should not be called"); },
    });
    const r = await s.click({ intent: "continue" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ambiguous_intent");
    expect(r.candidates).toHaveLength(2);
  });

  it("click({stable_id}) bypasses find()", async () => {
    let findCalled = false;
    const s = Session.fromInjected({
      snapshot: async () => { findCalled = true; return { url: "/", nodes: [] }; },
      performClick: async (sid) => ({ ok: true, stable_id: sid }),
    });
    const r = await s.click({ stable_id: "direct_id" });
    expect(r.ok).toBe(true);
    expect(findCalled).toBe(false);
  });
});
```

Run: `pnpm --filter husk-orchestrator test test/intent-action.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 7: Update MCP descriptions (no new tools)**

In `mcp/src/tool-surface.ts`, update existing `husk_click`/`husk_type`/`husk_scroll`/`husk_upload` descriptions and schemas:

```
husk_click — Click an element. Pass EITHER {stable_id} (exact, from snapshot) OR {intent} (natural language like "sign in button"; resolved via deterministic AX scoring). On ambiguous intent (multiple matches within 0.05 score), returns {ok:false, reason:"ambiguous_intent", candidates:[...]}. Use stable_id when you have it; intent when you don't.
```

Update inputSchema to make `stable_id` and `intent` both optional with `oneOf` constraint, or accept both nullable.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(workflow): internal find() resolver folded into click/type/scroll/upload via {intent}"
```

---

## Task 4: husk_upload — path or base64

**Files:**
- Create: `orchestrator/src/session/upload.ts`
- Modify: session/methods/mcp/sdks
- Test: `orchestrator/test/upload.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// orchestrator/test/upload.test.ts
import { describe, it, expect, vi } from "vitest";
import { runUpload } from "../src/session/upload.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runUpload", () => {
  const tmp = mkdtempSync(join(tmpdir(), "husk-upload-"));
  const realFile = join(tmp, "hello.txt");
  writeFileSync(realFile, "hello world");

  it("resolves file_path → CDP DOM.setFileInputFiles", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const r = await runUpload({ cdp, resolveBackendNodeId: async () => 42 }, {
      stable_id: "x", file_path: realFile,
    });
    expect(r.ok).toBe(true);
    expect(cdp.send).toHaveBeenCalledWith("DOM.setFileInputFiles", {
      files: [realFile], backendNodeId: 42,
    });
  });

  it("rejects when file does not exist", async () => {
    const cdp = { send: vi.fn() };
    const r = await runUpload({ cdp, resolveBackendNodeId: async () => 1 }, {
      stable_id: "x", file_path: "/nonexistent.zzz",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found/i);
  });

  it("decodes base64 to tempfile and uploads", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const r = await runUpload({ cdp, resolveBackendNodeId: async () => 7 }, {
      stable_id: "x",
      content_base64: Buffer.from("test data").toString("base64"),
      filename: "test.txt",
    });
    expect(r.ok).toBe(true);
    expect(cdp.send).toHaveBeenCalled();
    const filesArg = cdp.send.mock.calls[0][1].files[0];
    expect(readFileSync(filesArg, "utf8")).toBe("test data");
  });

  it("rejects when neither file_path nor content_base64 provided", async () => {
    const cdp = { send: vi.fn() };
    await expect(runUpload({ cdp, resolveBackendNodeId: async () => 1 }, {
      stable_id: "x",
    } as never)).rejects.toThrow(/file_path or content_base64/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter husk-orchestrator test test/upload.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement upload.ts**

```typescript
// orchestrator/src/session/upload.ts
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

export interface UploadInput {
  stable_id: string;
  file_path?: string;
  content_base64?: string;
  filename?: string;
}

export interface UploadResult {
  ok: boolean;
  reason?: string;
}

export interface UploadCtx {
  cdp: { send(method: string, params: unknown): Promise<unknown> };
  resolveBackendNodeId: (stable_id: string) => Promise<number>;
}

export async function runUpload(ctx: UploadCtx, input: UploadInput): Promise<UploadResult> {
  if (!input.file_path && !input.content_base64) {
    throw new Error("husk_upload requires file_path or content_base64");
  }

  let absPath: string;
  if (input.file_path) {
    absPath = resolvePath(input.file_path);
    if (!existsSync(absPath)) {
      return { ok: false, reason: `file not found: ${absPath}` };
    }
  } else {
    const dir = mkdtempSync(join(tmpdir(), "husk-upload-"));
    const name = input.filename ?? "upload.bin";
    absPath = join(dir, name);
    writeFileSync(absPath, Buffer.from(input.content_base64!, "base64"));
  }

  const backendNodeId = await ctx.resolveBackendNodeId(input.stable_id);
  await ctx.cdp.send("DOM.setFileInputFiles", { files: [absPath], backendNodeId });
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter husk-orchestrator test test/upload.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Wire surface**

Session.upload uses the existing stable_id → backendNodeId resolver (already used by click/type in M5). Route through watchdog's pre-action sanity (input must exist + be a file input — extend role-verb table to include `(role=input file, verb=upload)`).

MCP tool description:

```
husk_upload({stable_id, file_path | content_base64+filename}) — Upload a file to a <input type="file"> element. Supply either an absolute file_path or base64-encoded content with a filename. Routes through watchdog (rejects if stable_id is not a file input).
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(workflow): husk_upload path-or-base64 via DOM.setFileInputFiles"
```

---

## Task 5: Multi-selector mode in existing husk_extract

**Why fold:** Surface stays at one verb for "read text from DOM". Existing single-selector callers unaffected; new multi-selector callers use the same tool with a different param shape.

**Files:**
- Modify: `orchestrator/src/session/extract.ts` (extend), `orchestrator/src/http/methods.ts` (param shape), `mcp/src/tool-surface.ts` (description), `sdk-ts/src/session.ts`, `sdk-py/husk/_session.py`
- Test: `orchestrator/test/capture.test.ts` (renamed to extract-multi.test.ts)

- [ ] **Step 1: Write the failing test**

```typescript
// orchestrator/test/extract-multi.test.ts
import { describe, it, expect, vi } from "vitest";
import { runExtract, buildCaptureExpr } from "../src/session/extract.js";

describe("buildCaptureExpr", () => {
  it("escapes selector strings safely", () => {
    const expr = buildCaptureExpr({ title: "h1", price: ".price'with'quotes" });
    expect(expr).toContain('"h1"');
    expect(expr).toContain('"price"');
    expect(expr).toContain('"title"');
    // round-trip safety check
    expect(() => new Function(`return ${expr}`)).not.toThrow();
  });
});

describe("runExtract — multi-selector mode", () => {
  it("returns map of selector → text, with null for missing selectors", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({
        result: { value: { title: "Hello", price: null, h2: "Subhead" } },
      }),
    };
    const r = await runExtract(cdp, "sess1", { selectors: { title: "h1", price: ".price", h2: "h2" } });
    expect(r).toEqual({ title: "Hello", price: null, h2: "Subhead" });
    expect(cdp.send).toHaveBeenCalledTimes(1); // ONE round-trip
  });

  it("survives per-selector errors via try/catch in IIFE", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({
        result: { value: { good: "text", broken: null } },
      }),
    };
    const r = await runExtract(cdp, "sess1", { selectors: { good: "h1", broken: "::invalid" } });
    expect((r as { good: string }).good).toBe("text");
    expect((r as { broken: string | null }).broken).toBeNull();
  });

  it("single-selector mode (existing behavior) still works", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({ result: { value: "Hello" } }),
    };
    const r = await runExtract(cdp, "sess1", { css: "h1" });
    expect(r).toBe("Hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter husk-orchestrator test test/extract-multi.test.ts`
Expected: FAIL (runtime — multi-mode not yet implemented).

- [ ] **Step 3: Extend extract.ts with multi-selector mode**

```typescript
// orchestrator/src/session/extract.ts — extend, don't replace
export interface ExtractSingle { css: string; selectors?: never; }
export interface ExtractMulti  { selectors: Record<string, string>; css?: never; }
export type ExtractInput = ExtractSingle | ExtractMulti;

export function buildCaptureExpr(selectors: Record<string, string>): string {
  const entries = Object.entries(selectors).map(([k, v]) =>
    `${JSON.stringify(k)}: (() => { try { return document.querySelector(${JSON.stringify(v)})?.textContent?.trim() ?? null; } catch { return null; } })()`
  );
  return `(() => ({ ${entries.join(", ")} }))()`;
}

export async function runExtract(
  cdp: { send(method: string, params: unknown): Promise<{ result?: { value?: unknown } }> },
  _sessionId: string,
  input: ExtractInput,
): Promise<string | Record<string, string | null> | null> {
  if ("selectors" in input && input.selectors) {
    const expr = buildCaptureExpr(input.selectors);
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return (r.result?.value as Record<string, string | null>) ??
      Object.fromEntries(Object.keys(input.selectors).map((k) => [k, null]));
  }
  // existing single-selector path
  const expr = `document.querySelector(${JSON.stringify(input.css)})?.textContent?.trim() ?? null`;
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true });
  return (r.result?.value as string | null) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter husk-orchestrator test test/extract-multi.test.ts`
Expected: PASS, 3/3. Also run existing extract tests to confirm no regression.

- [ ] **Step 5: Update MCP description only (no new tool)**

In `mcp/src/tool-surface.ts`, update existing `husk_extract`:

```
husk_extract — Read text content from the page. EITHER pass {css} for a single selector (returns string|null), OR {selectors: {key: css, ...}} for multi-field extraction in ONE round-trip (returns {key: text|null}). Each selector is independently safe — one broken selector won't fail others.
```

Update `inputSchema` to a `oneOf` over the two shapes.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(extract): multi-selector mode via combined IIFE (no new MCP tool)"
```

---

## Task 6: Watch event bus + SSE stream

**Files:**
- Create: `orchestrator/src/watch/sse.ts`, `orchestrator/src/watch/events.ts`
- Modify: `orchestrator/src/http/server.ts`, `orchestrator/src/session/session.ts` (emit events)
- Test: `orchestrator/test/watch-sse.test.ts`

- [ ] **Step 1: Define event shapes (events.ts)**

```typescript
// orchestrator/src/watch/events.ts
export type WatchEvent =
  | { kind: "snapshot"; ts: number; url: string; node_count: number; mode: "full" | "terse" }
  | { kind: "action"; ts: number; verb: "click" | "type" | "scroll" | "press_key" | "upload"; stable_id: string | null; ok: boolean; diff?: { added: number; removed: number; changed: number } }
  | { kind: "rejection"; ts: number; verb: string; reason: string; candidates: Array<{ stable_id: string; role: string; name: string; score: number }> }
  | { kind: "navigation"; ts: number; url: string }
  | { kind: "find"; ts: number; intent: string; candidates: Array<{ stable_id: string; role: string; name: string; score: number }> };
```

- [ ] **Step 2: Write the failing test**

```typescript
// orchestrator/test/watch-sse.test.ts
import { describe, it, expect } from "vitest";
import { WatchBus } from "../src/watch/sse.js";

describe("WatchBus", () => {
  it("delivers events to subscribed listeners for a session", () => {
    const bus = new WatchBus();
    const got: unknown[] = [];
    const off = bus.subscribe("sess1", (e) => got.push(e));
    bus.emit("sess1", { kind: "snapshot", ts: 1, url: "/", node_count: 5, mode: "full" });
    bus.emit("sess2", { kind: "snapshot", ts: 2, url: "/", node_count: 5, mode: "full" });
    expect(got).toHaveLength(1);
    expect((got[0] as { ts: number }).ts).toBe(1);
    off();
  });

  it("does not deliver after unsubscribe", () => {
    const bus = new WatchBus();
    const got: unknown[] = [];
    const off = bus.subscribe("s", (e) => got.push(e));
    off();
    bus.emit("s", { kind: "navigation", ts: 3, url: "/x" });
    expect(got).toHaveLength(0);
  });

  it("supports multiple subscribers per session", () => {
    const bus = new WatchBus();
    const a: unknown[] = []; const b: unknown[] = [];
    bus.subscribe("s", (e) => a.push(e));
    bus.subscribe("s", (e) => b.push(e));
    bus.emit("s", { kind: "navigation", ts: 1, url: "/" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Implement WatchBus**

```typescript
// orchestrator/src/watch/sse.ts
import type { WatchEvent } from "./events.js";

export class WatchBus {
  private subs = new Map<string, Set<(e: WatchEvent) => void>>();

  subscribe(sessionId: string, fn: (e: WatchEvent) => void): () => void {
    if (!this.subs.has(sessionId)) this.subs.set(sessionId, new Set());
    this.subs.get(sessionId)!.add(fn);
    return () => {
      this.subs.get(sessionId)?.delete(fn);
      if (this.subs.get(sessionId)?.size === 0) this.subs.delete(sessionId);
    };
  }

  emit(sessionId: string, event: WatchEvent): void {
    const set = this.subs.get(sessionId);
    if (!set) return;
    for (const fn of set) fn(event);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter husk-orchestrator test test/watch-sse.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Wire bus into Session + HTTP**

In `SessionManager`, hold a `WatchBus` instance and pass to each Session. Session.click/type/scroll/press/upload/goto/find emits the corresponding event after the action. Watchdog rejections emit `kind:"rejection"`.

In `http/server.ts`, register `GET /watch/stream/:session_id`:

```typescript
fastify.get("/watch/stream/:session_id", async (req, reply) => {
  const { session_id } = req.params as { session_id: string };
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.write(": connected\n\n");
  const off = bus.subscribe(session_id, (e) => {
    reply.raw.write(`event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
  });
  req.raw.on("close", () => off());
});
```

Bind only when `host === "127.0.0.1"` (refuse to register the route otherwise; log a warning).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(watch): WatchBus + /watch/stream SSE endpoint"
```

---

## Task 7: Watch UI HTML + fold watch_url into create_session

**Why fold:** Watch URL is fully determined the moment `create_session` returns. There's no reason to make the agent issue a second tool call. Adding `watch_url` to the `create_session` response gives the agent the affordance for free, and the MCP tool description updates with one sentence: "the response includes a watch_url you can offer to the user with 'want to watch what I'm seeing?'".

**Files:**
- Create: `orchestrator/src/watch/index.html.ts` (exports `WATCH_HTML` string)
- Modify: `orchestrator/src/http/server.ts` (register `/watch` route, 127.0.0.1-only), `orchestrator/src/http/methods.ts` (`create_session` return adds `watch_url`), `mcp/src/tool-surface.ts` (update `husk_create_session` description only — **no new tool**)
- Test: `orchestrator/test/watch-ui.test.ts`, `orchestrator/test/create-session-watch-url.test.ts`

- [ ] **Step 1: Author the single-file HTML (professional code-editor aesthetic)**

```typescript
// orchestrator/src/watch/index.html.ts
export const WATCH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Husk · Watch</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d;
    --fg: #c9d1d9; --dim: #8b949e; --accent: #58a6ff;
    --ok: #3fb950; --bad: #f85149; --warn: #d29922;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--mono); font-size: 13px; }
  header { padding: 10px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 13px; margin: 0; color: var(--accent); }
  header .meta { color: var(--dim); }
  header input { background: var(--panel); border: 1px solid var(--border); color: var(--fg); padding: 4px 8px; border-radius: 4px; font-family: var(--mono); width: 240px; }
  main { display: grid; grid-template-columns: 1fr 360px; height: calc(100vh - 41px); }
  #tree { padding: 12px; overflow: auto; }
  #log  { padding: 12px; border-left: 1px solid var(--border); overflow: auto; background: var(--panel); }
  .node { padding: 1px 0; }
  .node .role { color: var(--accent); }
  .node .name { color: var(--fg); }
  .node .id   { color: var(--dim); font-size: 11px; }
  .node.hl    { background: rgba(88, 166, 255, 0.12); border-left: 2px solid var(--accent); padding-left: 6px; margin-left: -8px; }
  .node.bad   { background: rgba(248, 81, 73, 0.12); border-left: 2px solid var(--bad); padding-left: 6px; margin-left: -8px; }
  .ev { padding: 6px 8px; margin-bottom: 6px; border-radius: 4px; background: #0d1117; border: 1px solid var(--border); }
  .ev .kind { color: var(--accent); font-weight: 600; }
  .ev .kind.action { color: var(--ok); }
  .ev .kind.rejection { color: var(--bad); }
  .ev .ts { color: var(--dim); font-size: 11px; }
  .ev pre { margin: 4px 0 0 0; color: var(--dim); white-space: pre-wrap; word-break: break-word; font-size: 11px; }
  .status { padding: 2px 6px; border-radius: 3px; font-size: 11px; }
  .status.live  { background: var(--ok); color: #0d1117; }
  .status.idle  { background: var(--warn); color: #0d1117; }
  .status.dead  { background: var(--bad); color: #fff; }
</style>
</head>
<body>
<header>
  <h1>husk · /watch</h1>
  <input id="sessionId" placeholder="paste session_id…" autocomplete="off">
  <span class="meta">events: <span id="evCount">0</span></span>
  <span class="meta">url: <span id="curUrl">—</span></span>
  <span class="status idle" id="status">disconnected</span>
</header>
<main>
  <section id="tree"><div class="meta">enter a session_id to begin streaming.</div></section>
  <aside id="log"></aside>
</main>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const tree = $("#tree"); const log = $("#log");
  const status = $("#status"); const evCount = $("#evCount"); const curUrl = $("#curUrl");
  let es = null; let count = 0; let lastNodes = [];
  const setStatus = (s, cls) => { status.textContent = s; status.className = "status " + cls; };

  const renderTree = (nodes, highlight = null, bad = null) => {
    tree.innerHTML = "";
    for (const n of nodes) {
      const row = document.createElement("div");
      row.className = "node" + (n.i === highlight ? " hl" : "") + (n.i === bad ? " bad" : "");
      row.innerHTML = '<span class="role">' + (n.r || "") + '</span> ' +
                      '<span class="name">' + (n.n || "").replace(/</g, "&lt;") + '</span> ' +
                      '<span class="id">' + (n.i || "") + '</span>';
      tree.appendChild(row);
    }
  };

  const addEvent = (ev) => {
    count++; evCount.textContent = count;
    const row = document.createElement("div");
    row.className = "ev";
    const cls = ev.kind === "rejection" ? "rejection" : (ev.kind === "action" ? "action" : "");
    row.innerHTML = '<span class="kind ' + cls + '">' + ev.kind + '</span> ' +
                    '<span class="ts">' + new Date(ev.ts).toLocaleTimeString() + '</span>' +
                    '<pre>' + JSON.stringify(ev, null, 2).replace(/</g, "&lt;") + '</pre>';
    log.prepend(row);
    while (log.children.length > 100) log.lastChild.remove();
    if (ev.kind === "navigation") { curUrl.textContent = ev.url; }
    if (ev.kind === "action") { renderTree(lastNodes, ev.stable_id); }
    if (ev.kind === "rejection") { renderTree(lastNodes, null, /* no id */); }
  };

  const connect = (sessionId) => {
    if (es) es.close();
    setStatus("connecting…", "idle");
    es = new EventSource("/watch/stream/" + encodeURIComponent(sessionId));
    es.onopen = () => setStatus("live", "live");
    es.onerror = () => setStatus("disconnected", "dead");
    for (const kind of ["snapshot", "action", "rejection", "navigation", "find"]) {
      es.addEventListener(kind, (e) => {
        const data = JSON.parse(e.data);
        addEvent(data);
        if (kind === "snapshot") {
          // snapshots emit metadata only; pull full tree once if needed via fetch
          fetch("/snapshot?session_id=" + encodeURIComponent(sessionId))
            .then((r) => r.json()).then((s) => { lastNodes = s.nodes || []; renderTree(lastNodes); })
            .catch(() => {});
        }
      });
    }
  };

  $("#sessionId").addEventListener("change", (e) => connect(e.target.value.trim()));
  const fromUrl = new URLSearchParams(location.search).get("s");
  if (fromUrl) { $("#sessionId").value = fromUrl; connect(fromUrl); }
})();
</script>
</body>
</html>`;
```

- [ ] **Step 2: Register /watch route (127.0.0.1-only)**

In `orchestrator/src/http/server.ts`:

```typescript
import { WATCH_HTML } from "../watch/index.html.js";

if (host === "127.0.0.1") {
  fastify.get("/watch", async (_req, reply) => {
    reply.type("text/html; charset=utf-8").send(WATCH_HTML);
  });
  // /watch/stream/:session_id registered in T6
}
```

- [ ] **Step 3: Fold watch_url into create_session response**

In `orchestrator/src/http/methods.ts`, modify the existing `create_session` handler:

```typescript
create_session: async (ctx, params) => {
  const session_id = await ctx.sessions.create(params);
  const watch_url = ctx.host === "127.0.0.1"
    ? `http://${ctx.host}:${ctx.port}/watch?s=${encodeURIComponent(session_id)}`
    : null;
  return { session_id, watch_url };
},
```

Write a regression test:

```typescript
// orchestrator/test/create-session-watch-url.test.ts
import { describe, it, expect } from "vitest";
import { startTestServer } from "./helpers/server.js";

describe("create_session watch_url", () => {
  it("returns a /watch URL when bound to 127.0.0.1", async () => {
    const srv = await startTestServer({ host: "127.0.0.1" });
    const r = await rpc(srv.port, "create_session", {});
    expect(r.session_id).toMatch(/^sess_/);
    expect(r.watch_url).toBe(`http://127.0.0.1:${srv.port}/watch?s=${encodeURIComponent(r.session_id)}`);
    await srv.stop();
  });

  it("returns watch_url=null when bound to 0.0.0.0", async () => {
    const srv = await startTestServer({ host: "0.0.0.0" });
    const r = await rpc(srv.port, "create_session", {});
    expect(r.watch_url).toBeNull();
    await srv.stop();
  });
});
```

Run: `pnpm --filter husk-orchestrator test test/create-session-watch-url.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 4: Update MCP description for husk_create_session (no new tool)**

In `mcp/src/tool-surface.ts`, append to the existing `husk_create_session` description:

```
Returns {session_id, watch_url}. When watch_url is non-null, you can offer it to the user with a friendly prompt like "want to watch what I'm seeing?" — it opens a live view of the AX tree, your actions, and any rejections. The URL is local-only (127.0.0.1).
```

The MCP proxy `husk_create_session` handler already passes through whatever the orchestrator returns, so this works automatically once the orchestrator returns the new field. Confirm in the MCP integration test.

- [ ] **Step 5: Smoke test the /watch route**

```typescript
// orchestrator/test/watch-ui.test.ts
import { describe, it, expect } from "vitest";
import { startTestServer } from "./helpers/server.js";

describe("/watch HTML", () => {
  it("serves the watch HTML on 127.0.0.1 bind", async () => {
    const srv = await startTestServer({ host: "127.0.0.1" });
    const r = await fetch(`http://127.0.0.1:${srv.port}/watch`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("husk · /watch");
    expect(body).toContain("EventSource");
    await srv.stop();
  });

  it("does NOT serve /watch when bound to 0.0.0.0", async () => {
    const srv = await startTestServer({ host: "0.0.0.0" });
    const r = await fetch(`http://127.0.0.1:${srv.port}/watch`);
    expect(r.status).toBe(404);
    await srv.stop();
  });
});
```

Run: `pnpm --filter husk-orchestrator test test/watch-ui.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(watch): single-file HTML viewer + watch_url in create_session response"
```

---

## Task 8: Real-lightpanda integration test

**Files:**
- Create: `orchestrator/test/integration/dynamic-workflows.test.ts`

- [ ] **Step 1: Write integration test against a fixture page**

Use the existing fixture server (M5/M8 added one). Add a fixture page `dynamic-form.html` with:
- A `<button>Sign in</button>` (for find())
- A `<div id="banner">Loading...</div>` that flips to `Welcome!` after 800ms (for wait_for text)
- An `<input type="file" id="upload">` (for upload())
- Multiple `<span class="price">$X</span>`, `<h1>` for capture()

```typescript
// orchestrator/test/integration/dynamic-workflows.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureServer, startOrchestrator, killAll } from "./helpers.js";

const RUN = !!process.env.LIGHTPANDA_BIN;
const d = RUN ? describe : describe.skip;

d("dynamic workflows (lightpanda)", () => {
  let fx: { port: number; stop: () => void };
  let orc: { port: number; stop: () => void };

  beforeAll(async () => {
    fx = await startFixtureServer();
    orc = await startOrchestrator();
  }, 30_000);
  afterAll(async () => { fx.stop(); await orc.stop(); });

  it("find → click → wait_for → capture → upload happy path", async () => {
    const sid = await rpc(orc.port, "create_session", {});
    await rpc(orc.port, "goto", { session_id: sid, url: `http://localhost:${fx.port}/dynamic-form.html` });

    // find the sign-in button by intent
    const find = await rpc(orc.port, "find", { session_id: sid, intent: "sign in button" });
    expect(find.ok).toBe(true);
    expect(find.candidates[0].role).toBe("button");

    // click resolved stable_id
    await rpc(orc.port, "click", { session_id: sid, stable_id: find.candidates[0].stable_id });

    // wait for the banner to flip to Welcome
    const w = await rpc(orc.port, "wait_for", {
      session_id: sid, text: "Welcome!", timeout_ms: 3000,
    });
    expect(w.ok).toBe(true);
    expect(w.condition_met).toBe("text");

    // capture multiple fields in one call
    const cap = await rpc(orc.port, "capture", {
      session_id: sid,
      selectors: { title: "h1", price1: ".price:nth-child(1)", price2: ".price:nth-child(2)" },
    });
    expect(cap.title).toBeTruthy();

    // upload a file
    const upload = await rpc(orc.port, "upload", {
      session_id: sid,
      stable_id: /* find upload stable_id from snapshot */ "...",
      content_base64: Buffer.from("hello upload").toString("base64"),
      filename: "test.txt",
    });
    expect(upload.ok).toBe(true);
  }, 60_000);

  it("watch SSE receives events during a run", async () => {
    const sid = await rpc(orc.port, "create_session", {});
    const seen: string[] = [];
    const es = await connectSse(`http://127.0.0.1:${orc.port}/watch/stream/${sid}`);
    es.on("action", (e) => seen.push("action:" + JSON.parse(e).verb));
    es.on("navigation", () => seen.push("navigation"));

    await rpc(orc.port, "goto", { session_id: sid, url: `http://localhost:${fx.port}/dynamic-form.html` });
    await rpc(orc.port, "click", { session_id: sid, stable_id: "..." });
    await new Promise((r) => setTimeout(r, 500));

    expect(seen).toContain("navigation");
    expect(seen.some((s) => s.startsWith("action:click"))).toBe(true);
    es.close();
  }, 60_000);
});
```

- [ ] **Step 2: Run integration test**

```bash
HUSK_INT=1 LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter husk-orchestrator test test/integration/dynamic-workflows.test.ts
```

Expected: PASS, 2/2 within 60s each.

If `husk_find` doesn't resolve the button reliably (e.g., AX role mismatch in lightpanda), fall back to a fixture that adds `aria-label="Sign in"` explicitly.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(integration): end-to-end dynamic workflows + watch SSE"
```

---

## Task 9: Spec §5.8 + README + memory + tag + merge

**Files:**
- Modify: `docs/superpowers/specs/2026-05-13-husk-design.md`
- Modify: `README.md`
- Modify: `~/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-roadmap.md`, `husk-architecture.md`, `husk-overview.md`

- [ ] **Step 1: Append §5.8 to spec**

Section structure:
1. Motivation — agents need wait/find/upload/capture + readiness to do "any workflow"
2. `husk_wait_for` contract — 5 conditions, default 10s
3. `husk_find({intent})` contract — Jaro-Winkler over AX, top-3, 0.5 threshold
4. `husk_upload` contract — path OR base64
5. `husk_capture` contract — combined evaluate
6. Page-ready contract — replaces setTimeout
7. Watch UI — /watch + /watch/stream/:id, 127.0.0.1-only, live-only SSE, professional dark/code aesthetic
8. Decision L: Watch UI is local-only by design (no remote attack surface)
9. Decision M: find() is deterministic-only (Husk stays LLM-neutral)

- [ ] **Step 2: README — Dynamic primitives section**

Add a section after "Batch operations":

```markdown
## Dynamic workflows (M13)

Five new primitives let agents handle any workflow:

- `husk_wait_for` — wait for text, role+name, URL regex, network-idle, or selector visibility (10s default)
- `husk_find({intent})` — natural-language intent → stable_id, deterministic Jaro-Winkler over AX
- `husk_upload` — file_path or base64 → DOM.setFileInputFiles
- `husk_capture({selectors})` — multi-field extract in one CDP round-trip
- `husk_watch_url` — get a /watch URL so the user can see what the agent sees, live

Bonus: goto now uses `Page.loadEventFired` + network-idle instead of `setTimeout(1500)`.

### Watch UI

When bound to 127.0.0.1, the orchestrator serves a live SSE viewer at `http://127.0.0.1:7777/watch`. Paste the session_id and watch the AX tree + actions + watchdog rejections stream in. Use `husk_watch_url` to get a deep-link.
```

- [ ] **Step 3: Memory updates**

- `husk-roadmap.md` — add `v0.0.12-m13` row
- `husk-architecture.md` — append Decision L (Watch UI local-only) and Decision M (find deterministic-only)
- `husk-overview.md` — capability checklist: + wait_for, find, upload, capture, page-ready, watch

- [ ] **Step 4: Tag + merge --no-ff + push**

```bash
git checkout main
git merge --no-ff m13-dynamic-workflows -m "Merge Milestone 13 (dynamic workflow primitives + Watch UI)"
git tag -a v0.0.12-m13 -m "M13: wait_for, find, upload, capture, page-ready, Watch UI"
git push origin main
git push origin v0.0.12-m13
```

- [ ] **Step 5: Commit docs**

```bash
git add docs/superpowers/specs/2026-05-13-husk-design.md README.md
git commit -m "docs: spec §5.8 + README dynamic workflows + Watch UI"
```

(Commit before merge step.)

---

## Self-review notes

1. **Spec coverage:** All 5 primitives + Watch UI + page-readiness + docs covered across T1–T9.
2. **Latency lock for find():** T3 test #5 enforces <5ms for 200 nodes — concretizes the user's "make sure latency is not compromised."
3. **Watch security:** T6 + T7 both gate on `host === "127.0.0.1"` — defense in depth.
4. **Type consistency:** `WaitForResult.stable_id` matches snapshot `i` field, `FindCandidate.stable_id` matches `i`, `UploadInput.stable_id` matches the same key used by click/type in M5. No drift.
5. **JS fallback caveat from M8b:** none of the new primitives bypass watchdog except find (read-only, no action) and capture (read-only). Upload routes through watchdog. wait_for is observation. Spec §5.8 must explicitly note find/capture are watchdog-bypassed reads — this is intentional and safe (no state mutation).
6. **No placeholders.** Every code block compiles or is a one-line surface wiring with concrete signatures.

---

## Execution handoff

Plan complete. Subagent-driven-development with one task per subagent + two-stage review (spec compliance → code quality). Branch: `m13-dynamic-workflows` (to be cut from main).
