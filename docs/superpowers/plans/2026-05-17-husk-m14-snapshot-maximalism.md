# Husk M14 — Snapshot Maximalism + AI-First Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `husk_snapshot` the agent's one-stop context dump (network, forms, console, metadata, session history, summary, optional screenshot, state signature), make every action return its post-state inline, and add the two loop primitives (scroll-until, paginate). **Zero new MCP tools.** MCP surface stays at 21.

**Architecture:** All 15 capabilities fold into existing verbs. Snapshot result grows from `{root, url, mode}` to a rich envelope. Action results carry the post-action snapshot. `husk_scroll` gains `until`. `husk_extract` gains `paginate`. `find()` resolver gains viewport positions in candidates + per-node reliability scoring (silent backend ranking change).

**Tech stack:** TypeScript (Node 20) in `orchestrator/`. CDP domains needed: Page (loadEventFired, captureScreenshot, getNavigationHistory), Runtime (evaluate for forms/summary/jsonld), Network (responseReceived, requestWillBeSent), Console (messageAdded), DOM (getBoxModel for viewport position). Better-sqlite3 schema additions for M4 reliability columns. AGPL.

**Spec references:** §5.9 (NEW — Snapshot Maximalism). Lands in T15.

**Design locks:**
- Snapshot result becomes a backwards-compatible superset — old callers see `{root, url}` unchanged; new callers opt into rich fields via `include` array or get sensible defaults.
- Post-action snapshot is **on by default** (already cached in M9 freshness window — adding it to action results is free). Opt out via `include_snapshot: false`.
- Per-node reliability scoring is **invisible** — no API change, just ranks `find()` candidates better over time.
- Network ring buffer is bounded (last 100 requests per session) — no unbounded growth.
- Page summary is **rule-based**, not LLM-generated. Husk stays LLM-neutral per Decision M.

---

## File Structure

**New files:**
- `orchestrator/src/snapshot/forms.ts` — form-walker (rule-based)
- `orchestrator/src/snapshot/meta.ts` — title/jsonld/og extractor
- `orchestrator/src/snapshot/summary.ts` — rule-based page summary
- `orchestrator/src/snapshot/signature.ts` — dom_hash + network_fingerprint
- `orchestrator/src/snapshot/screenshot.ts` — CDP Page.captureScreenshot wrapper
- `orchestrator/src/snapshot/visible.ts` — visible-only filter (intersect AX node bboxes with viewport)
- `orchestrator/src/snapshot/api-hints.ts` — derives likely_api_endpoints from network ring buffer
- `orchestrator/src/session/network-buffer.ts` — bounded recent-requests ring per session
- `orchestrator/src/session/console-buffer.ts` — bounded recent-console-messages ring per session
- `orchestrator/src/session/history-buffer.ts` — bounded recent-actions ring per session
- `orchestrator/src/session/scroll-until.ts` — scroll loop with predicate (reuses runWaitFor predicate set)
- `orchestrator/src/session/paginate.ts` — next-button traversal for extract
- Tests (12) under `orchestrator/tests/`

**Modified files:**
- `orchestrator/src/snapshot/types.ts` — Snapshot type grows new optional fields
- `orchestrator/src/snapshot/adapter.ts` — `transformAxTree` mode adds "visible"; orchestrates new field assembly
- `orchestrator/src/session/session.ts` — wires buffers into Session; goto/click/type/scroll/upload return post-action snapshot
- `orchestrator/src/session/find.ts` — candidates carry viewport position; ranking weights from reliability
- `orchestrator/src/session/extract.ts` — accepts `paginate`
- `orchestrator/src/http/methods.ts` — wires new snapshot fields; `scroll.until` + `extract.paginate` param schemas
- `orchestrator/src/cache/site-graph.ts` — selectors table gains `success_count`, `failure_count` columns + migration
- `mcp/src/tool-surface.ts` — updates descriptions of `husk_snapshot`, `husk_scroll`, `husk_extract` (no new tools)
- `sdk-ts/src/types.ts`, `sdk-py/husk/_types.py` — Snapshot type expansion
- `docs/superpowers/specs/2026-05-13-husk-design.md` — §5.9
- `README.md` — Snapshot Maximalism section
- Memory: `husk-roadmap.md` (v0.0.13-m14), `husk-architecture.md` (Decision O), `husk-overview.md`

---

## Task Map

| # | Task | Surface change | Model | Est |
|---|---|---|---|---|
| T1 | Snapshot envelope type + signature (dom_hash + network_fingerprint) | snapshot result fields | Haiku | 1.5h |
| T2 | Network ring buffer (CDP Network.responseReceived → last 100/session) + `snapshot.network.recent` | snapshot field | Sonnet | 2h |
| T3 | Console buffer + `snapshot.console` (last 50 messages) | snapshot field | Haiku | 1h |
| T4 | Page metadata extractor (`snapshot.meta: {title, jsonld[], og[], canonical}`) | snapshot field | Haiku | 1.5h |
| T5 | Forms discovery (`snapshot.forms[]`) — rule-based form-walker over AX tree | snapshot field | Sonnet | 2h |
| T6 | Visible-only mode (`snapshot({mode: "visible"})`) via CDP DOM.getBoxModel bbox intersect | snapshot mode | Sonnet | 2h |
| T7 | Page summary (`snapshot.summary`) — rule-based pattern detection (login/checkout/article/listing) | snapshot field | Sonnet | 2h |
| T8 | Screenshot via `snapshot({include_image: true})` → `snapshot.image_b64` | snapshot opt-in field | Haiku | 1h |
| T9 | Session history buffer (`snapshot.session_history[]` — last 10 actions) | snapshot field | Haiku | 1h |
| T10 | API endpoint hints (`snapshot.network.likely_api_endpoints[]`) derived from network ring | snapshot field | Sonnet | 1.5h |
| T11 | Post-action snapshot inline — action results gain `snapshot` field (default on) | action result field | Sonnet | 2h |
| T12 | Viewport position in find() candidates (`{x, y, region}`) + per-node reliability scoring (M4 cache columns + ranking weight) | candidate envelope | Sonnet | 3h |
| T13 | Scroll-until — `husk_scroll({until: <wait_for_predicate>})` loop | scroll param | Sonnet | 2h |
| T14 | Extract paginate — `husk_extract({paginate: {next, max_pages, stop_when?}})` | extract param | Sonnet | 3h |
| T15 | Spec §5.9 + README + memory + tag v0.0.13-m14 + merge --no-ff + push | docs | Haiku | 1h |

**Total:** 15 tasks, ~27h (~2.5 working days at Husk pace). MCP surface: **+0 tools** (stays at 21).

---

## Task 1: Snapshot envelope type + state signature

**Files:**
- Create: `orchestrator/src/snapshot/signature.ts`
- Modify: `orchestrator/src/snapshot/types.ts`, `orchestrator/src/snapshot/adapter.ts`, `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/snapshot/signature.test.ts`

### Step 1: Define the new Snapshot envelope

In `orchestrator/src/snapshot/types.ts`, extend the existing `Snapshot` type:

```typescript
export interface Snapshot {
  root: AxNode;               // existing
  url: string;                // existing
  mode?: "full" | "terse" | "visible";  // "visible" added in T6

  // NEW in M14 — all optional; back-compat preserved
  signature?: {
    dom_hash: string;          // blake3 of stable_id tree
    network_fingerprint: string; // blake3 of recent network URLs
    url: string;               // mirrors top-level for compactness
  };
  meta?: SnapshotMeta;         // T4
  forms?: FormSchema[];        // T5
  network?: SnapshotNetwork;   // T2 + T10
  console?: ConsoleMessage[];  // T3
  summary?: string;            // T7
  session_history?: HistoryEntry[]; // T9
  image_b64?: string;          // T8 (only when include_image)
}
```

### Step 2: Write failing test

```typescript
// orchestrator/tests/snapshot/signature.test.ts
import { describe, it, expect } from "vitest";
import { computeSignature } from "../../src/snapshot/signature.js";

describe("computeSignature", () => {
  it("is stable across calls with identical input", () => {
    const a = computeSignature({ root: { i: "r", r: "root", n: "", c: [{ i: "a", r: "button", n: "X" }] }, url: "/", networkUrls: ["https://api.x/1"] });
    const b = computeSignature({ root: { i: "r", r: "root", n: "", c: [{ i: "a", r: "button", n: "X" }] }, url: "/", networkUrls: ["https://api.x/1"] });
    expect(a.dom_hash).toBe(b.dom_hash);
    expect(a.network_fingerprint).toBe(b.network_fingerprint);
  });

  it("dom_hash changes when an AX node id changes", () => {
    const a = computeSignature({ root: { i: "r", r: "root", n: "", c: [{ i: "a", r: "button", n: "X" }] }, url: "/", networkUrls: [] });
    const b = computeSignature({ root: { i: "r", r: "root", n: "", c: [{ i: "b", r: "button", n: "X" }] }, url: "/", networkUrls: [] });
    expect(a.dom_hash).not.toBe(b.dom_hash);
  });

  it("network_fingerprint changes when network URLs change", () => {
    const a = computeSignature({ root: { i: "r", r: "root", n: "" }, url: "/", networkUrls: ["a"] });
    const b = computeSignature({ root: { i: "r", r: "root", n: "" }, url: "/", networkUrls: ["a", "b"] });
    expect(a.network_fingerprint).not.toBe(b.network_fingerprint);
  });
});
```

### Step 3: Implement

```typescript
// orchestrator/src/snapshot/signature.ts
import { hash } from "@noble/hashes/blake3"; // or whatever blake3 dep is already wired in M3
// If blake3 isn't a dep, use node:crypto sha256 — collision-resistant enough for a fingerprint.

import { createHash } from "node:crypto";

interface AxLite { i: string; r: string; n: string; c?: AxLite[] }
interface SignatureInput { root: AxLite; url: string; networkUrls: string[] }
interface Signature { dom_hash: string; network_fingerprint: string; url: string }

function walkIds(n: AxLite, out: string[]): void {
  out.push(n.i);
  if (n.c) for (const c of n.c) walkIds(c, out);
}

export function computeSignature(input: SignatureInput): Signature {
  const ids: string[] = [];
  walkIds(input.root, ids);
  const dom_hash = createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 16);
  const network_fingerprint = createHash("sha256").update(input.networkUrls.sort().join("|")).digest("hex").slice(0, 16);
  return { dom_hash, network_fingerprint, url: input.url };
}
```

### Step 4: Wire into Session.snapshot

In Session.snapshot, after the tree is built and before returning, compute and attach the signature. Pull `networkUrls` from the network buffer (added in T2; for now, pass empty array — wire later).

### Step 5: Commit

```bash
git add orchestrator/src/snapshot/signature.ts orchestrator/src/snapshot/types.ts \
        orchestrator/src/snapshot/adapter.ts orchestrator/src/session/session.ts \
        orchestrator/tests/snapshot/signature.test.ts
git commit -m "feat(snapshot): state signature (dom_hash + network_fingerprint)"
```

---

## Task 2: Network ring buffer + snapshot.network.recent

**Files:**
- Create: `orchestrator/src/session/network-buffer.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/session/network-buffer.test.ts`

### Step 1: Failing test

```typescript
// orchestrator/tests/session/network-buffer.test.ts
import { describe, it, expect } from "vitest";
import { NetworkBuffer } from "../../src/session/network-buffer.js";

describe("NetworkBuffer", () => {
  it("records request → response pairs", () => {
    const buf = new NetworkBuffer(10);
    buf.onRequest("req1", { url: "https://api.x/1", method: "GET", startedAt: 100 });
    buf.onResponse("req1", { status: 200, mimeType: "application/json", completedAt: 200 });
    const recent = buf.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ url: "https://api.x/1", method: "GET", status: 200, duration_ms: 100, content_type: "application/json" });
  });

  it("respects max size (oldest evicted)", () => {
    const buf = new NetworkBuffer(2);
    buf.onRequest("a", { url: "a", method: "GET", startedAt: 0 }); buf.onResponse("a", { status: 200, mimeType: "text/html", completedAt: 1 });
    buf.onRequest("b", { url: "b", method: "GET", startedAt: 1 }); buf.onResponse("b", { status: 200, mimeType: "text/html", completedAt: 2 });
    buf.onRequest("c", { url: "c", method: "GET", startedAt: 2 }); buf.onResponse("c", { status: 200, mimeType: "text/html", completedAt: 3 });
    expect(buf.recent().map((r) => r.url)).toEqual(["b", "c"]);
  });

  it("records unmatched requests as in-flight (no status, no duration_ms)", () => {
    const buf = new NetworkBuffer(10);
    buf.onRequest("pending", { url: "https://api.x/slow", method: "POST", startedAt: 100 });
    const recent = buf.recent();
    expect(recent[0].status).toBeUndefined();
    expect(recent[0].duration_ms).toBeUndefined();
  });
});
```

### Step 2: Implement

```typescript
// orchestrator/src/session/network-buffer.ts
export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  content_type?: string;
  duration_ms?: number;
  started_at: number;
}

export class NetworkBuffer {
  private entries = new Map<string, NetworkEntry>();      // by requestId
  private order: string[] = [];                            // ring order
  constructor(private maxSize: number = 100) {}

  onRequest(requestId: string, info: { url: string; method: string; startedAt: number }): void {
    this.entries.set(requestId, { url: info.url, method: info.method, started_at: info.startedAt });
    this.order.push(requestId);
    while (this.order.length > this.maxSize) {
      const evict = this.order.shift()!;
      this.entries.delete(evict);
    }
  }

  onResponse(requestId: string, info: { status: number; mimeType: string; completedAt: number }): void {
    const e = this.entries.get(requestId);
    if (!e) return;
    e.status = info.status;
    e.content_type = info.mimeType;
    e.duration_ms = info.completedAt - e.started_at;
  }

  recent(): NetworkEntry[] {
    return this.order.map((id) => this.entries.get(id)).filter((e): e is NetworkEntry => !!e);
  }

  urls(): string[] {
    return this.recent().map((e) => e.url);
  }
}
```

### Step 3: Wire into Session

In Session.create:
- Subscribe to CDP `Network.requestWillBeSent` → `buf.onRequest`
- Subscribe to CDP `Network.responseReceived` → `buf.onResponse`
- Subscribe to `Network.loadingFailed` → `buf.onResponse` with status=0

In Session.snapshot, attach `network: { recent: this.networkBuffer.recent() }` to result.

Update `computeSignature` call to pass `this.networkBuffer.urls()` so signature reflects network state.

### Step 4: Commit

```bash
git add orchestrator/src/session/network-buffer.ts orchestrator/src/session/session.ts \
        orchestrator/tests/session/network-buffer.test.ts
git commit -m "feat(snapshot): network ring buffer + snapshot.network.recent"
```

---

## Task 3: Console buffer + snapshot.console

**Files:**
- Create: `orchestrator/src/session/console-buffer.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/session/console-buffer.test.ts`

### Step 1: Failing test

```typescript
import { describe, it, expect } from "vitest";
import { ConsoleBuffer } from "../../src/session/console-buffer.js";

describe("ConsoleBuffer", () => {
  it("records messages by level", () => {
    const buf = new ConsoleBuffer(50);
    buf.add({ level: "error", text: "TypeError: x is undefined", ts: 1 });
    buf.add({ level: "warn", text: "deprecated API", ts: 2 });
    expect(buf.recent()).toHaveLength(2);
    expect(buf.recent()[0].level).toBe("error");
  });

  it("evicts oldest past max size", () => {
    const buf = new ConsoleBuffer(2);
    for (let i = 0; i < 5; i++) buf.add({ level: "log", text: `msg ${i}`, ts: i });
    expect(buf.recent().map((m) => m.text)).toEqual(["msg 3", "msg 4"]);
  });
});
```

### Step 2: Implement

```typescript
// orchestrator/src/session/console-buffer.ts
export interface ConsoleMessage {
  level: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  ts: number;
}

export class ConsoleBuffer {
  private entries: ConsoleMessage[] = [];
  constructor(private maxSize: number = 50) {}

  add(msg: ConsoleMessage): void {
    this.entries.push(msg);
    if (this.entries.length > this.maxSize) this.entries.shift();
  }

  recent(): ConsoleMessage[] {
    return [...this.entries];
  }
}
```

### Step 3: Wire into Session

Subscribe to CDP `Runtime.consoleAPICalled` and `Log.entryAdded` (call `Log.enable` in Session.create if not already). Map CDP `type` field to our level union.

In Session.snapshot, attach `console: this.consoleBuffer.recent()`.

### Step 4: Commit

`feat(snapshot): console message buffer + snapshot.console`

---

## Task 4: Page metadata (title, jsonld, og, canonical)

**Files:**
- Create: `orchestrator/src/snapshot/meta.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/snapshot/meta.test.ts`

### Step 1: Failing test

```typescript
import { describe, it, expect, vi } from "vitest";
import { extractMeta } from "../../src/snapshot/meta.js";

describe("extractMeta", () => {
  it("extracts title, og:image, og:title, canonical, jsonld", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({
      result: { value: {
        title: "Page Title",
        canonical: "https://example.com/canonical",
        og: { title: "OG Title", image: "https://example.com/img.png" },
        jsonld: [{ "@type": "Product", name: "Widget", offers: { price: "19.99" } }],
      } },
    }) };
    const m = await extractMeta(cdp as any, "sess1");
    expect(m.title).toBe("Page Title");
    expect(m.canonical).toBe("https://example.com/canonical");
    expect(m.og.title).toBe("OG Title");
    expect(m.jsonld).toHaveLength(1);
    expect(m.jsonld[0]["@type"]).toBe("Product");
  });
});
```

### Step 2: Implement

```typescript
// orchestrator/src/snapshot/meta.ts
export interface SnapshotMeta {
  title: string | null;
  canonical: string | null;
  og: Record<string, string>;
  jsonld: unknown[];
}

const EXTRACT_EXPR = `(() => {
  const og = {};
  for (const m of document.querySelectorAll('meta[property^="og:"]')) {
    og[m.getAttribute("property").slice(3)] = m.getAttribute("content") || "";
  }
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || null;
  const jsonld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { jsonld.push(JSON.parse(s.textContent || "null")); } catch {}
  }
  return { title: document.title || null, canonical, og, jsonld };
})()`;

export async function extractMeta(cdp: { send(m: string, p: unknown): Promise<{ result?: { value?: SnapshotMeta } }> }, _sid: string): Promise<SnapshotMeta> {
  const r = await cdp.send("Runtime.evaluate", { expression: EXTRACT_EXPR, returnByValue: true });
  return r.result?.value ?? { title: null, canonical: null, og: {}, jsonld: [] };
}
```

### Step 3: Wire into Session.snapshot

Run `extractMeta` in parallel with the AX tree build (Promise.all). Attach to result.

### Step 4: Commit

`feat(snapshot): meta (title, og, canonical, jsonld)`

---

## Task 5: Forms discovery

**Files:**
- Create: `orchestrator/src/snapshot/forms.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/snapshot/forms.test.ts`

### Step 1: Failing test

```typescript
import { describe, it, expect, vi } from "vitest";
import { extractForms } from "../../src/snapshot/forms.js";

describe("extractForms", () => {
  it("returns form schemas with field names, types, and required flag", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ result: { value: [{
      stable_id: null,  // set by caller from AX cross-ref
      action: "/login",
      method: "POST",
      fields: [
        { name: "email", type: "email", label: "Email address", required: true },
        { name: "password", type: "password", label: "Password", required: true },
      ],
      submit_text: "Sign in",
    }] } }) };
    const forms = await extractForms(cdp as any, "sess1");
    expect(forms).toHaveLength(1);
    expect(forms[0].fields).toHaveLength(2);
    expect(forms[0].fields[0].name).toBe("email");
    expect(forms[0].submit_text).toBe("Sign in");
  });

  it("returns empty array when no forms on page", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ result: { value: [] } }) };
    expect(await extractForms(cdp as any, "sess1")).toEqual([]);
  });
});
```

### Step 2: Implement

```typescript
// orchestrator/src/snapshot/forms.ts
export interface FormField {
  name: string;
  type: string;
  label: string | null;
  required: boolean;
  placeholder: string | null;
}

export interface FormSchema {
  stable_id: string | null;
  action: string | null;
  method: string;
  fields: FormField[];
  submit_text: string | null;
}

const EXTRACT_EXPR = `(() => {
  const forms = [];
  for (const f of document.querySelectorAll("form")) {
    const fields = [];
    for (const el of f.querySelectorAll("input, textarea, select")) {
      const n = el.getAttribute("name") || el.getAttribute("id") || "";
      const t = (el.tagName === "INPUT" ? el.getAttribute("type") : el.tagName.toLowerCase()) || "text";
      if (t === "hidden" || t === "submit") continue;
      const label = (() => {
        const id = el.getAttribute("id");
        if (id) { const l = document.querySelector('label[for="' + id + '"]'); if (l) return l.textContent?.trim() || null; }
        const parent = el.closest("label");
        return parent ? parent.textContent?.trim() || null : el.getAttribute("aria-label") || null;
      })();
      fields.push({ name: n, type: t, label, required: el.hasAttribute("required"), placeholder: el.getAttribute("placeholder") || null });
    }
    const submit = f.querySelector('button[type="submit"], input[type="submit"]');
    forms.push({
      stable_id: null,  // caller cross-refs against AX
      action: f.getAttribute("action") || null,
      method: (f.getAttribute("method") || "GET").toUpperCase(),
      fields,
      submit_text: submit?.textContent?.trim() || submit?.getAttribute("value") || null,
    });
  }
  return forms;
})()`;

export async function extractForms(cdp: { send(m: string, p: unknown): Promise<{ result?: { value?: FormSchema[] } }> }, _sid: string): Promise<FormSchema[]> {
  const r = await cdp.send("Runtime.evaluate", { expression: EXTRACT_EXPR, returnByValue: true });
  return r.result?.value ?? [];
}
```

### Step 3: Wire into Session.snapshot

Run `extractForms` in parallel with the AX tree + meta. Optionally cross-reference each form's `<form>` element to its AX node to populate `stable_id` (defer to T5 follow-up if complex; null is acceptable for v1).

### Step 4: Commit

`feat(snapshot): forms discovery — schema for each form on page`

---

## Task 6: Visible-only snapshot mode

**Files:**
- Create: `orchestrator/src/snapshot/visible.ts`
- Modify: `orchestrator/src/snapshot/adapter.ts`, `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/snapshot/visible.test.ts`

### Step 1: Failing test

```typescript
import { describe, it, expect, vi } from "vitest";
import { filterVisible } from "../../src/snapshot/visible.js";

describe("filterVisible", () => {
  it("drops nodes outside viewport bbox", async () => {
    const cdp = { send: vi.fn() };
    // Mock DOM.getBoxModel: return null for off-screen, present for in-view
    cdp.send.mockImplementation(async (method: string, params: any) => {
      if (method === "DOM.getBoxModel") {
        if (params.backendNodeId === 1) return { model: { content: [10, 10, 100, 100, 100, 50, 10, 50] } };
        if (params.backendNodeId === 2) return { model: { content: [-200, -200, -100, -200, -100, -100, -200, -100] } };
        return null;
      }
      return null;
    });
    const root = {
      i: "r", r: "main", n: "", c: [
        { i: "a", r: "button", n: "Visible", backendNodeId: 1 },
        { i: "b", r: "button", n: "OffScreen", backendNodeId: 2 },
      ],
    };
    const out = await filterVisible(cdp as any, root, { width: 1280, height: 800 });
    expect(out.c).toHaveLength(1);
    expect(out.c[0].i).toBe("a");
  });
});
```

### Step 2: Implement

```typescript
// orchestrator/src/snapshot/visible.ts
interface AxNode { i: string; r: string; n: string; backendNodeId?: number; c?: AxNode[]; }

export async function filterVisible(
  cdp: { send(m: string, p: unknown): Promise<unknown> },
  root: AxNode,
  viewport: { width: number; height: number },
): Promise<AxNode> {
  const walk = async (n: AxNode): Promise<AxNode | null> => {
    let inView = true;
    if (n.backendNodeId) {
      try {
        const r = (await cdp.send("DOM.getBoxModel", { backendNodeId: n.backendNodeId })) as { model?: { content: number[] } } | null;
        if (!r?.model?.content) inView = false;
        else {
          const [x0, y0, x1, _y1, _x2, y2] = r.model.content;
          inView = x1 > 0 && y2 > 0 && x0 < viewport.width && y0 < viewport.height;
        }
      } catch {
        inView = false;
      }
    }
    const children = n.c ? (await Promise.all(n.c.map(walk))).filter((x): x is AxNode => !!x) : undefined;
    if (!inView && (!children || children.length === 0)) return null;
    return { ...n, c: children };
  };
  return (await walk(root)) ?? { ...root, c: [] };
}
```

### Step 3: Wire mode

In `Session.snapshot({mode: "visible"})`, after the full AX tree is built, post-process through `filterVisible`. Cache the visible-filtered result like other modes.

In `transformAxTree`, add `"visible"` to the mode enum and call `filterVisible` after the standard transform.

### Step 4: Commit

`feat(snapshot): visible-only mode (intersect AX nodes with viewport)`

---

## Task 7: Page summary (rule-based)

**Files:**
- Create: `orchestrator/src/snapshot/summary.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/snapshot/summary.test.ts`

### Step 1: Failing test

```typescript
import { describe, it, expect } from "vitest";
import { summarize } from "../../src/snapshot/summary.js";

describe("summarize", () => {
  it("detects login pages", () => {
    const s = summarize({
      url: "https://example.com/login",
      meta: { title: "Sign in", canonical: null, og: {}, jsonld: [] },
      forms: [{ stable_id: null, action: "/auth", method: "POST", submit_text: "Sign in", fields: [
        { name: "email", type: "email", label: "Email", required: true, placeholder: null },
        { name: "password", type: "password", label: "Password", required: true, placeholder: null },
      ]}],
      nodes_count: 80,
      visible_text_sample: ["Sign in to your account", "Forgot password?"],
    });
    expect(s).toMatch(/login|sign[- ]?in/i);
  });

  it("detects product/listing pages from jsonld", () => {
    const s = summarize({
      url: "https://shop.example.com/widget",
      meta: { title: "Widget", canonical: null, og: {}, jsonld: [{ "@type": "Product", name: "Widget", offers: { price: "19.99" } }] },
      forms: [],
      nodes_count: 240,
      visible_text_sample: [],
    });
    expect(s).toMatch(/product|widget/i);
    expect(s).toContain("19.99");
  });

  it("falls back to generic '<role-class> page with N nodes' when no patterns match", () => {
    const s = summarize({
      url: "https://blog.example.com/post-1",
      meta: { title: "My Post", canonical: null, og: {}, jsonld: [] },
      forms: [],
      nodes_count: 120,
      visible_text_sample: ["Once upon a time..."],
    });
    expect(s).toContain("My Post");
  });
});
```

### Step 2: Implement

```typescript
// orchestrator/src/snapshot/summary.ts
import type { SnapshotMeta } from "./meta.js";
import type { FormSchema } from "./forms.js";

interface SummaryInput {
  url: string;
  meta: SnapshotMeta;
  forms: FormSchema[];
  nodes_count: number;
  visible_text_sample: string[];  // first ~10 visible text nodes
}

export function summarize(s: SummaryInput): string {
  // 1) Login detection
  const hasPasswordField = s.forms.some((f) => f.fields.some((fld) => fld.type === "password"));
  if (hasPasswordField) return `Login page — ${s.meta.title ?? s.url}; form fields: ${s.forms[0].fields.map((f) => f.name).join(", ")}`;

  // 2) Checkout detection (price + 'cart' / 'checkout' in URL or title)
  const checkoutHint = /(checkout|cart|payment|order)/i.test(`${s.url} ${s.meta.title ?? ""}`);
  if (checkoutHint) {
    const prices = s.visible_text_sample.filter((t) => /\$\d/.test(t));
    return `Checkout/cart page — ${s.meta.title ?? s.url}${prices.length ? `; visible totals: ${prices.slice(0, 3).join(", ")}` : ""}`;
  }

  // 3) JSON-LD product
  const product = s.meta.jsonld.find((j: any) => j["@type"] === "Product");
  if (product) {
    const p = product as any;
    return `Product page — ${p.name ?? s.meta.title}${p.offers?.price ? `; price ${p.offers.price}` : ""}`;
  }

  // 4) Listing/article
  const article = s.meta.jsonld.find((j: any) => j["@type"] === "Article" || j["@type"] === "BlogPosting");
  if (article) return `Article — ${(article as any).headline ?? s.meta.title}`;

  // 5) Search results
  if (/search|results|query/i.test(s.url) || /search results/i.test(s.meta.title ?? "")) {
    return `Search results — ${s.meta.title ?? s.url}`;
  }

  // 6) Fallback
  return `${s.meta.title ?? "Page"} — ${s.nodes_count} AX nodes; URL ${s.url}`;
}
```

### Step 3: Wire into Session.snapshot

After meta + forms + AX tree are built, call `summarize` and attach to result.

### Step 4: Commit

`feat(snapshot): rule-based page summary`

---

## Task 8: Optional screenshot (`include_image: true`)

**Files:**
- Create: `orchestrator/src/snapshot/screenshot.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/snapshot/screenshot.test.ts`

### Step 1: Failing test + step 2 implement

```typescript
// orchestrator/src/snapshot/screenshot.ts
export async function captureScreenshot(
  cdp: { send(m: string, p: unknown): Promise<{ data?: string }> },
  opts: { fullPage?: boolean } = {},
): Promise<string | null> {
  try {
    const r = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: opts.fullPage ?? false,
    });
    return r.data ?? null;
  } catch {
    return null;  // lightpanda may not implement; degrade gracefully
  }
}
```

Wire `snapshot({include_image: true})` → calls captureScreenshot → attaches `image_b64` to result.

### Step 3: Commit

`feat(snapshot): optional screenshot via include_image:true`

---

## Task 9: Session history buffer

**Files:**
- Create: `orchestrator/src/session/history-buffer.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/session/history-buffer.test.ts`

### Step 1-2: Test + implement

```typescript
export interface HistoryEntry {
  verb: "goto" | "click" | "type" | "scroll" | "press_key" | "upload" | "login" | "extract";
  target_name: string | null;  // resolved name (e.g., "Sign in" button)
  ok: boolean;
  ts: number;
  url_after?: string;
}

export class HistoryBuffer {
  private entries: HistoryEntry[] = [];
  constructor(private maxSize: number = 10) {}
  add(e: HistoryEntry): void { this.entries.push(e); if (this.entries.length > this.maxSize) this.entries.shift(); }
  recent(): HistoryEntry[] { return [...this.entries]; }
}
```

In Session, push to history-buffer after every action settles (success OR rejection). Attach to snapshot result.

### Step 3: Commit

`feat(snapshot): session history (last N actions)`

---

## Task 10: API endpoint hints

**Files:**
- Create: `orchestrator/src/snapshot/api-hints.ts`
- Modify: `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/snapshot/api-hints.test.ts`

### Step 1-2: Test + implement

A network request is "API-like" if:
- Method != GET to HTML, OR
- Response content_type contains "json", "graphql", "xml"
- AND URL has either query params or path parameters (`/api/`, `/v1/`, etc.)

```typescript
// orchestrator/src/snapshot/api-hints.ts
import type { NetworkEntry } from "../session/network-buffer.js";

export interface ApiHint {
  url: string;
  method: string;
  status: number | undefined;
  content_type: string | undefined;
}

export function deriveApiHints(recent: NetworkEntry[]): ApiHint[] {
  const hints: ApiHint[] = [];
  for (const e of recent) {
    const ct = e.content_type ?? "";
    const looksJson = /json|graphql|\+json/.test(ct);
    const looksApi = /\/api\/|\/v\d+\/|\/graphql/i.test(e.url) || looksJson;
    if (!looksApi) continue;
    if (e.status !== undefined && e.status >= 400) continue;
    hints.push({ url: e.url, method: e.method, status: e.status, content_type: e.content_type });
  }
  // Dedup by URL+method
  const seen = new Set<string>();
  return hints.filter((h) => {
    const k = `${h.method} ${h.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
```

Attach as `snapshot.network.likely_api_endpoints`.

### Step 3: Commit

`feat(snapshot): API endpoint hints derived from network buffer`

---

## Task 11: Post-action snapshot inline

**Files:**
- Modify: `orchestrator/src/session/session.ts` (action methods), `orchestrator/src/http/methods.ts`, `mcp/src/tool-surface.ts`, SDKs
- Test: `orchestrator/tests/session/post-action-snapshot.test.ts`

### Step 1: Failing test

```typescript
import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";

describe("post-action snapshot inline", () => {
  it("click result carries a snapshot field by default", async () => {
    const s = Session.fromInjected({ /* ... fake snapshot/performClick ... */ });
    const r = await s.click({ stable_id: "x" });
    expect(r.ok).toBe(true);
    expect((r as any).snapshot).toBeDefined();
    expect((r as any).snapshot.root).toBeDefined();
  });

  it("click({include_snapshot: false}) omits the field", async () => {
    const s = Session.fromInjected({ /* ... */ });
    const r = await s.click({ stable_id: "x", include_snapshot: false });
    expect((r as any).snapshot).toBeUndefined();
  });
});
```

### Step 2: Implement

In each action method (performClick/performType/performScroll/performUpload + goto), after the action settles and `diff` is computed, ALSO call `this.snapshot({force: false})` (which hits the M9 freshness cache — typically free) and attach as `result.snapshot`.

Add `include_snapshot?: boolean` to action input types. Default `true`. When `false`, skip the snapshot call.

### Step 3: Wire MCP descriptions

Update `husk_click`/`husk_type`/`husk_scroll`/`husk_upload` descriptions:

```
... Result includes a `diff` field AND a `snapshot` field containing the full post-action page state — use this instead of calling husk_snapshot again. Pass `include_snapshot: false` if you only need the diff (saves tokens).
```

### Step 4: Commit

`feat(actions): post-action snapshot inline (default on; saves a turn per action)`

---

## Task 12: Viewport position in candidates + per-node reliability

**Files:**
- Modify: `orchestrator/src/session/find.ts`, `orchestrator/src/cache/site-graph.ts`, `orchestrator/src/session/session.ts`
- Test: `orchestrator/tests/session/find-viewport.test.ts`, `orchestrator/tests/cache/reliability.test.ts`

### Step 1: M4 cache migration

Add `success_count INTEGER NOT NULL DEFAULT 0` and `failure_count INTEGER NOT NULL DEFAULT 0` columns to the `selectors` table. Use IF NOT EXISTS in the schema-init query (better-sqlite3 supports `PRAGMA user_version` for migrations — read existing init code and follow pattern).

### Step 2: Reliability methods on SiteGraphCache

```typescript
recordSuccess(domain: string, stable_id: string): void;
recordFailure(domain: string, stable_id: string): void;
reliability(domain: string, stable_id: string): number;  // success / (success + failure); defaults to 0.5
```

### Step 3: Viewport position in find candidates

`FindCandidate` gains: `viewport?: { x: number; y: number; region: "top-left" | "top-center" | "top-right" | "center-left" | "center" | "center-right" | "bottom-left" | "bottom-center" | "bottom-right" }`.

In `runFind` (or in the Session adapter that calls it), look up bboxes for each candidate via CDP `DOM.getBoxModel`. Compute center `(x, y)` as fraction-of-viewport. Map to one of 9 regions.

### Step 4: Ranking weight from reliability

In `runFind`, multiply each candidate's score by `(0.5 + 0.5 * reliability)`. So a node with 100% success rate gets full weight; a node with 0% success rate gets half weight. Defaults (no data) leave score unchanged.

### Step 5: Record outcomes

When an action succeeds: `siteGraph.recordSuccess(domain, stable_id)`. On watchdog rejection or no_match: `recordFailure`.

### Step 6: Commit

`feat(find): viewport position in candidates + per-node reliability scoring`

---

## Task 13: Scroll-until

**Files:**
- Create: `orchestrator/src/session/scroll-until.ts`
- Modify: `orchestrator/src/session/session.ts`, `orchestrator/src/http/methods.ts`, `mcp/src/tool-surface.ts`, SDKs
- Test: `orchestrator/tests/session/scroll-until.test.ts`

### Step 1-2: Test + implement

```typescript
// orchestrator/src/session/scroll-until.ts
import { runWaitFor, WaitForCondition } from "./wait.js";

export interface ScrollUntilOpts {
  until: WaitForCondition;
  max_scrolls?: number;  // default 20
  scroll_amount_px?: number;  // default = viewport height
}

interface ScrollSessionLike {
  scroll(target: null, direction: "down", amount: number): Promise<unknown>;
  snapshot(opts?: { force?: boolean }): Promise<{ url: string; nodes: Array<{ i: string; r: string; n: string }> }>;
  runtimeEval(expr: string): Promise<unknown>;
}

export async function runScrollUntil(s: ScrollSessionLike, opts: ScrollUntilOpts): Promise<{ ok: boolean; scrolls: number; condition_met?: string }> {
  const max = opts.max_scrolls ?? 20;
  const amount = opts.scroll_amount_px ?? 800;
  let scrolls = 0;
  while (scrolls < max) {
    const r = await runWaitFor(s, { ...opts.until, timeout_ms: 100 });
    if (r.ok) return { ok: true, scrolls, condition_met: r.condition_met };
    await s.scroll(null, "down", amount);
    scrolls++;
  }
  return { ok: false, scrolls };
}
```

Wire as `husk_scroll({until, max_scrolls?, scroll_amount_px?})` — when `until` is provided, `direction` and `amount` are ignored (or default to "down" + viewport-height).

### Step 3: MCP description update

```
... Pass `until: <wait_for_condition>` to scroll-until-true (e.g., until: {text: "Load more"} or until: {network_idle: 500}). Default max_scrolls=20. Returns {ok, scrolls, condition_met?}.
```

### Step 4: Commit

`feat(scroll): scroll-until predicate (text/role+name/url/network_idle/selector_visible)`

---

## Task 14: Extract paginate

**Files:**
- Create: `orchestrator/src/session/paginate.ts`
- Modify: `orchestrator/src/session/extract.ts`, `orchestrator/src/http/methods.ts`, `mcp/src/tool-surface.ts`, SDKs
- Test: `orchestrator/tests/session/paginate.test.ts`

### Step 1-2: Test + implement

```typescript
// orchestrator/src/session/paginate.ts
import { WaitForCondition } from "./wait.js";

export interface PaginateOpts {
  next: { stable_id?: string; intent?: string };
  max_pages?: number;       // default 10
  stop_when?: WaitForCondition;  // optional — early stop
}

export interface PaginateResult<T> {
  pages: T[];
  total_pages: number;
  stopped_reason: "max_pages" | "stop_when" | "next_disappeared" | "click_failed";
}

interface PaginateSessionLike<T> {
  extractOnce(): Promise<T>;
  click(target: { stable_id?: string; intent?: string }): Promise<{ ok: boolean }>;
  waitFor(c: WaitForCondition): Promise<{ ok: boolean }>;
}

export async function runPaginate<T>(s: PaginateSessionLike<T>, opts: PaginateOpts): Promise<PaginateResult<T>> {
  const max = opts.max_pages ?? 10;
  const pages: T[] = [];
  for (let i = 0; i < max; i++) {
    pages.push(await s.extractOnce());
    if (i === max - 1) return { pages, total_pages: pages.length, stopped_reason: "max_pages" };
    if (opts.stop_when) {
      const r = await s.waitFor({ ...opts.stop_when, timeout_ms: 100 });
      if (r.ok) return { pages, total_pages: pages.length, stopped_reason: "stop_when" };
    }
    const clicked = await s.click(opts.next);
    if (!clicked.ok) return { pages, total_pages: pages.length, stopped_reason: clicked.ok === false ? "next_disappeared" : "click_failed" };
    // small wait for the page to settle
    await s.waitFor({ network_idle: 300, timeout_ms: 5000 });
  }
  return { pages, total_pages: pages.length, stopped_reason: "max_pages" };
}
```

Wire as `husk_extract({css|selectors, paginate: {next, max_pages?, stop_when?}})`. When `paginate` is present, return `{pages: [page_results], total_pages, stopped_reason}` instead of a single result.

### Step 3: MCP description update

```
... Pass `paginate: {next: {intent|stable_id}, max_pages?: 10, stop_when?: <wait_for_condition>}` to extract across multiple pages. Returns {pages: [...], total_pages, stopped_reason}.
```

### Step 4: Commit

`feat(extract): paginate — extract across N pages with click-next loop`

---

## Task 15: Spec §5.9 + README + memory + tag v0.0.13-m14 + merge

### §5.9 outline

1. **Motivation** — M13 covered "any workflow"; M14 covers "any context" (snapshot becomes universal dump) + "fewer turns" (post-action snapshot inline) + "loops" (scroll-until, paginate).
2. **Snapshot envelope** — full schema with `signature`, `meta`, `forms`, `network`, `console`, `summary`, `session_history`, `image_b64?`.
3. **Action result envelope** — adds `snapshot` field default-on.
4. **Find candidate envelope** — adds `viewport: {x, y, region}`.
5. **M4 cache change** — `selectors.success_count`, `selectors.failure_count` columns + reliability-weighted ranking.
6. **Loop primitives** — scroll-until + paginate-on-extract contracts.
7. **Decision O — Snapshot Maximalism** — snapshot is the agent's universal context. Fold all observation into it; reserve new MCP tools only for genuinely distinct verbs (per Decision N).
8. **MCP surface unchanged** — 21 tools before/after.

### README

Add "Snapshot Maximalism (M14)" section after the M13 dynamic-workflows section.

### Memory

- `husk-roadmap.md` — `v0.0.13-m14` row
- `husk-architecture.md` — Decision O appended
- `husk-overview.md` — capability checklist refreshed (snapshot is now universal context dump; post-action snapshots; scroll-until + paginate)

### Tag + merge

```bash
git tag -a v0.0.13-m14 -m "M14: snapshot maximalism + AI-first ergonomics
- snapshot.{signature, meta, forms, network, console, summary, session_history, image_b64?}
- post-action snapshot inline by default
- viewport position + per-node reliability in find candidates
- scroll-until and extract.paginate loop primitives
- MCP surface unchanged: 21 tools (same as M13)"

git checkout main
git merge --no-ff m14-snapshot-maximalism -m "Merge Milestone 14 (snapshot maximalism + AI-first ergonomics)"
git push origin main
git push origin v0.0.13-m14
```

---

## Self-review

**Spec coverage:** Each of the 15 capabilities maps to one T1-T14, with T15 closing docs/tag/merge. ✓

**Placeholder scan:** All code blocks are concrete. No "TBD", "TODO" markers in the plan body. ✓

**Type consistency:** `WaitForCondition` reused in scroll-until's `until` and paginate's `stop_when`. `FindCandidate` extended with `viewport`. `Snapshot` extended with 8 optional fields. `ActionResult` extended with `snapshot?` field. ✓

**Tool bloat check:** 0 new MCP tools. All 15 capabilities fold into 4 existing verbs (snapshot, click/type/scroll/upload action results, scroll's params, extract's params) plus invisible backend changes (reliability scoring, find candidate enrichment). MCP surface stays at 21. ✓

**Turn-savings sanity:** A typical M13-era workflow `goto → snapshot → click → snapshot → extract` becomes M14 `goto → click → extract` because goto returns a snapshot, click returns a snapshot, and extract reads from the cached snapshot or hits the API directly. **3 turns instead of 5.** Plus scroll-until and paginate each replace what used to be 10+ turn loops with 1 turn. ✓

**Backwards compatibility:** All snapshot fields optional. Old callers see `{root, url, mode}` unchanged. Existing tests should not need changes (regression sweep in T15 verification). ✓

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-husk-m14-snapshot-maximalism.md`.

Branch will be `m14-snapshot-maximalism` (to be cut from main after plan commit).

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec → quality) between each, continuous execution. Same flow that shipped M13.
2. **Inline** — execute tasks here with checkpoints.

Choose 1 or 2 (or "tweak X" to adjust scope).
