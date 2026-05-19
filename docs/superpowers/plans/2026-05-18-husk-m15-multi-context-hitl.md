# Husk M15 — Multi-Context + Human-in-the-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Give agents the missing primitives for *collaborative* browsing — multi-tab sessions, the ability to ask the human a question, and a clean handoff for things only a human can solve (captchas, 2FA emails, judgment calls). The Watch UI becomes a two-way channel between the agent and the user.

**MCP surface change:** **+2 tools** (`husk_ask_human`, `husk_handoff`). Multi-tab folds into existing `husk_create_session`. Dialog handling and Shadow DOM fold into snapshot. Tab listing folds into snapshot. Surface goes 18 → 20.

**Tech stack:** TypeScript orchestrator. New Hono routes under `/handoff/*` and `/ask/*` (127.0.0.1-only, same gating as `/watch`). New WatchBus event types (`pending_question`, `pending_handoff`, `resumed`). CDP `Page.javascriptDialogOpening` for modal-dialog auto-handling. CDP `Runtime.evaluate` over Shadow DOM roots for piercing. Better-sqlite3 for handoff-token storage (short-lived, in-memory cache OK for v1).

**Spec references:** §5.10 (NEW — Multi-Context + HITL). Lands in T9.

---

## Walkthrough 1: Handoff flow (the captcha case)

```
┌──────────┐                  ┌────────────┐                  ┌──────────┐
│  Agent   │                  │ Husk       │                  │  Human   │
│ (Claude) │                  │ orchestr.  │                  │ (browser)│
└────┬─────┘                  └─────┬──────┘                  └────┬─────┘
     │  husk_click(submit)         │                                 │
     │ ───────────────────────────►│                                 │
     │                              │ lightpanda hits captcha         │
     │                              │ ◄─────── 403 / challenge        │
     │  watchdog rejects "blocked"  │                                 │
     │ ◄────────────────────────────│                                 │
     │                              │                                 │
     │  husk_handoff({              │                                 │
     │    reason: "captcha",        │                                 │
     │    suggested:                │                                 │
     │      "complete the           │                                 │
     │       hCaptcha challenge",   │                                 │
     │    need_cookies_back: true   │                                 │
     │  })                          │                                 │
     │ ───────────────────────────►│                                 │
     │                              │ session.status = "handoff"      │
     │                              │ token = mint()                  │
     │                              │ Watch UI emits 'pending_handoff'│
     │  [BLOCKED — agent waits]     │                                 │
     │                              │                                 │
     │      [Agent's chat reply     │                                 │
     │       includes the handoff   │                                 │
     │       URL — Claude tells     │                                 │
     │       user "I hit a captcha. │                                 │
     │       Please open this URL:  │                                 │
     │       http://127.0.0.1:7777/ │                                 │
     │       handoff/abc123"]       │                                 │
     │                              │                                 │
     │                              │              ◄───── GET /handoff/abc123
     │                              │              ─────► HTML page with:
     │                              │                     - reason + suggested action
     │                              │                     - "Open in browser" link to current_url
     │                              │                     - Cookie paste textarea + bookmarklet
     │                              │                     - "Resume agent" button
     │                              │                                 │
     │                              │                Human opens current_url in Chrome
     │                              │                Solves captcha   │
     │                              │                Captures cookies via bookmarklet OR devtools
     │                              │                                 │
     │                              │              ◄───── POST /handoff/abc123/resume
     │                              │                     body: { cookies?: [...], note?: "done" }
     │                              │ Import cookies via CDP          │
     │                              │ Network.setCookies              │
     │                              │ session.status = "active"       │
     │                              │ Watch UI emits 'resumed'        │
     │                              │              ─────► "Resumed!"  │
     │                              │                                 │
     │  husk_handoff returns:       │                                 │
     │    { resumed: true,          │                                 │
     │      ms_paused: 47210,       │                                 │
     │      cookies_imported: 4,    │                                 │
     │      human_note: "done" }    │                                 │
     │ ◄────────────────────────────│                                 │
     │                              │                                 │
     │  husk_click(submit)  [retry] │                                 │
     │ ───────────────────────────► (now passes — captcha solved)     │
```

### Design notes

- **Pause semantics**: while `session.status === "handoff"`, ANY subsequent JSON-RPC method on that session returns `{ok: false, reason: "session_paused", handoff_url}`. The agent's `husk_handoff` call itself stays blocked (long-poll) until the human resolves it or `timeout_ms` elapses.
- **Cookie capture options for the human** (pick one — v1 supports all three):
  1. **Bookmarklet** (one-click): `javascript:fetch("http://127.0.0.1:7777/handoff/{token}/resume",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({cookies:document.cookie.split(";").map(c=>({raw:c.trim()}))})})`. The handoff page generates the exact bookmarklet, user drags it to bookmarks bar once.
  2. **Devtools paste**: page has a textarea — user pastes the output of `document.cookie` from devtools console.
  3. **Just click "Done"** (no cookie transfer): for non-captcha handoffs where the cookies in lightpanda are already enough. Agent gets `{cookies_imported: 0}` and retries blindly.
- **Cross-origin caveat**: bookmarklets read cookies of the page they run on. The human must be on the *same domain* as `current_url` when they click the bookmarklet.
- **Timeout**: `husk_handoff({timeout_ms: 600_000})` (default 10 min). On timeout, returns `{resumed: false, reason: "timeout"}` and the agent decides whether to abort or retry.

---

## Walkthrough 2: Multi-tab flow (comparison shopping)

```
┌──────────┐                ┌────────────┐
│  Agent   │                │ Husk       │
└────┬─────┘                └─────┬──────┘
     │  husk_create_session()    │
     │ ──────────────────────────►│  → s1 (parent, root of tab group)
     │ ◄── { session_id: "s1" }  │
     │                            │
     │  husk_goto(s1, amazon.com/widget)
     │ ──────────────────────────►│
     │                            │
     │  husk_create_session({     │
     │    parent_session_id: s1   │
     │  })                        │
     │ ──────────────────────────►│  → s2 (sibling tab, shares cookie profile with s1)
     │ ◄── { session_id: "s2" }  │
     │                            │
     │  husk_goto(s2, walmart.com/widget)
     │ ──────────────────────────►│
     │                            │
     │  husk_snapshot(s1)         │  → { ..., sibling_sessions: ["s2"] }
     │  husk_snapshot(s2)         │  → { ..., sibling_sessions: ["s1"] }
     │                            │
     │  husk_extract(s1, ...)     │
     │  husk_extract(s2, ...)     │  agent compares prices in parallel
     │                            │
     │  husk_close_session(s2)    │
     │  husk_close_session(s1)    │  closing parent also closes children (group teardown)
```

### Design notes

- **Tab group** = a set of sessions sharing a cookie profile (per M8a vault). The first session in the group is the parent; subsequent sessions created with `parent_session_id` are children. The group dies when the parent dies.
- **`snapshot.sibling_sessions: string[]`** lists all siblings (including the parent if you're a child). Agent never needs a separate `husk_list_tabs` call.
- **Each tab is an independent engine process** — they don't share JS state or DOM. They DO share cookies via the vault profile. This is functionally what real browser tabs do.
- **`husk_close_session(parent)` cascades** — closes all children too.

---

## Walkthrough 3: Ask-human flow (decision points)

```
┌──────────┐                ┌────────────┐                ┌──────────┐
│  Agent   │                │ Husk       │                │  Human   │
└────┬─────┘                └─────┬──────┘                └────┬─────┘
     │  husk_ask_human({         │                                │
     │    question:              │                                │
     │      "Two products match. │                                │
     │       Pick one:",         │                                │
     │    options: [             │                                │
     │      "Acme Widget $19",   │                                │
     │      "Beta Widget $22"    │                                │
     │    ],                     │                                │
     │    timeout_ms: 300000     │                                │
     │  })                       │                                │
     │ ──────────────────────────►│                                │
     │                            │ Watch UI emits                 │
     │                            │ 'pending_question'             │
     │                            │              ─────► (chip in UI)│
     │                            │                                │
     │   [agent blocks]           │                                │
     │                            │                                │
     │                            │              ◄───── (clicks option 0)
     │                            │              POST /ask/abc/answer
     │                            │              body: { answer: "Acme Widget $19", index: 0 }
     │                            │                                │
     │  returns:                  │                                │
     │    { answer: "Acme...",    │                                │
     │      index: 0,             │                                │
     │      ms_waited: 8421 }     │                                │
     │ ◄──────────────────────────│                                │
```

### Design notes

- **Free-form questions**: if `options` is omitted, the Watch UI shows a textarea instead of buttons. Returns `{answer: "<typed text>"}`.
- **Multiple selection (future)**: not in v1.
- **Timeout returns `{timed_out: true}`** — agent decides retry/abort.

---

## File structure

**New files:**
- `orchestrator/src/session/tab-group.ts` — parent-child tracking; `getSiblings(sessionId)`; cascade-close
- `orchestrator/src/session/dialog-handler.ts` — auto-handle `Page.javascriptDialogOpening`
- `orchestrator/src/snapshot/shadow-walker.ts` — extend AX-tree walk to pierce shadow roots
- `orchestrator/src/hitl/types.ts` — `PendingQuestion`, `PendingHandoff`, `HumanIOEvent`
- `orchestrator/src/hitl/bus.ts` — `HumanIOBus` (mints tokens, manages pending state, resolve hooks)
- `orchestrator/src/http/hitl-routes.ts` — `GET /handoff/:token`, `POST /handoff/:token/resume`, `POST /ask/:token/answer` (127.0.0.1-gated)
- `orchestrator/src/http/handoff-page.html.ts` — exports `HANDOFF_HTML` (single-file viewer like Watch)
- 6 test files

**Modified files:**
- `orchestrator/src/session/session.ts` — gates non-handoff RPC when paused; auto-handles dialogs; cookie import on resume
- `orchestrator/src/session/manager.ts` — tab-group accounting; cascade close
- `orchestrator/src/snapshot/types.ts` — `sibling_sessions?: string[]`; `dialog?: PendingDialog`
- `orchestrator/src/snapshot/adapter.ts` — call shadow-walker
- `orchestrator/src/http/methods.ts` — `create_session` accepts `parent_session_id`; new `ask_human`, `handoff`; `dialog` opt-in method
- `orchestrator/src/http/server.ts` — register hitl routes (127.0.0.1-gated)
- `orchestrator/src/watch/events.ts` — add `pending_question`, `pending_handoff`, `resumed` events
- `orchestrator/src/watch/index.html.ts` — Watch UI v2: chat box + tab list + status badge
- `mcp/src/tool-surface.ts` — add `husk_ask_human`, `husk_handoff`; update `husk_create_session` description
- SDKs (TS + Py)
- Spec §5.10 + README + memory

---

## Task map

| # | Task | Surface change | Model | Est |
|---|---|---|---|---|
| T1 | Tab group accounting + `parent_session_id` + `sibling_sessions` in snapshot + cascade close | snapshot field + create_session param | Sonnet | 2.5h |
| T2 | Dialog auto-handler (auto-dismiss by default) + `husk_dialog({action})` opt-in + `snapshot.dialog` | snapshot field + new opt-in method | Sonnet | 2h |
| T3 | Shadow DOM piercing in AX walker | snapshot internal | Sonnet | 2h |
| T4 | HumanIOBus + handoff/ask token mint/resolve + session pause/resume | infra | Sonnet | 2.5h |
| T5 | `husk_ask_human` — RPC method + MCP tool + SDKs + tests | **+1 new MCP tool** | Sonnet | 2h |
| T6 | `husk_handoff` — RPC method + MCP tool + `/handoff/:token` page + cookie paste-back + SDKs | **+1 new MCP tool** | Sonnet | 3h |
| T7 | Watch UI v2 — chat box for ask, status badge + handoff banner, tab list | embedded HTML | Sonnet | 2.5h |
| T8 | Real-lightpanda integration test (full handoff round-trip + multi-tab + ask-human) | tests | Sonnet | 2h |
| T9 | Spec §5.10 + README + memory + tag v0.0.14-m15 + merge --no-ff + push | docs | Haiku | 1h |

**Total:** 9 tasks, ~19.5h (~2 days). **+2 MCP tools** (20 total after M15).

---

## Task 1 — Tab group accounting

**Files:**
- Create: `orchestrator/src/session/tab-group.ts`
- Modify: `orchestrator/src/session/manager.ts`, `orchestrator/src/session/session.ts`, `orchestrator/src/snapshot/types.ts`, `orchestrator/src/http/methods.ts`
- Test: `orchestrator/tests/session/tab-group.test.ts`

### Steps

- [ ] **Step 1: Failing test**

```typescript
// orchestrator/tests/session/tab-group.test.ts
import { describe, it, expect } from "vitest";
import { TabGroup } from "../../src/session/tab-group.js";

describe("TabGroup", () => {
  it("first session is root of its own group; no siblings", () => {
    const g = new TabGroup();
    g.register("s1", null);
    expect(g.siblings("s1")).toEqual([]);
  });

  it("child registered with parent_session_id lists parent as sibling", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    expect(g.siblings("s1")).toEqual(["s2"]);
    expect(g.siblings("s2")).toEqual(["s1"]);
  });

  it("three siblings see each other", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    g.register("s3", "s1");
    expect(g.siblings("s1").sort()).toEqual(["s2", "s3"]);
    expect(g.siblings("s2").sort()).toEqual(["s1", "s3"]);
  });

  it("closing root returns ALL session ids in the group (cascade)", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    g.register("s3", "s2");
    const toClose = g.closeGroup("s1");
    expect(toClose.sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("closing a non-root child only closes that child", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    g.register("s3", "s1");
    expect(g.closeGroup("s2")).toEqual(["s2"]);
    expect(g.siblings("s1")).toEqual(["s3"]);
  });

  it("registering with unknown parent throws", () => {
    const g = new TabGroup();
    expect(() => g.register("s2", "ghost")).toThrow(/unknown parent/);
  });
});
```

- [ ] **Step 2: Implement `orchestrator/src/session/tab-group.ts`**

```typescript
export class TabGroup {
  // session_id → root_id (root is its own group)
  private rootOf = new Map<string, string>();
  // root_id → set of member session_ids
  private members = new Map<string, Set<string>>();

  register(sessionId: string, parentSessionId: string | null): void {
    if (parentSessionId === null) {
      this.rootOf.set(sessionId, sessionId);
      this.members.set(sessionId, new Set([sessionId]));
      return;
    }
    const root = this.rootOf.get(parentSessionId);
    if (!root) throw new Error(`unknown parent session: ${parentSessionId}`);
    this.rootOf.set(sessionId, root);
    this.members.get(root)!.add(sessionId);
  }

  siblings(sessionId: string): string[] {
    const root = this.rootOf.get(sessionId);
    if (!root) return [];
    return [...this.members.get(root)!].filter((id) => id !== sessionId);
  }

  /** If the closed session is the group root, returns ALL group members for cascade close.
   *  Otherwise returns just the closed session. */
  closeGroup(sessionId: string): string[] {
    const root = this.rootOf.get(sessionId);
    if (!root) return [sessionId];
    if (root === sessionId) {
      const ids = [...this.members.get(root)!];
      // tear down
      for (const id of ids) this.rootOf.delete(id);
      this.members.delete(root);
      return ids;
    }
    // single child close
    this.members.get(root)!.delete(sessionId);
    this.rootOf.delete(sessionId);
    return [sessionId];
  }
}
```

- [ ] **Step 3: Wire into SessionManager**

In `orchestrator/src/session/manager.ts`:
- Add `private tabGroup = new TabGroup();`
- In `create(opts: { parent_session_id?: string; ... })`: if `parent_session_id` is set, look up the parent session, inherit its `profile` (cookie vault profile), then `tabGroup.register(newSid, parent_session_id)`. Otherwise `tabGroup.register(newSid, null)`.
- In `close(sessionId)`: call `tabGroup.closeGroup(sessionId)` → returns list of session ids to close, iterate and close them all.

- [ ] **Step 4: Expose siblings in snapshot**

In `orchestrator/src/snapshot/types.ts`, extend Snapshot:
```typescript
sibling_sessions?: string[];
```

In `Session.snapshot`, attach `snap.sibling_sessions = this.tabGroup?.siblings(this.id) ?? [];` (the tab group reference is passed from SessionManager at session creation).

- [ ] **Step 5: HTTP method signature**

`orchestrator/src/http/methods.ts`:
```typescript
create_session: async (ctx, params: { profile?: string; parent_session_id?: string }) => {
  const session_id = await ctx.sessions.create({
    profile: params.profile,
    parent_session_id: params.parent_session_id,  // NEW
  });
  const watch_url = ctx.host === "127.0.0.1" && ctx.portRef
    ? `http://${ctx.host}:${ctx.portRef.value}/watch?s=${encodeURIComponent(session_id)}`
    : null;
  return { session_id, watch_url };
},
```

- [ ] **Step 6: MCP description update for husk_create_session**

Append to existing description:
```
WHEN TO USE WITH parent_session_id: To open another tab in the same browser context (shared cookies), pass {parent_session_id: existing_session_id}. The new session is a sibling. snapshot.sibling_sessions lists all tabs in the group. Use this for comparison shopping, multi-account workflows, or any task where two URLs share login state. husk_close_session on the root tears down the whole group.
```

- [ ] **Step 7: Verify + commit**

Run unit + integration suites. Commit:
```
feat(session): parent_session_id + sibling_sessions in snapshot (multi-tab v1)
```

---

## Task 2 — Dialog handler

**Files:**
- Create: `orchestrator/src/session/dialog-handler.ts`
- Modify: `orchestrator/src/session/session.ts`, `orchestrator/src/snapshot/types.ts`, `orchestrator/src/http/methods.ts`, `mcp/src/tool-surface.ts`
- Test: `orchestrator/tests/session/dialog-handler.test.ts`

### Why this matters

Modern web apps trigger `alert()`/`confirm()`/`prompt()` for things like "Are you sure?" — these block JS execution and currently cause undefined behavior in Husk. Default behavior: auto-dismiss after 100ms (so the page unblocks). Opt-in `husk_dialog({action: "accept"|"dismiss", text?})` for the rare case where the agent wants to actually interact.

### Steps

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { DialogHandler } from "../../src/session/dialog-handler.js";

describe("DialogHandler", () => {
  it("auto-dismisses by default after the first event", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const h = new DialogHandler(cdp);
    h.onDialog({ type: "alert", message: "Are you sure?", url: "/" });
    await new Promise((r) => setTimeout(r, 150));
    expect(cdp.send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
      accept: false,
      promptText: undefined,
    });
  });

  it("snapshot exposes pending dialog if one is open and not yet auto-dismissed", () => {
    const cdp = { send: vi.fn() };
    const h = new DialogHandler(cdp);
    h.onDialog({ type: "confirm", message: "Delete?", url: "/x" });
    expect(h.pending()).toEqual({ type: "confirm", message: "Delete?" });
  });

  it("manualHandle accepts a dialog with prompt text", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const h = new DialogHandler(cdp);
    h.onDialog({ type: "prompt", message: "Your name?", url: "/" });
    await h.manualHandle("accept", "Husk");
    expect(cdp.send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
      accept: true, promptText: "Husk",
    });
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// orchestrator/src/session/dialog-handler.ts
interface DialogEvent { type: "alert" | "confirm" | "prompt" | "beforeunload"; message: string; url: string; }
export interface PendingDialog { type: DialogEvent["type"]; message: string; }

export class DialogHandler {
  private current: DialogEvent | null = null;
  private autoTimer: NodeJS.Timeout | null = null;
  private readonly autoMs = 100;

  constructor(private cdp: { send(m: string, p: unknown): Promise<unknown> }) {}

  onDialog(e: DialogEvent): void {
    this.current = e;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      if (this.current === e) {
        void this.cdp.send("Page.handleJavaScriptDialog", { accept: false, promptText: undefined }).catch(() => {});
        this.current = null;
      }
    }, this.autoMs);
  }

  pending(): PendingDialog | null {
    if (!this.current) return null;
    return { type: this.current.type, message: this.current.message };
  }

  async manualHandle(action: "accept" | "dismiss", text?: string): Promise<void> {
    if (!this.current) return;
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
    await this.cdp.send("Page.handleJavaScriptDialog", {
      accept: action === "accept",
      promptText: text,
    });
    this.current = null;
  }
}
```

- [ ] **Step 3: Wire into Session**

In Session.create, after Page.enable:
```typescript
this.dialogHandler = new DialogHandler(this.cdp);
this.cdp.on("Page.javascriptDialogOpening", (params) => this.dialogHandler.onDialog(params as DialogEvent));
```

In `Session.snapshot()`, attach:
```typescript
const pending = this.dialogHandler?.pending();
if (pending) snap.dialog = pending;
```

In `orchestrator/src/snapshot/types.ts`, add `dialog?: PendingDialog`.

- [ ] **Step 4: Add `husk_dialog` opt-in method**

`orchestrator/src/http/methods.ts`:
```typescript
dialog: async (ctx, params: { session_id: string; action: "accept" | "dismiss"; text?: string }) => {
  const session = ctx.sessions.get(params.session_id);
  await session.handleDialog(params.action, params.text);
  return { ok: true };
},
```

Add `Session.handleDialog(action, text?)` that forwards to `dialogHandler.manualHandle()`.

- [ ] **Step 5: MCP `husk_dialog` tool**

Wait — this would be a 3rd new MCP tool. Per Decision N, dialog handling is genuinely distinct (a verb you can only do when a dialog is open). But it's also rare. **Decision: do NOT add `husk_dialog` as a top-level MCP tool in M15.** Auto-dismiss handles 99% of cases. If the agent needs to respond to a `prompt` with a value, they can use the JSON-RPC method directly (advanced caller) but not expose to MCP. Re-evaluate in M16.

The orchestrator HTTP method exists. SDKs expose it. MCP does not. Documented behavior.

- [ ] **Step 6: Commit**

```
feat(session): auto-dismiss JS dialogs + opt-in manual handling
```

---

## Task 3 — Shadow DOM piercing

**Files:**
- Create: `orchestrator/src/snapshot/shadow-walker.ts`
- Modify: `orchestrator/src/snapshot/adapter.ts` (or wherever the AX walk happens)
- Test: `orchestrator/tests/snapshot/shadow-walker.test.ts`

### Steps

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { walkWithShadow } from "../../src/snapshot/shadow-walker.js";

describe("walkWithShadow", () => {
  it("queries shadow roots and merges their children into the AX tree", async () => {
    const cdp = { send: vi.fn() };
    cdp.send.mockImplementation(async (method: string, params: any) => {
      if (method === "DOM.describeNode" && params.backendNodeId === 1) {
        return { node: { shadowRoots: [{ backendNodeId: 99 }] } };
      }
      if (method === "Accessibility.getPartialAXTree" && params.backendNodeId === 99) {
        return { nodes: [{ nodeId: "shadow-root-1", role: { value: "button" }, name: { value: "Shadow Btn" } }] };
      }
      return null;
    });
    const baseNode = { i: "host", r: "generic", n: "Custom Element", backendNodeId: 1, c: [] };
    const out = await walkWithShadow(cdp as any, baseNode);
    expect(out.c).toContainEqual(expect.objectContaining({ n: "Shadow Btn" }));
  });

  it("returns input unchanged when node has no shadow roots", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ node: { shadowRoots: [] } }) };
    const baseNode = { i: "x", r: "button", n: "Plain", backendNodeId: 5, c: [] };
    const out = await walkWithShadow(cdp as any, baseNode);
    expect(out).toEqual(baseNode);
  });
});
```

- [ ] **Step 2: Implement walker**

Use `DOM.describeNode` to check for `shadowRoots[]`. For each shadow root's backendNodeId, call `Accessibility.getPartialAXTree` to get the shadow's AX nodes. Merge into the host node's children.

```typescript
// orchestrator/src/snapshot/shadow-walker.ts
interface AxLite { i: string; r: string; n: string; backendNodeId?: number; c?: AxLite[]; }

export async function walkWithShadow(
  cdp: { send(m: string, p: unknown): Promise<any> },
  node: AxLite,
): Promise<AxLite> {
  if (typeof node.backendNodeId !== "number") return node;
  let shadowNodes: AxLite[] = [];
  try {
    const desc = await cdp.send("DOM.describeNode", { backendNodeId: node.backendNodeId });
    const roots = desc?.node?.shadowRoots ?? [];
    for (const root of roots) {
      const ax = await cdp.send("Accessibility.getPartialAXTree", { backendNodeId: root.backendNodeId });
      for (const n of ax?.nodes ?? []) {
        // Convert CDP AX node to AxLite shape (mirror existing adapter logic)
        shadowNodes.push({
          i: `shadow-${n.nodeId}`,
          r: n.role?.value ?? "generic",
          n: n.name?.value ?? "",
        });
      }
    }
  } catch {
    // Engine doesn't expose shadow API — degrade
    return node;
  }
  if (shadowNodes.length === 0) return node;
  return { ...node, c: [...(node.c ?? []), ...shadowNodes] };
}
```

- [ ] **Step 3: Wire into AX tree builder**

In `orchestrator/src/snapshot/adapter.ts`, the `transformAxTree` function builds the tree from CDP AX nodes. After building each node, call `walkWithShadow` if `backendNodeId` is present and merge results.

Caveat: lightpanda may not implement `DOM.describeNode`'s `shadowRoots` field. The graceful catch returns the node unchanged. Document as engine-dependent.

- [ ] **Step 4: Commit**

```
feat(snapshot): shadow DOM piercing in AX walker (engine-dependent)
```

---

## Task 4 — HumanIOBus

**Files:**
- Create: `orchestrator/src/hitl/types.ts`, `orchestrator/src/hitl/bus.ts`
- Modify: `orchestrator/src/session/session.ts` (pause/resume hooks)
- Test: `orchestrator/tests/hitl/bus.test.ts`

### Design

`HumanIOBus` manages two kinds of pending state:
- **Questions**: agent asked, waiting for human answer. Indexed by token.
- **Handoffs**: agent is paused, waiting for human to resolve. Indexed by token.

Each pending entry carries: `session_id`, `created_at`, `payload` (question/handoff details), a `resolve` callback (Promise), and `timeout_ms`.

### Steps

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { HumanIOBus } from "../../src/hitl/bus.js";

describe("HumanIOBus", () => {
  it("question waits for answer and resolves on answer()", async () => {
    const bus = new HumanIOBus();
    const promise = bus.askQuestion("sess1", { question: "Pick one", options: ["A", "B"] }, 10_000);
    const pending = bus.listPending();
    expect(pending).toHaveLength(1);
    bus.answerQuestion(pending[0].token, { answer: "A", index: 0 });
    const r = await promise;
    expect(r).toEqual({ answer: "A", index: 0, ms_waited: expect.any(Number) });
  });

  it("question times out and returns timed_out:true", async () => {
    const bus = new HumanIOBus();
    const promise = bus.askQuestion("sess1", { question: "?" }, 50);
    const r = await promise;
    expect(r.timed_out).toBe(true);
  });

  it("handoff waits and resolves on resume()", async () => {
    const bus = new HumanIOBus();
    const promise = bus.startHandoff("sess1", { reason: "captcha" }, 10_000);
    const pending = bus.listPendingHandoffs();
    bus.resumeHandoff(pending[0].token, { cookies: [{ name: "x", value: "y" }], note: "done" });
    const r = await promise;
    expect(r.resumed).toBe(true);
    expect(r.cookies_imported).toBe(1);
  });

  it("answer for unknown token is a no-op", () => {
    const bus = new HumanIOBus();
    expect(() => bus.answerQuestion("ghost", { answer: "x" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// orchestrator/src/hitl/bus.ts
import { randomUUID } from "node:crypto";

export interface PendingQuestion {
  token: string;
  session_id: string;
  question: string;
  options?: string[];
  created_at: number;
}

export interface PendingHandoff {
  token: string;
  session_id: string;
  reason: string;
  suggested_action?: string;
  current_url?: string;
  created_at: number;
}

interface QuestionEntry {
  pending: PendingQuestion;
  resolve: (v: { answer?: string; index?: number; timed_out?: boolean; ms_waited: number }) => void;
  timer: NodeJS.Timeout;
}
interface HandoffEntry {
  pending: PendingHandoff;
  resolve: (v: { resumed: boolean; reason?: "timeout"; cookies_imported?: number; ms_paused: number; human_note?: string }) => void;
  timer: NodeJS.Timeout;
}

export class HumanIOBus {
  private questions = new Map<string, QuestionEntry>();
  private handoffs = new Map<string, HandoffEntry>();

  askQuestion(sessionId: string, payload: { question: string; options?: string[] }, timeoutMs: number) {
    const token = randomUUID();
    const created = Date.now();
    return new Promise<{ answer?: string; index?: number; timed_out?: boolean; ms_waited: number }>((resolve) => {
      const timer = setTimeout(() => {
        this.questions.delete(token);
        resolve({ timed_out: true, ms_waited: Date.now() - created });
      }, timeoutMs);
      this.questions.set(token, {
        pending: { token, session_id: sessionId, question: payload.question, options: payload.options, created_at: created },
        resolve: (v) => { clearTimeout(timer); this.questions.delete(token); resolve(v); },
        timer,
      });
    });
  }

  answerQuestion(token: string, v: { answer?: string; index?: number }): void {
    const e = this.questions.get(token);
    if (!e) return;
    e.resolve({ ...v, ms_waited: Date.now() - e.pending.created_at });
  }

  startHandoff(sessionId: string, payload: { reason: string; suggested_action?: string; current_url?: string }, timeoutMs: number) {
    const token = randomUUID();
    const created = Date.now();
    return new Promise<{ resumed: boolean; reason?: "timeout"; cookies_imported?: number; ms_paused: number; human_note?: string }>((resolve) => {
      const timer = setTimeout(() => {
        this.handoffs.delete(token);
        resolve({ resumed: false, reason: "timeout", ms_paused: Date.now() - created });
      }, timeoutMs);
      this.handoffs.set(token, {
        pending: { token, session_id: sessionId, reason: payload.reason, suggested_action: payload.suggested_action, current_url: payload.current_url, created_at: created },
        resolve: (v) => { clearTimeout(timer); this.handoffs.delete(token); resolve(v); },
        timer,
      });
    });
  }

  resumeHandoff(token: string, v: { cookies?: Array<{ name: string; value: string; domain?: string }>; note?: string }): void {
    const e = this.handoffs.get(token);
    if (!e) return;
    e.resolve({
      resumed: true,
      cookies_imported: v.cookies?.length ?? 0,
      ms_paused: Date.now() - e.pending.created_at,
      human_note: v.note,
    });
  }

  getHandoff(token: string): PendingHandoff | null { return this.handoffs.get(token)?.pending ?? null; }
  getQuestion(token: string): PendingQuestion | null { return this.questions.get(token)?.pending ?? null; }
  listPending(): PendingQuestion[] { return [...this.questions.values()].map((e) => e.pending); }
  listPendingHandoffs(): PendingHandoff[] { return [...this.handoffs.values()].map((e) => e.pending); }
}
```

- [ ] **Step 3: Session pause/resume**

In `Session`:
- Add `private paused = false;`
- All public action methods + snapshot/extract gate on `if (this.paused) return { ok: false, reason: "session_paused", handoff_url: this.activeHandoffUrl }`
- Add `pause()` and `resume()` methods (called by handoff flow in T6)

- [ ] **Step 4: Commit**

```
feat(hitl): HumanIOBus + session pause/resume primitives
```

---

## Task 5 — `husk_ask_human`

**Files:**
- Modify: `orchestrator/src/http/methods.ts` (add `ask_human` method)
- Modify: `orchestrator/src/http/hitl-routes.ts` (create new file with `/ask/:token/answer` endpoint — see also T6 which adds /handoff/*)
- Modify: `mcp/src/tool-surface.ts`
- Modify: `sdk-ts/src/session.ts`, `sdk-py/husk/_session.py`
- Test: `orchestrator/tests/http/ask-human.test.ts`

### MCP description (charter format)

```
husk_ask_human — Pause and ask the human a question.

WHEN TO USE: When you genuinely need a human decision — multiple matches with no clear winner, a missing piece of context the user has but you don't (which receipt? which address?), confirmation before a destructive action. NOT for things you can figure out yourself.

WHAT YOU GET: Returns {answer, index?, ms_waited} when the human answers, or {timed_out: true} if timeout_ms elapses. Default timeout 5 minutes.

DO NOT: Use as a fallback for "I'm confused" — try harder first. The user pays attention cost for every question.

Params:
  session_id: string
  question: string (the actual question — write it as you'd say it)
  options?: string[] (multiple-choice; omit for free-form text answer)
  timeout_ms?: number (default 300_000)

Example: husk_ask_human({question: "Two products match. Which one?", options: ["Acme Widget $19.99", "Beta Widget $22.49"]})
```

### Steps

- [ ] **Step 1: RPC method**

```typescript
ask_human: async (ctx, params: { session_id: string; question: string; options?: string[]; timeout_ms?: number }) => {
  if (!params.question?.trim()) throw new Error("ask_human requires a question");
  ctx.watchBus?.emit(params.session_id, {
    kind: "pending_question",
    ts: Date.now(),
    token: ...,  // forward from bus
    question: params.question,
    options: params.options,
  });
  return await ctx.humanIO.askQuestion(params.session_id, { question: params.question, options: params.options }, params.timeout_ms ?? 300_000);
},
```

(Adapt — bus needs to mint token first, then emit; refactor as needed.)

- [ ] **Step 2: `/ask/:token/answer` HTTP route**

In `orchestrator/src/http/hitl-routes.ts`, gated by 127.0.0.1:
```typescript
app.post("/ask/:token/answer", async (c) => {
  const { token } = c.req.param();
  const body = await c.req.json();
  ctx.humanIO.answerQuestion(token, { answer: body.answer, index: body.index });
  return c.json({ ok: true });
});
```

- [ ] **Step 3: Tests + commit**

```
feat(hitl): husk_ask_human — pause for human answer with optional options
```

---

## Task 6 — `husk_handoff` + handoff page + cookie paste-back

**Files:**
- Modify: `orchestrator/src/http/methods.ts` — add `handoff` method
- Modify: `orchestrator/src/http/hitl-routes.ts` — add `/handoff/:token` GET (HTML) + `/handoff/:token/resume` POST
- Create: `orchestrator/src/http/handoff-page.html.ts` — exports `HANDOFF_HTML`
- Modify: `mcp/src/tool-surface.ts`, SDKs
- Test: `orchestrator/tests/http/handoff.test.ts`

### MCP description (charter format)

```
husk_handoff — Pause and ask a human to take over.

WHEN TO USE: When you cannot proceed without a human action — captcha challenge, 2FA email/SMS code, a step requiring identity verification, an unrecoverable state. The watchdog has rejected you and there's no alternative.

WHAT YOU GET: Returns {resumed, ms_paused, cookies_imported?, human_note?} when the human resumes you, or {resumed: false, reason: "timeout"} after timeout_ms (default 10 min). On resumption, any cookies the human captured for the current domain are imported into the session — if you hit a captcha and the human solved it in their own browser, the captcha challenge cookies come with them, so your retry succeeds.

After this returns with resumed:true, your next action should be a RETRY of whatever failed. The session state is exactly where you left it.

DO NOT: Use for routine questions — use husk_ask_human instead.

Params:
  session_id: string
  reason: string (short, e.g. "captcha", "2FA required", "needs human credential")
  suggested_action?: string (longer prose for the user, e.g. "Open the URL, complete the hCaptcha, then click 'Resume'")
  timeout_ms?: number (default 600_000)
```

### Steps

- [ ] **Step 1: handoff page HTML**

Single-file HTML with:
- Reason + suggested action prominent
- Button: "Open <current_url> in browser" → opens in new tab
- Cookie capture options:
  - Bookmarklet (drag to bookmarks bar): runs on whatever domain user is on, captures `document.cookie`, POSTs to `/handoff/<token>/resume`
  - Textarea: paste cookies manually (one per line `name=value` or full `document.cookie` format)
- Button: "Resume agent" — POSTs `/handoff/<token>/resume` with whatever cookies were captured + optional note
- Status indicator showing if the agent is still waiting (live via SSE from `/watch/stream/<session_id>`)

(Mirror the Watch UI aesthetic — dark, monospace, single file.)

- [ ] **Step 2: HTTP method**

```typescript
handoff: async (ctx, params: { session_id: string; reason: string; suggested_action?: string; timeout_ms?: number }) => {
  const session = ctx.sessions.get(params.session_id);
  const current_url = session.currentUrl();
  session.pause();
  const token = ...; // bus mints
  const handoff_url = ctx.host === "127.0.0.1" && ctx.portRef
    ? `http://${ctx.host}:${ctx.portRef.value}/handoff/${token}`
    : null;
  ctx.watchBus?.emit(params.session_id, {
    kind: "pending_handoff",
    ts: Date.now(),
    token, reason: params.reason, suggested_action: params.suggested_action,
    current_url, handoff_url,
  });
  const result = await ctx.humanIO.startHandoff(params.session_id, {
    reason: params.reason,
    suggested_action: params.suggested_action,
    current_url,
  }, params.timeout_ms ?? 600_000);
  // Import cookies before resuming the session
  if (result.resumed && result.cookies_imported && result.cookies_imported > 0) {
    // The bus needs to be extended to surface the actual cookie objects when resume() is called.
    // See HumanIOBus.resumeHandoff implementation — add `cookies` to the resolved value.
    await session.importCookies(/* cookies from bus */);
  }
  session.resume();
  ctx.watchBus?.emit(params.session_id, { kind: "resumed", ts: Date.now(), ...result });
  return { ...result, handoff_url };
},
```

(The bus contract needs `resumeHandoff` to carry the cookies through to the resolved value so the method can import them. Refactor T4 if needed.)

- [ ] **Step 3: `Session.importCookies`**

Wrapper around CDP `Network.setCookies` to install cookies into the lightpanda session. Reuse the M8a vault's restore logic (`orchestrator/src/vault/restore.ts`) if its interface is compatible — that already handles session cookies correctly.

- [ ] **Step 4: `/handoff/:token` routes**

```typescript
app.get("/handoff/:token", (c) => {
  const pending = ctx.humanIO.getHandoff(c.req.param("token"));
  if (!pending) return c.notFound();
  return c.html(HANDOFF_HTML.replace(/__TOKEN__/g, pending.token)
    .replace("__REASON__", pending.reason)
    .replace("__SUGGESTED__", pending.suggested_action ?? "")
    .replace("__CURRENT_URL__", pending.current_url ?? ""));
});

app.post("/handoff/:token/resume", async (c) => {
  const body = await c.req.json();
  ctx.humanIO.resumeHandoff(c.req.param("token"), {
    cookies: body.cookies,
    note: body.note,
  });
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Tests + commit**

```
feat(hitl): husk_handoff + handoff page with cookie paste-back
```

---

## Task 7 — Watch UI v2

**Files:**
- Modify: `orchestrator/src/watch/index.html.ts`
- Test: `orchestrator/tests/watch/ui-v2.test.ts`

### Additions vs M13's Watch UI

1. **Status badge** — `live | paused (handoff) | needs answer` instead of just `live`. Red when paused for handoff.
2. **Tab list** — when snapshot.sibling_sessions is non-empty, show clickable list of sibling session IDs (each one switches the viewer to that session's stream).
3. **Inline question banner** — when a `pending_question` SSE event arrives, show the question at the top with the options as buttons (or textarea + submit if free-form). User answers → POSTs to `/ask/<token>/answer`.
4. **Inline handoff banner** — when `pending_handoff` arrives, show banner with the reason + a "Open handoff page" link.

The chat surface is the question banner — for v1, it's question-by-question (not a full chat history). Future polish can add a chat log.

### Steps

- [ ] **Step 1: Extend WATCH_HTML** with the new components (CSS, DOM, SSE event handlers for `pending_question` / `pending_handoff` / `resumed`)
- [ ] **Step 2: Tab-switching**: when user clicks a sibling session ID, the viewer closes the existing EventSource and opens a new one for that session
- [ ] **Step 3: Test the route still serves valid HTML containing the new elements
- [ ] **Step 4: Commit**

```
feat(watch): UI v2 — tab list, status badge, inline question/handoff banners
```

---

## Task 8 — Real-lightpanda integration test

**Files:**
- Create: `orchestrator/test/integration/hitl-and-tabs.test.ts`

### Test cases

1. **Multi-tab**: create parent session, create child via `parent_session_id`, both visit different URLs, snapshot each shows the other in `sibling_sessions`, close parent cascades both.

2. **Ask-human**: agent calls ask_human with options, test client POSTs to `/ask/:token/answer`, agent's call returns the answer.

3. **Handoff with cookie paste-back**: agent calls handoff, test client GETs `/handoff/:token` (verify HTML), POSTs `/handoff/:token/resume` with a fake cookie, verify cookies were imported into lightpanda via Network.getCookies.

4. **Pause semantics**: while handoff is pending, calling `husk_snapshot` on the same session returns `{ok: false, reason: "session_paused"}`. After resume, snapshot works.

### Steps

- [ ] **Step 1**: write tests
- [ ] **Step 2**: run with LIGHTPANDA_BIN
- [ ] **Step 3**: commit

```
test(integration): multi-tab + ask-human + handoff with cookie roundtrip
```

---

## Task 9 — Spec §5.10 + README + memory + tag + merge

### §5.10 sections

1. Motivation
2. Tab group model — parent_session_id, sibling_sessions, cascade close
3. Dialog handling — auto-dismiss default, opt-in manual
4. Shadow DOM piercing — engine-dependent, graceful degrade
5. `husk_ask_human` contract — when to use, return shape
6. `husk_handoff` contract — pause/resume, cookie roundtrip
7. Cookie roundtrip mechanics — bookmarklet, paste, no-cookie modes
8. Watch UI v2 — chat box, tab switcher, status badge, handoff banner
9. Decision R — HITL is local-only (Watch UI gates both Q&A and handoff routes to 127.0.0.1)
10. Decision S — Tab groups share cookie profile, never JS/DOM state
11. MCP surface: 18 → 20 (`husk_ask_human` + `husk_handoff` earn their slots; everything else folds)

### README

Add "Multi-Context + HITL (M15)" section after Snapshot Maximalism.

### Memory

- husk-roadmap: v0.0.14-m15 row
- husk-architecture: Decisions R + S
- husk-overview: capability list update

### Tag + merge

```
git tag -a v0.0.14-m15 -m "M15: Multi-context + Human-in-the-loop
- multi-tab via parent_session_id; snapshot.sibling_sessions
- husk_ask_human (new): pause for human answer
- husk_handoff (new): pause for human action with cookie paste-back
- JS dialog auto-dismiss + opt-in manual handling
- Shadow DOM piercing in AX walker (engine-dependent)
- Watch UI v2: chat box + tab list + status badge

MCP surface: +2 tools (20 total)."

git checkout main && git merge --no-ff m15-multi-context-hitl -m "Merge Milestone 15 (multi-context + HITL)"
git push origin main && git push origin v0.0.14-m15
```

---

## Self-review

**Spec coverage:** All 7 capabilities mapped to T1-T8, T9 closes docs/tag. ✓

**Type consistency:** `PendingDialog`, `PendingQuestion`, `PendingHandoff` shapes consistent across types.ts, bus.ts, and event emissions. `sibling_sessions: string[]` on Snapshot. ✓

**Tool bloat check:** +2 new MCP tools (ask_human, handoff). Per Decision N both are genuinely distinct verbs ("wait for human input" is not click/type). Multi-tab, dialog, shadow-DOM, tab listing all fold into existing verbs or snapshot. ✓

**Edge cases handled:**
- Handoff timeout returns `{resumed: false, reason: "timeout"}` — agent decides
- Question timeout returns `{timed_out: true}` — same
- Session.pause blocks all other ops with structured rejection
- Cookie import is best-effort; agent retries even if 0 cookies came back
- Shadow-DOM walker degrades gracefully if engine doesn't support DOM.describeNode

**Engine limitations:**
- Lightpanda likely doesn't implement Page.captureScreenshot, DOM.describeNode shadowRoots, etc. Mark T3 and T2 as best-effort; tests verify graceful degrade.

**Continuous execution rule:** subagents run continuously. Reviews after each task. Cookie roundtrip in T6 is the load-bearing test — flag if lightpanda's Network.setCookies doesn't accept what we paste.

---

## Execution

Two execution modes:
1. **Subagent-Driven** (recommended) — same flow that shipped M13 + M14
2. **Inline**
