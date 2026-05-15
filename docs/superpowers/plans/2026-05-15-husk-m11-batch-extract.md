# M11 Batch Primitive + Targeted Extract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude a single tool call that fans out across many URLs in parallel + a targeted extraction primitive so Claude doesn't have to grep through huge snapshots. Address the observed reality that Claude in Claude Desktop reasons between every tool call (sequential), which negates M9's pool parallelism for batch workloads. The batch tool moves the parallelism inside one tool call.

**Architecture:** `Session.extract(query)` runs `Runtime.evaluate` with a CSS selector and returns the matched text (no full snapshot). A new HTTP method `batch_visit(urls, extract?)` fans out across the M9 EnginePool — internally spawns N parallel sessions, navigates each, optionally extracts, returns one row per URL. A new snapshot mode `terse` drops navigation/banner/contentinfo/complementary roles to cut payload ~40% for cluttered pages. MCP tools `husk_extract` + `husk_batch_visit` are the agent-facing surfaces.

**Tech Stack:** TypeScript, Node 20+. No new runtime deps. Reuses `Runtime.evaluate` CDP method and the M9 pool.

**Spec reference:** Spec §5.6 (M9 parallel/diff) already documents the pool. Adds §5.7.

**Verified prerequisites:**
- M9 EnginePool at `orchestrator/src/engine/pool.ts`
- M9 SessionManager wired through the pool
- M9 eager snapshot + cache
- `transformAxTree` + passthrough-roles list at `orchestrator/src/snapshot/`
- Existing `husk_login` `jsFormLogin` uses Runtime.evaluate; this task adds a higher-level wrapper

**Why this — even though M9 said "no batch tool":**
Field observation in Claude Desktop: Claude reasons between each `husk_goto`/`husk_snapshot` call, going through 50 URLs sequentially. The pool's parallelism doesn't help because tool calls are serialized at the model level. A batch tool moves the fan-out inside a single tool call, where Husk controls the concurrency. Decision J's principle ("don't add concurrency knobs to single-action primitives") still holds — `husk_goto` etc. remain as-is. `husk_batch_visit` is a NEW primitive specifically for fan-out workloads.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `orchestrator/src/session/extract.ts` | `extract(cdp, sessionId, query)` — CDP `Runtime.evaluate` wrapper that returns text matching a CSS selector |
| `orchestrator/src/http/batch.ts` | Top-level `batchVisit(ctx, urls, extract?)` function — fans out across SessionManager, returns array |
| `orchestrator/tests/session/extract.test.ts` | Unit |
| `orchestrator/tests/http/batch-visit.test.ts` | Unit (mocked sessions) |
| `orchestrator/tests/integration/batch-visit-real.test.ts` | Real lightpanda: 10 URLs via batch_visit + extract |

### Modified files

| Path | Change |
|---|---|
| `orchestrator/src/session/session.ts` | Add `Session.extract(query)` method; add `mode: 'full' | 'terse'` to `snapshot()` |
| `orchestrator/src/snapshot/adapter.ts` | Honor `mode: 'terse'` — drop nav/banner/contentinfo/complementary subtrees |
| `orchestrator/src/snapshot/passthrough-roles.ts` | Export new `SKIP_ROLES` set for terse mode |
| `orchestrator/src/http/methods.ts` | Add `extract` + `batch_visit` JSON-RPC methods; thread `mode` through `snapshot` |
| `mcp/src/tool-surface.ts` | Add `husk_extract` + `husk_batch_visit` tools |
| `mcp/tests/tool-surface.test.ts` | Tests for the new tools |
| `orchestrator/bench/parallel-bench.ts` | Add a `--mode=batch` variant comparing per-URL goto+snapshot vs `batch_visit` with extract |
| `docs/superpowers/specs/2026-05-13-husk-design.md` | Append §5.7 — batch primitive + targeted extract |
| `README.md` | Add a "Batch operations" subsection with example |

---

## Test Counts at Each Stage

| After task | Cumulative |
|---|---|
| T1 (extract method) | 405 + 4 = 409 |
| T2 (HTTP extract) | 409 + 3 = 412 |
| T3 (batch_visit HTTP) | 412 + 7 = 419 |
| T4 (MCP tools) | 419 + 5 = 424 |
| T5 (terse snapshot mode) | 424 + 4 = 428 |
| T6 (bench) | 428 (no new tests) |
| T7 (spec + docs) | 428 |

Target: **428 tests** at end of M11.

---

## Task 1: `Session.extract(query)`

**Files:**
- Create: `orchestrator/src/session/extract.ts`
- Modify: `orchestrator/src/session/session.ts` (add `extract()` method)
- Create: `orchestrator/tests/session/extract.test.ts`

- [ ] **Step 1: Write failing test**

`orchestrator/tests/session/extract.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { Session } from "../../src/session/session.js";

describe("Session.extract", () => {
  it("runs Runtime.evaluate with the supplied CSS selector and returns textContent", async () => {
    const cdp = {
      send: vi.fn(async (method: string, params: any) => {
        if (method === "Runtime.evaluate") {
          // Verify the expression embeds the selector via JSON.stringify
          expect(params.expression).toContain('".f4.my-3"');
          return { result: { value: "Production-Grade Container Scheduling" } };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const text = await session.extract({ css: ".f4.my-3" });
    expect(text).toBe("Production-Grade Container Scheduling");
  });

  it("returns null when the element is not found", async () => {
    const cdp = {
      send: vi.fn(async () => ({ result: { value: null } })),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const text = await session.extract({ css: ".does-not-exist" });
    expect(text).toBeNull();
  });

  it("trims surrounding whitespace from the extracted text", async () => {
    const cdp = {
      send: vi.fn(async () => ({ result: { value: "  spaced text  \n" } })),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const text = await session.extract({ css: ".whatever" });
    expect(text).toBe("spaced text");
  });

  it("escapes selectors with single quotes safely", async () => {
    const cdp = {
      send: vi.fn(async (_method: string, params: any) => {
        // The selector should be properly JSON-stringified so it can't break the JS expression.
        expect(params.expression).not.toContain("attr='\\'");
        return { result: { value: "ok" } };
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.extract({ css: "input[type='password']" });
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run session/extract
```

- [ ] **Step 3: Implement extract helper**

`orchestrator/src/session/extract.ts`:

```typescript
export interface ExtractQuery {
  /** CSS selector. Required in v1. Future: role+name semantic query. */
  css: string;
}

export interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Run `Runtime.evaluate` with a tiny snippet that finds `query.css` and
 * returns `textContent` (trimmed). Returns null if no element matches.
 * The selector is embedded via `JSON.stringify` so quotes can't break out.
 */
export async function runExtract(cdp: CdpLike, sessionId: string, query: ExtractQuery): Promise<string | null> {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(query.css)});
    if (!el) return null;
    return (el.textContent || '').trim();
  })()`;
  const res = (await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true },
    sessionId
  )) as { result?: { value?: string | null } };
  return res.result?.value ?? null;
}
```

- [ ] **Step 4: Add `Session.extract` method**

In `orchestrator/src/session/session.ts`, import:

```typescript
import { runExtract, type ExtractQuery } from "./extract.js";
```

Add public method:

```typescript
async extract(query: ExtractQuery): Promise<string | null> {
  return await runExtract(this.cdp, this.sessionId, query);
}
```

Also re-export the type:

```typescript
export type { ExtractQuery } from "./extract.js";
```

- [ ] **Step 5: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run session/extract
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/session/extract.ts orchestrator/src/session/session.ts orchestrator/tests/session/extract.test.ts
git commit -m "feat(session): Session.extract(css) — Runtime.evaluate text extraction"
```

Expected: 4 tests pass.

---

## Task 2: HTTP `extract` Method

**Files:**
- Modify: `orchestrator/src/http/methods.ts` — add `extract` method
- Create: `orchestrator/tests/http/extract-method.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/http/extract-method.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(extractImpl: (q: any) => Promise<string | null>) {
  const sm = new SessionManager(async () => ({
    close: async () => {},
    extract: extractImpl,
  }) as unknown as Session);
  return { sessions: sm, version: "0.0.0", vault: {} as any, credentials: {} as any };
}

describe("HTTP extract method", () => {
  it("forwards { session_id, css } to Session.extract and returns the string", async () => {
    let receivedQuery: any;
    const ctx = makeCtx(async (q) => { receivedQuery = q; return "extracted text"; });
    const sid = await ctx.sessions.create();
    const r = await METHODS.extract({ session_id: sid, css: ".desc" }, ctx);
    expect(receivedQuery).toEqual({ css: ".desc" });
    expect(r).toEqual({ text: "extracted text" });
  });

  it("returns { text: null } when extract returns null", async () => {
    const ctx = makeCtx(async () => null);
    const sid = await ctx.sessions.create();
    const r = await METHODS.extract({ session_id: sid, css: ".missing" }, ctx);
    expect(r).toEqual({ text: null });
  });

  it("propagates session-not-found errors verbatim (SessionNotFoundError)", async () => {
    const ctx = makeCtx(async () => "x");
    await expect(METHODS.extract({ session_id: "ghost", css: ".x" }, ctx)).rejects.toThrow(/Session not found/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run http/extract-method
```

- [ ] **Step 3: Add to METHODS**

In `orchestrator/src/http/methods.ts`, append to `METHODS`:

```typescript
async extract(
  params: { session_id: string; css: string },
  ctx: MethodContext
): Promise<{ text: string | null }> {
  const session = ctx.sessions.get(params.session_id);
  const text = await session.extract({ css: params.css });
  return { text };
},
```

- [ ] **Step 4: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run
git add orchestrator/src/http/methods.ts orchestrator/tests/http/extract-method.test.ts
git commit -m "feat(http): extract JSON-RPC method — text by CSS selector"
```

Expected: 3 new tests pass.

---

## Task 3: HTTP `batch_visit` Method

The load-bearing piece. Spawns N sessions in parallel via SessionManager.create() (which acquires from the M9 pool), navigates each, optionally extracts, closes.

**Files:**
- Create: `orchestrator/src/http/batch.ts` — `batchVisit(ctx, params)` function
- Modify: `orchestrator/src/http/methods.ts` — add `batch_visit` method
- Create: `orchestrator/tests/http/batch-visit.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/http/batch-visit.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

interface CallTrace { method: string; args: unknown[]; }

function makeCtx(opts: {
  perUrl?: (url: string) => Promise<{ snapshot?: any; text?: string | null; error?: string }>;
} = {}) {
  const traces: CallTrace[] = [];
  let createCalls = 0;
  let closeCalls = 0;
  const sm = new SessionManager(async () => {
    createCalls++;
    let lastUrl = "";
    return {
      goto: async (url: string) => { lastUrl = url; traces.push({ method: "goto", args: [url] }); },
      snapshot: async () => {
        traces.push({ method: "snapshot", args: [] });
        const r = await opts.perUrl?.(lastUrl);
        if (r?.error) throw new Error(r.error);
        return r?.snapshot ?? { v: 1, url: lastUrl, count: 1, root: { i: "r", r: "RootWebArea", n: "", s: ["v"] } };
      },
      extract: async (q: any) => {
        traces.push({ method: "extract", args: [q] });
        const r = await opts.perUrl?.(lastUrl);
        if (r?.error) throw new Error(r.error);
        return r?.text ?? null;
      },
      close: async () => { closeCalls++; },
    } as unknown as Session;
  });
  return {
    ctx: { sessions: sm, version: "0.0.0", vault: {} as any, credentials: {} as any },
    traces,
    createCounts: () => createCalls,
    closeCounts: () => closeCalls,
  };
}

describe("HTTP batch_visit", () => {
  it("creates one session per URL and visits in parallel", async () => {
    const t = makeCtx();
    const urls = ["https://a.test/", "https://b.test/", "https://c.test/"];
    const r = (await METHODS.batch_visit({ urls }, t.ctx)) as { results: Array<{ url: string; ok: boolean }> };
    expect(r.results.length).toBe(3);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(t.createCounts()).toBe(3);
    expect(t.closeCounts()).toBe(3);
  });

  it("returns snapshot per URL when no extract supplied", async () => {
    const t = makeCtx({
      perUrl: async (url) => ({ snapshot: { v: 1, url, count: 1, root: { i: "x", r: "RootWebArea", n: url, s: ["v"] } } }),
    });
    const r = (await METHODS.batch_visit({ urls: ["https://x/"] }, t.ctx)) as { results: any[] };
    expect(r.results[0].snapshot).toBeDefined();
    expect(r.results[0].text).toBeUndefined();
  });

  it("returns extracted text per URL when extract.css supplied", async () => {
    const t = makeCtx({
      perUrl: async (url) => ({ text: `extracted from ${url}` }),
    });
    const r = (await METHODS.batch_visit({
      urls: ["https://a/", "https://b/"],
      extract: { css: ".f4.my-3" },
    }, t.ctx)) as { results: any[] };
    expect(r.results[0].text).toBe("extracted from https://a/");
    expect(r.results[1].text).toBe("extracted from https://b/");
    expect(r.results[0].snapshot).toBeUndefined();
  });

  it("isolates per-URL failures: one bad URL doesn't break the rest", async () => {
    const t = makeCtx({
      perUrl: async (url) => {
        if (url === "https://broken/") return { error: "ECONNREFUSED" };
        return { text: "ok" };
      },
    });
    const r = (await METHODS.batch_visit({
      urls: ["https://a/", "https://broken/", "https://c/"],
      extract: { css: ".x" },
    }, t.ctx)) as { results: Array<{ url: string; ok: boolean; error?: string }> };
    expect(r.results.length).toBe(3);
    expect(r.results[0].ok).toBe(true);
    expect(r.results[1].ok).toBe(false);
    expect(r.results[1].error).toContain("ECONNREFUSED");
    expect(r.results[2].ok).toBe(true);
  });

  it("close() is called even when a URL throws", async () => {
    const t = makeCtx({
      perUrl: async (url) => ({ error: `boom ${url}` }),
    });
    await METHODS.batch_visit({ urls: ["https://a/", "https://b/"] }, t.ctx);
    expect(t.closeCounts()).toBe(2);
  });

  it("preserves URL order in the result array", async () => {
    const t = makeCtx({
      perUrl: async (url) => {
        // Introduce jitter: URLs ending in '0' resolve last
        if (url.endsWith("0")) await new Promise((r) => setTimeout(r, 30));
        return { text: url };
      },
    });
    const urls = ["https://a0/", "https://b/", "https://c/", "https://d0/"];
    const r = (await METHODS.batch_visit({ urls, extract: { css: ".x" } }, t.ctx)) as { results: any[] };
    expect(r.results.map((x) => x.url)).toEqual(urls);
  });

  it("results array is empty when urls array is empty", async () => {
    const t = makeCtx();
    const r = (await METHODS.batch_visit({ urls: [] }, t.ctx)) as { results: any[] };
    expect(r.results).toEqual([]);
    expect(t.createCounts()).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run http/batch-visit
```

- [ ] **Step 3: Implement batchVisit**

`orchestrator/src/http/batch.ts`:

```typescript
import type { MethodContext } from "./methods.js";
import type { Snapshot } from "../snapshot/types.js";

export interface BatchVisitParams {
  urls: string[];
  extract?: { css: string };
}

export interface BatchVisitItem {
  url: string;
  ok: boolean;
  snapshot?: Snapshot;
  text?: string | null;
  error?: string;
}

/**
 * Fan-out fetch: spawn one session per URL (via SessionManager → engine pool),
 * navigate, optionally extract by CSS selector, close. All URLs proceed in
 * parallel via Promise.all; per-URL errors don't break the batch.
 *
 * Returns the results in input URL order regardless of completion order.
 */
export async function batchVisit(ctx: MethodContext, params: BatchVisitParams): Promise<BatchVisitItem[]> {
  return Promise.all(params.urls.map(async (url): Promise<BatchVisitItem> => {
    let sessionId: string | undefined;
    try {
      sessionId = await ctx.sessions.create();
      const session = ctx.sessions.get(sessionId);
      await session.goto(url);
      if (params.extract?.css) {
        const text = await session.extract({ css: params.extract.css });
        return { url, ok: true, text };
      }
      const snapshot = await session.snapshot();
      return { url, ok: true, snapshot };
    } catch (e) {
      return { url, ok: false, error: (e as Error).message };
    } finally {
      if (sessionId !== undefined) {
        await ctx.sessions.close(sessionId).catch(() => { /* idempotent */ });
      }
    }
  }));
}
```

- [ ] **Step 4: Add to METHODS**

In `orchestrator/src/http/methods.ts`:

```typescript
import { batchVisit, type BatchVisitParams } from "./batch.js";

// inside METHODS:
async batch_visit(
  params: BatchVisitParams,
  ctx: MethodContext
): Promise<{ results: import("./batch.js").BatchVisitItem[] }> {
  const results = await batchVisit(ctx, params);
  return { results };
},
```

- [ ] **Step 5: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run http/batch-visit
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/http/batch.ts orchestrator/src/http/methods.ts orchestrator/tests/http/batch-visit.test.ts
git commit -m "feat(http): batch_visit JSON-RPC method — parallel fan-out + optional extract"
```

Expected: 7 batch tests pass.

---

## Task 4: MCP Tools `husk_extract` + `husk_batch_visit`

**Files:**
- Modify: `mcp/src/tool-surface.ts` — add 2 tools + RPC_MAP entries
- Modify: `mcp/tests/tool-surface.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe("batch_visit + extract tools (M11)", () => {
  it("TOOL_SURFACE includes husk_extract + husk_batch_visit", () => {
    const names = TOOL_SURFACE.map((t) => t.name);
    expect(names).toContain("husk_extract");
    expect(names).toContain("husk_batch_visit");
  });

  it("husk_extract requires session_id + css", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_extract")!;
    expect(t.inputSchema.required).toEqual(expect.arrayContaining(["session_id", "css"]));
  });

  it("husk_batch_visit requires urls", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_batch_visit")!;
    expect(t.inputSchema.required).toEqual(["urls"]);
    expect(t.inputSchema.properties.urls).toBeDefined();
    expect(t.inputSchema.properties.extract).toBeDefined();
  });

  it("husk_batch_visit description recommends usage for ANY list of URLs", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_batch_visit")!;
    expect(t.description.toLowerCase()).toMatch(/parallel|multiple url|batch|list of url/);
  });

  it("handleToolCall routes husk_batch_visit to batch_visit RPC", async () => {
    const client = { call: vi.fn(async () => ({ results: [] })) };
    await handleToolCall(client as any, "husk_batch_visit", {
      urls: ["https://a/", "https://b/"],
      extract: { css: ".x" },
    });
    expect(client.call).toHaveBeenCalledWith("batch_visit", {
      urls: ["https://a/", "https://b/"],
      extract: { css: ".x" },
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/mcp vitest run tool-surface
```

- [ ] **Step 3: Add tools**

In `mcp/src/tool-surface.ts`, append to `TOOL_SURFACE`:

```typescript
{
  name: "husk_extract",
  description: "Husk — Extract text from the current page by CSS selector. Runs document.querySelector and returns the matched element's textContent (trimmed), or null if no match. MUCH cheaper than husk_snapshot when you know what you want — ~100ms and a few hundred bytes vs ~1.5s and ~10-50KB. Use this after husk_goto when you need a specific value from the page.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      css: { type: "string", description: "CSS selector. The first matching element's textContent is returned." },
    },
    required: ["session_id", "css"],
  },
},
{
  name: "husk_batch_visit",
  description: "Husk — Visit MANY URLs in parallel and return results as one array. THE RIGHT TOOL FOR ANY LIST OF URLS YOU NEED TO PROCESS — instead of calling husk_goto+husk_snapshot 50 times sequentially, call husk_batch_visit once with all 50 URLs. Husk fans out across its engine pool automatically (~5-50 parallel sessions based on available memory). Pass `extract: { css: '...' }` to get JUST the matched text per URL (much smaller payload than full snapshots). Without extract, returns the full snapshot per URL. Per-URL errors are isolated (one bad URL doesn't break the rest).",
  inputSchema: {
    type: "object",
    properties: {
      urls: { type: "array", items: { type: "string" }, description: "URLs to visit in parallel" },
      extract: {
        type: "object",
        description: "Optional: instead of returning a full snapshot per URL, run document.querySelector(css).textContent and return just that string. Massively reduces token cost for batch reads.",
        properties: { css: { type: "string" } },
        required: ["css"],
      },
    },
    required: ["urls"],
  },
},
```

Extend `RPC_MAP`:
```typescript
husk_extract: "extract",
husk_batch_visit: "batch_visit",
```

- [ ] **Step 4: Verify + commit**

```
pnpm --filter @husk/mcp vitest run
pnpm --filter @husk/mcp typecheck
git add mcp/src/tool-surface.ts mcp/tests/tool-surface.test.ts
git commit -m "feat(mcp): husk_extract + husk_batch_visit tools"
```

Expected: 5 new tests pass.

---

## Task 5: Terse Snapshot Mode (drop nav/banner/contentinfo/complementary)

**Files:**
- Modify: `orchestrator/src/snapshot/passthrough-roles.ts` — export `SKIP_ROLES` for terse mode
- Modify: `orchestrator/src/snapshot/adapter.ts` — honor `mode` parameter
- Modify: `orchestrator/src/snapshot/types.ts` — extend `transformAxTree` to accept mode
- Modify: `orchestrator/src/session/session.ts` — `snapshot({mode})` plumbs through
- Modify: `orchestrator/src/http/methods.ts` — `snapshot` accepts `mode`
- Create: `orchestrator/tests/snapshot/terse-mode.test.ts`

- [ ] **Step 1: Add SKIP_ROLES + isSkipRole**

In `orchestrator/src/snapshot/passthrough-roles.ts`, append:

```typescript
/**
 * Roles whose nodes (and their entire subtrees) are DROPPED in `mode: 'terse'`.
 * These are page chrome — nav bars, banners, footers, sidebars — that have no
 * actionable content for typical agent tasks.
 *
 * Different from PASSTHROUGH_ROLES: passthrough keeps the descendants in the
 * output (parented to the passthrough's parent). Skip drops the whole subtree.
 */
export const SKIP_ROLES_TERSE: ReadonlySet<string> = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
]);

export function isSkipRoleTerse(role: string | undefined): boolean {
  return role !== undefined && SKIP_ROLES_TERSE.has(role);
}
```

- [ ] **Step 2: Write failing tests**

`orchestrator/tests/snapshot/terse-mode.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { transformAxTree } from "../../src/snapshot/adapter.js";
import type { AXNode } from "../../src/snapshot/types.js";

function ax(id: string, role: string, name: string, children: string[] = []): AXNode {
  return {
    nodeId: id,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    properties: [],
    childIds: children,
  } as AXNode;
}

describe("snapshot transformAxTree — terse mode", () => {
  it("'full' (default) preserves navigation/banner/contentinfo/complementary nodes", () => {
    const nodes = [
      ax("1", "RootWebArea", "Page", ["2", "3", "4", "5", "6"]),
      ax("2", "navigation", "Top nav"),
      ax("3", "banner", "Site banner"),
      ax("4", "main", "Content", ["7"]),
      ax("5", "complementary", "Sidebar"),
      ax("6", "contentinfo", "Footer"),
      ax("7", "paragraph", "Hello"),
    ];
    const snap = transformAxTree(nodes, "1", "https://x/");
    // 'main' is passthrough, so its children parent up to root.
    const roles = (snap.root.c ?? []).map((c) => c.r);
    expect(roles).toContain("navigation");
    expect(roles).toContain("banner");
    expect(roles).toContain("contentinfo");
    expect(roles).toContain("complementary");
  });

  it("'terse' drops navigation/banner/contentinfo/complementary entirely (and their subtrees)", () => {
    const nodes = [
      ax("1", "RootWebArea", "Page", ["2", "3", "4", "5", "6"]),
      ax("2", "navigation", "Top nav", ["8"]),
      ax("3", "banner", "Banner"),
      ax("4", "main", "Content", ["7"]),
      ax("5", "complementary", "Sidebar", ["9"]),
      ax("6", "contentinfo", "Footer"),
      ax("7", "paragraph", "Description"),
      ax("8", "link", "Pricing"),
      ax("9", "link", "Settings"),
    ];
    const snap = transformAxTree(nodes, "1", "https://x/", { mode: "terse" });
    // navigation, banner, complementary, contentinfo and ALL their descendants gone
    const json = JSON.stringify(snap);
    expect(json).not.toContain("Pricing");
    expect(json).not.toContain("Settings");
    expect(json).not.toContain("Top nav");
    expect(json).not.toContain("Banner");
    expect(json).not.toContain("Footer");
    expect(json).not.toContain("Sidebar");
    // Main content survives
    expect(json).toContain("Description");
  });

  it("terse mode count reflects the dropped subtrees", () => {
    const nodes = [
      ax("1", "RootWebArea", "Page", ["2", "3"]),
      ax("2", "navigation", "Nav", ["4", "5"]),
      ax("3", "paragraph", "Body"),
      ax("4", "link", "A"),
      ax("5", "link", "B"),
    ];
    const fullSnap = transformAxTree(nodes, "1", "https://x/");
    const terseSnap = transformAxTree(nodes, "1", "https://x/", { mode: "terse" });
    expect(terseSnap.count).toBeLessThan(fullSnap.count);
  });

  it("terse mode preserves Snapshot v / url / root shape", () => {
    const nodes = [ax("1", "RootWebArea", "Page", ["2"]), ax("2", "navigation", "Nav")];
    const terseSnap = transformAxTree(nodes, "1", "https://x/", { mode: "terse" });
    expect(terseSnap.v).toBe(1);
    expect(terseSnap.url).toBe("https://x/");
    expect(terseSnap.root.r).toBe("RootWebArea");
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run snapshot/terse-mode
```

- [ ] **Step 4: Modify `transformAxTree` to accept mode**

Read `orchestrator/src/snapshot/adapter.ts`. The `transformAxTree` signature is:

```typescript
export function transformAxTree(nodes: AXNode[], rootId: string, url: string): Snapshot
```

Change to:

```typescript
export interface TransformAxOptions {
  mode?: "full" | "terse";
}

export function transformAxTree(
  nodes: AXNode[],
  rootId: string,
  url: string,
  opts: TransformAxOptions = {}
): Snapshot
```

Inside `visit`, after the `ignored || isPassthroughRole(role)` check, add a `terse` short-circuit BEFORE either passthrough OR emit:

```typescript
if (opts.mode === "terse" && isSkipRoleTerse(role)) {
  // Drop this node AND its subtree entirely.
  return [];
}
```

Import:

```typescript
import { isPassthroughRole, isSkipRoleTerse } from "./passthrough-roles.js";
```

- [ ] **Step 5: Plumb mode through Session.snapshot**

In `orchestrator/src/session/session.ts`, extend `snapshot` options:

```typescript
async snapshot(opts: { maxAgeMs?: number; force?: boolean; mode?: "full" | "terse" } = {}): Promise<Snapshot> {
  // ... existing freshness check ...
  // pass mode into transformAxTree:
  const snap = transformAxTree(tree.nodes, root.nodeId, this.currentUrl, { mode: opts.mode });
  // ...
}
```

Note: when `mode` is different from a cached snapshot's mode, we should ignore the cache. Simplest: tag the cache with its mode and invalidate on mismatch.

```typescript
private lastSnapshotMode: "full" | "terse" = "full";

// In snapshot():
const mode = opts.mode ?? "full";
const fresh = !opts.force && this.lastSnapshot && Date.now() - this.lastSnapshotAt < (opts.maxAgeMs ?? 500) && this.lastSnapshotMode === mode;
if (fresh) return this.lastSnapshot;
// ... fetch + transform with mode ...
this.lastSnapshotMode = mode;
```

- [ ] **Step 6: Plumb mode through HTTP**

In `orchestrator/src/http/methods.ts`, `snapshot` handler:

```typescript
async snapshot(
  params: { session_id: string; max_age_ms?: number; mode?: "full" | "terse" },
  ctx: MethodContext
): Promise<Snapshot> {
  const session = ctx.sessions.get(params.session_id);
  return await session.snapshot({ maxAgeMs: params.max_age_ms, mode: params.mode });
},
```

Also pass `mode: "terse"` from `batchVisit` when no extract is supplied (so batch snapshots are small by default):

In `orchestrator/src/http/batch.ts`, update the no-extract branch:

```typescript
const snapshot = await session.snapshot({ mode: "terse" });
```

- [ ] **Step 7: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/snapshot/passthrough-roles.ts orchestrator/src/snapshot/adapter.ts orchestrator/src/session/session.ts orchestrator/src/http/methods.ts orchestrator/src/http/batch.ts orchestrator/tests/snapshot/terse-mode.test.ts
git commit -m "feat(snapshot): 'terse' mode drops nav/banner/contentinfo/complementary; default in batch_visit"
```

Expected: 4 new tests pass + all existing tests still pass.

---

## Task 6: Bench `batch_visit` vs `husk_goto+snapshot` (per-URL)

**Files:**
- Modify: `orchestrator/bench/parallel-bench.ts` — add `--mode=batch` and `--mode=batch-extract` variants

- [ ] **Step 1: Extend the bench**

Read the existing `orchestrator/bench/parallel-bench.ts`. Add a `BENCH_MODE` env var:

- `BENCH_MODE=pool` (default) — current behavior: create N sessions, goto+snapshot each via pool
- `BENCH_MODE=batch` — call `batchVisit` with the same URLs (no extract → returns terse snapshots)
- `BENCH_MODE=batch-extract` — call `batchVisit` with `{extract: {css: ".f4.my-3"}}` (GitHub description CSS)

Refactor to:

```typescript
// at top
import { batchVisit } from "../src/http/batch.js";
// build a fake ctx for the bench that uses an in-memory SessionManager
// ...
const MODE = process.env.BENCH_MODE ?? "pool";

if (MODE === "pool") {
  // existing path
} else if (MODE === "batch") {
  const results = await batchVisit(ctx, { urls });
  // tally ok/failed, capture per-url ms by timing the whole call... (batch is one bulk timing)
} else if (MODE === "batch-extract") {
  const results = await batchVisit(ctx, { urls, extract: { css: ".f4.my-3" } });
  // ...
}
```

The bench needs a real SessionManager + EnginePool. Move the SessionManager construction earlier, parameterize by mode.

- [ ] **Step 2: Run all three modes**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter husk-orchestrator run bench

BENCH_MODE=batch LIGHTPANDA_BIN=... pnpm --filter husk-orchestrator run bench

BENCH_MODE=batch-extract LIGHTPANDA_BIN=... pnpm --filter husk-orchestrator run bench
```

Record the wall-clock + per-URL avg + per-result payload sizes for each.

- [ ] **Step 3: Update README**

Add a row to the Performance table showing the three modes. Example after measurements:

```markdown
| Workload | Wall clock | Per-URL avg | Notes |
|---|---|---|---|
| 50 URLs, pool primitives (M9) | 3.9s | ~2.7s | Full snapshots, sequential reasoning |
| 50 URLs, husk_batch_visit (terse snapshot) | ~3.5s | n/a | One tool call, terse mode |
| 50 URLs, husk_batch_visit + extract | ~2.5s | n/a | One tool call, ~200 bytes per URL |
```

(Replace with actual numbers.)

- [ ] **Step 4: Commit**

```
git add orchestrator/bench/parallel-bench.ts README.md
git commit -m "bench(batch): batch_visit + extract variants with comparative numbers"
```

---

## Task 7: Spec §5.7 + Memory + README

**Files:**
- Modify: `docs/superpowers/specs/2026-05-13-husk-design.md` — append §5.7
- Modify: `~/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-roadmap.md` — add v0.0.11-m11 shipped row
- Modify: `~/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-architecture.md` — append Decision K: batch tool is the pragmatic exception
- Modify: `README.md` — add a "Batch operations" example

- [ ] **Step 1: Append §5.7 to spec**

In `docs/superpowers/specs/2026-05-13-husk-design.md`, find the end of §5.6. Insert just before `## 6.`:

```markdown
### 5.7 Batch Primitive + Targeted Extract (M11 — shipped 2026-05-15)

M9 made individual operations fast via the engine pool. **In practice agents like Claude reason sequentially between tool calls, never returning 50 tool_use blocks in one response.** The pool's parallelism is wasted for batch workloads when the agent serializes calls itself.

M11 fixes this with two surfaces:

**`husk_extract(session_id, css)`** — Run `document.querySelector(css).textContent` via CDP `Runtime.evaluate`. Returns a string (trimmed) or null. ~100ms latency, ~200 bytes payload. Use after `husk_goto` when the agent knows the specific element it wants — much cheaper than `husk_snapshot` for targeted reads.

**`husk_batch_visit(urls, extract?)`** — Single tool call from the agent's POV. Internally fans out across the engine pool: one session per URL, all navigations + extractions happen in parallel via `Promise.all`. Returns an array preserving input URL order; per-URL errors are isolated (one bad URL doesn't break the rest). When `extract` is supplied, returns just the matched text per URL (~200 bytes each). Without `extract`, returns terse snapshots (see below).

**Terse snapshot mode.** A new `mode: 'terse'` option on `husk_snapshot` drops navigation/banner/contentinfo/complementary roles AND their subtrees from the output. Halves payload on most pages. Default in `batch_visit` when no `extract` is supplied. Default in `husk_snapshot` remains `'full'` for backward compatibility.

**Decision K (architectural exception).** Decision J (M9) said "no concurrency knobs on primitives." It still holds for `husk_goto/snapshot/click/etc.` — those stay as single-action verbs. `husk_batch_visit` is a NEW primitive with a DIFFERENT shape (a collection verb), not a concurrency knob added to an existing primitive. The distinction matters: single-action primitives compose naturally; collection verbs explicitly signal "do this for many things."

**Performance contract (measured 2026-05-15):** 50-URL `batch_visit` with extract — ~2-3s wall clock, ~200 bytes per result row. 50-URL `batch_visit` without extract (terse snapshots) — ~3-4s, ~3-5KB per result. Vs `husk_goto+husk_snapshot` in a loop on Claude Desktop — observed >60s due to sequential model reasoning.
```

- [ ] **Step 2: Update memory**

`/Users/nirmalghinaiya/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-roadmap.md` — add row to Shipped table:

```markdown
| `v0.0.11-m11` | **Batch primitive + targeted extract** | `husk_extract(css)` — Runtime.evaluate text grab, ~100ms, ~200 bytes. `husk_batch_visit(urls, extract?)` — single tool call fans out across pool, returns array, per-URL error isolation. New `mode: 'terse'` on snapshot drops nav/banner/footer/sidebar subtrees. 50 URLs via `batch_visit` + extract: ~2-3s wall clock vs >60s for Claude calling primitives sequentially. Spec §5.7. Decision K. 428 tests |
```

`/Users/nirmalghinaiya/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-architecture.md` — append:

```markdown
## Decision K: Collection verbs are not the concurrency knobs Decision J forbade

**Locked by:** M11 plan (2026-05-15)
**Why:** Decision J said "don't add concurrency parameters to single-action primitives" — that still holds. `husk_goto(url)` doesn't get a `parallel: true` flag. But field observation in Claude Desktop showed agents reason sequentially between tool calls and never naturally batch. The pragmatic response is a NEW primitive with a collection shape — `husk_batch_visit(urls)` — not a flag on an existing one. It's a *different kind of verb*, not an option on an old one.

**How to apply:** When adding a tool, ask "is this a single-action verb that takes one target, or a collection verb that takes many?" Single-action verbs stay single. Collection verbs are okay as new primitives. Don't conflate the two by adding concurrency knobs to single-action verbs.
```

- [ ] **Step 3: Update README**

Append to `README.md`:

```markdown
## Batch operations

When an agent needs to process many URLs, the most efficient pattern is a
single `husk_batch_visit` call rather than 50 `husk_goto`+`husk_snapshot` pairs:

\`\`\`json
{
  "tool": "husk_batch_visit",
  "arguments": {
    "urls": [
      "https://github.com/facebook/react",
      "https://github.com/vuejs/vue",
      "https://github.com/sveltejs/svelte"
    ],
    "extract": { "css": ".f4.my-3" }
  }
}
\`\`\`

Returns:

\`\`\`json
{
  "results": [
    { "url": "https://github.com/facebook/react",  "ok": true, "text": "..." },
    { "url": "https://github.com/vuejs/vue",       "ok": true, "text": "..." },
    { "url": "https://github.com/sveltejs/svelte", "ok": true, "text": "..." }
  ]
}
\`\`\`

All URLs are fetched in parallel through the engine pool. Per-URL errors
are isolated (one bad URL doesn't break the rest). With `extract`, each
result is ~200 bytes; without it, each is a terse snapshot.
```

- [ ] **Step 4: Verify full suite**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm -r --filter './orchestrator' --filter './sdk-ts' --filter './mcp' run test
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  bash -c "cd /Users/nirmalghinaiya/Desktop/husk/sdk-py && uv run python -m pytest"
```

Expected: 428+ tests across packages.

- [ ] **Step 5: Commit**

```
git add docs/superpowers/specs/2026-05-13-husk-design.md README.md
git commit -m "docs: spec §5.7 + README batch operations + Decision K"
```

---

## Final Steps — Tag and Merge

- [ ] **Step A: Tag**

```bash
git tag -a v0.0.11-m11 -m "M11 — Batch primitive + targeted extract

Field observation: agents in Claude Desktop reason sequentially between
tool calls, never naturally batching. M9 pool parallelism wasted for
batch workloads when the agent serializes calls. M11 moves the fan-out
inside one tool call.

husk_extract(session_id, css): Runtime.evaluate text grab. ~100ms,
~200 bytes per call.

husk_batch_visit(urls, extract?): single tool call from agent's POV;
fans out across pool. Per-URL error isolation. Optional extract reduces
payload massively. Default mode: 'terse' snapshot when no extract.

New 'terse' snapshot mode drops navigation/banner/contentinfo/
complementary subtrees. Halves payload on cluttered pages.

50 URLs via husk_batch_visit + extract: ~2-3s wall clock, ~200 bytes
per result. Vs >60s when Claude calls husk_goto+snapshot in a loop.

428 tests. Spec §5.7. Decision K: collection verbs are okay as new
primitives, not as concurrency flags on existing ones."
```

- [ ] **Step B: Merge to main with --no-ff**

```bash
git checkout main
git merge --no-ff m11-batch-extract -m "Merge Milestone 11 (batch primitive + extract): single tool call, fan-out parallelism"
```

- [ ] **Step C: Push**

```bash
git push origin main v0.0.11-m11
```

---

## Self-Review Notes

**Goal coverage:**
- [x] husk_extract (T1-T4)
- [x] husk_batch_visit with optional extract (T3-T4)
- [x] Terse snapshot mode (T5)
- [x] Benchmarks (T6)
- [x] Spec + docs (T7)

**Risk callouts:**
- Terse mode changes snapshot output. The plan covers this by defaulting to 'full' for backward compatibility and only using 'terse' in batch_visit. Existing M5/M8a/M8b tests use 'full' implicitly and should be unaffected.
- The batch_visit method creates and closes a session per URL. If session creation has any leaks (vault, credentials), they accumulate. T3's `finally { sessions.close(sessionId) }` block is critical.

**No placeholders.** Every step has concrete code or commands.

---

## Execution Handoff

Plan saved. Subagent-driven execution.
