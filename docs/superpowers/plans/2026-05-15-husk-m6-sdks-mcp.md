# M6 SDKs + Watchdog-Aware MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@husk/sdk` (TypeScript) and `husk-sdk` (Python) fully functional clients of the Husk JSON-RPC server, and rebuild `@husk/mcp` to route tool calls through the Husk orchestrator (gaining watchdog enforcement) instead of proxying lightpanda's MCP directly.

**Architecture:** Both SDKs are thin clients over JSON-RPC at `POST /v1/jsonrpc`. They redefine wire types locally (no dependency on the orchestrator package) so consumers pull only HTTP + minimal deps. Class shape: `Husk` factory → `Session` with `goto/snapshot/snapshotDiff/click/type/scroll/pressKey/setPolicy/close`. Rejection envelopes are returned as data, not thrown — agents inspect `result.ok` to decide whether to re-plan. The MCP rebuild keeps its Husk-branded tool surface (M2.5) but replaces its lightpanda-MCP backend with a subprocess-managed `husk start` and an internal JSON-RPC client.

**Tech Stack:** TS SDK — native `fetch` (Node 20+). Python SDK — `httpx[async]` + dataclasses (no pydantic; keep deps minimal). MCP rebuild — reuses the SDK transport via direct JSON-RPC over `node:http`. `vitest` for TS, `pytest-asyncio` for Python.

**Spec reference:** `docs/superpowers/specs/2026-05-13-husk-design.md` §6 Interfaces 1 + 3.

**Scope cut:** Examples (`examples/01-wikipedia-research`, etc.) and tool manifests (`husk-tools.openai.json` etc.) are deferred to M6.5/M7 per the explicit decision on 2026-05-15. M6 ships infrastructure only.

---

## File Structure

### TS SDK (`sdk-ts/`)

| Path | Responsibility |
|---|---|
| `sdk-ts/src/types.ts` | Wire types: `Verb`, `Snapshot`, `SnapshotNode`, `Candidate`, `RejectionEnvelope`, `Warning`, `PolicyDocument`, `ActionResult` — matches orchestrator HTTP wire format byte-for-byte |
| `sdk-ts/src/transport.ts` | `JsonRpcClient` — fetch-based POST to `/v1/jsonrpc`, request-id management, error mapping |
| `sdk-ts/src/snapshot.ts` | `findInSnapshot()` helper + `Snapshot.find()` convenience |
| `sdk-ts/src/session.ts` | `Session` class — exposes the action API |
| `sdk-ts/src/index.ts` | `Husk` factory + barrel re-exports |
| `sdk-ts/tests/types.test.ts` | Type-only tests |
| `sdk-ts/tests/transport.test.ts` | Mocked fetch, request/response, error mapping |
| `sdk-ts/tests/session.test.ts` | Session API surface tests |
| `sdk-ts/tests/snapshot.test.ts` | find() walker tests |
| `sdk-ts/tests/integration/sdk-e2e.test.ts` | Real `husk start` subprocess + driven session |

### Python SDK (`sdk-py/`)

| Path | Responsibility |
|---|---|
| `sdk-py/husk/_types.py` | Dataclass mirror of TS types |
| `sdk-py/husk/_transport.py` | `JsonRpcClient` — httpx async |
| `sdk-py/husk/_snapshot.py` | `find_in_snapshot()` + Snapshot.find() bound method |
| `sdk-py/husk/_session.py` | `Session` async class |
| `sdk-py/husk/__init__.py` | `Husk` async context manager + re-exports |
| `sdk-py/tests/test_types.py` | Dataclass parsing |
| `sdk-py/tests/test_transport.py` | Mocked httpx |
| `sdk-py/tests/test_session.py` | Session API |
| `sdk-py/tests/test_snapshot.py` | find() tests |
| `sdk-py/tests/integration/test_sdk_e2e.py` | Real `husk start` driven session |

### MCP rebuild (`mcp/`)

| Path | Responsibility |
|---|---|
| `mcp/src/orchestrator.ts` | NEW: spawn `husk start` subprocess, lifecycle, port discovery |
| `mcp/src/client.ts` | NEW: minimal Husk JSON-RPC client (no SDK dep — MCP must be self-contained) |
| `mcp/src/proxy.ts` | REWRITE: route tool calls through `client.ts` instead of lightpanda's MCP stdio. The old lightpanda-MCP transport is removed |
| `mcp/src/tool-surface.ts` | NEW: declarative tool list (replaces `tool-map.ts`'s bidirectional rebranding). Each tool maps to a JSON-RPC method + param schema |
| `mcp/src/binary.ts` | KEEP — used to locate lightpanda for orchestrator startup |
| `mcp/src/husk-tools.ts` | KEEP — `husk_version` native tool |
| `mcp/src/index.ts` | MODIFY: spawn orchestrator subprocess instead of lightpanda MCP |
| `mcp/src/tool-map.ts` | DELETE — old bidirectional rebranding obsolete |
| `mcp/src/transform.ts` | DELETE — lightpanda-MCP response rewriting obsolete |
| `mcp/tests/orchestrator.test.ts` | NEW |
| `mcp/tests/client.test.ts` | NEW |
| `mcp/tests/tool-surface.test.ts` | NEW |
| `mcp/tests/integration/mcp-e2e.test.ts` | Real husk-mcp subprocess driven via stdio JSON-RPC |

---

## Test Counts at Each Stage

| After task | Cumulative orchestrator + sdk-ts + sdk-py + mcp tests |
|---|---|
| T1 (TS types) | 173 + 3 = 176 |
| T2 (TS transport) | 176 + 6 = 182 |
| T3 (TS Session) | 182 + 8 = 190 |
| T4 (TS snapshot.find) | 190 + 5 = 195 |
| T5 (TS integration) | 195 + 2 = 197 |
| T6 (Py types) | 197 + 4 = 201 |
| T7 (Py transport) | 201 + 6 = 207 |
| T8 (Py Session) | 207 + 8 = 215 |
| T9 (Py snapshot.find) | 215 + 5 = 220 |
| T10 (Py integration) | 220 + 2 = 222 |
| T11 (MCP orchestrator subprocess) | 222 + 4 = 226 |
| T12 (MCP tool surface + client) | 226 + 6 = 232 |
| T13 (MCP integration) | 232 + 2 = **234** |

Integration tests SKIP cleanly when `LIGHTPANDA_BIN` is unset.

---

## Task 1: TS SDK Wire Types

**Files:**
- Create: `sdk-ts/src/types.ts`
- Create: `sdk-ts/tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

`sdk-ts/tests/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type {
  Snapshot,
  SnapshotNode,
  RejectionEnvelope,
  ActionResult,
  Warning,
  PolicyDocument,
  Verb,
} from "../src/types.js";

describe("wire types", () => {
  it("Snapshot matches orchestrator wire format (v=1, url, count, root)", () => {
    const s: Snapshot = {
      v: 1,
      url: "https://x.test",
      count: 1,
      root: { i: "RootWebArea:r", r: "RootWebArea", n: "Page", s: ["v"] },
    };
    expect(s.v).toBe(1);
    expect(s.root.i).toBe("RootWebArea:r");
  });

  it("RejectionEnvelope is a discriminated union via ok:false", () => {
    const e: RejectionEnvelope = {
      ok: false,
      reason: "element_not_found",
      verb: "click",
      stable_id_attempted: "button:ghost",
      candidates: [],
      snapshot_at_attempt: { v: 1, url: "", count: 0, root: { i: "x", r: "x", n: "", s: [] } },
    };
    expect(e.ok).toBe(false);
  });

  it("ActionResult discriminates ok via the literal type", () => {
    const success: ActionResult = { ok: true, warnings: [] as Warning[] };
    const failure: ActionResult = {
      ok: false, reason: "element_disabled", verb: "click",
      stable_id_attempted: "x", candidates: [],
      snapshot_at_attempt: { v: 1, url: "", count: 0, root: { i: "x", r: "x", n: "", s: [] } },
    };
    expect(success.ok && "warnings" in success).toBe(true);
    expect(!failure.ok && "reason" in failure).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/sdk vitest run types
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types**

`sdk-ts/src/types.ts`:

```typescript
/**
 * Wire types for the Husk JSON-RPC v1 API. These mirror what
 * `orchestrator/src/http/methods.ts` returns — kept in sync by tests,
 * not via shared imports (the SDK has no orchestrator dependency).
 */

export type Verb = "click" | "type" | "scroll" | "press_key";

export type SnapshotStateFlag = "e" | "v" | "c" | "f" | "d";

export interface SnapshotNode {
  /** Stable ID — `{role}:{blake3 base64}[16]`. */
  i: string;
  /** ARIA role. */
  r: string;
  /** Accessible name (raw, not normalized). */
  n: string;
  /** State flags. */
  s: SnapshotStateFlag[];
  /** Optional raw text (only present for r === "text"). */
  t?: string;
  /** Children. */
  c?: SnapshotNode[];
}

export interface Snapshot {
  v: 1;
  url: string;
  count: number;
  root: SnapshotNode;
}

export interface SnapshotDiff {
  added: SnapshotNode[];
  removed: string[];
  changed: Array<{ id: string; before: SnapshotNode; after: SnapshotNode }>;
}

export interface Candidate {
  stable_id: string;
  role: string;
  name: string;
  score: number;
}

export type RejectionReason =
  | "element_not_found"
  | "element_not_visible"
  | "element_disabled"
  | "wrong_role_for_action"
  | "policy_forbidden"
  | "policy_required_before"
  | "policy_domain_denied";

export interface RejectionEnvelope {
  ok: false;
  reason: RejectionReason;
  verb: Verb;
  stable_id_attempted: string | null;
  candidates: Candidate[];
  snapshot_at_attempt: Snapshot;
  message?: string;
}

export type WarningReason =
  | "no_mutation_observed"
  | "error_alert_appeared"
  | "unexpected_navigation"
  | "policy_warn";

export interface Warning {
  reason: WarningReason;
  message: string;
}

export type ActionResult = { ok: true; warnings: Warning[] } | RejectionEnvelope;

// ----- Policy types (parsed server-side via set_policy; SDK sends raw YAML) -----

export type Severity = "hard" | "warn";

export interface ForbiddenRule {
  role?: string;
  name_matches?: string;
  selector?: string;
  on?: Verb;
  severity: Severity;
  message?: string;
}

export interface PrereqClause {
  role: string;
  name_matches: string;
  state: "checked" | "enabled" | "visible" | "focused" | "disabled";
}

export interface RequiredBeforeRule {
  action: Verb | "submit_form";
  prereq: PrereqClause[];
}

export interface PolicyDocument {
  flow?: string;
  forbidden?: ForbiddenRule[];
  required_before?: RequiredBeforeRule[];
  allow_domains?: string[];
  deny_domains?: string[];
}

// ----- JSON-RPC envelope types -----

export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
}

export interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JsonRpcErrorPayload;
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;
```

- [ ] **Step 4: Run, verify PASS**

```
pnpm --filter @husk/sdk vitest run types
pnpm --filter @husk/sdk typecheck
```
Expected: 3 tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add sdk-ts/src/types.ts sdk-ts/tests/types.test.ts
git commit -m "feat(sdk-ts): wire types matching orchestrator HTTP API"
```

---

## Task 2: TS SDK JSON-RPC Transport

**Files:**
- Create: `sdk-ts/src/transport.ts`
- Create: `sdk-ts/tests/transport.test.ts`

- [ ] **Step 1: Write the failing test**

`sdk-ts/tests/transport.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { JsonRpcClient, JsonRpcTransportError } from "../src/transport.js";

describe("JsonRpcClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts JSON-RPC envelope and returns the result", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true, version: "0.0.0", activeSessions: 0 } }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const c = new JsonRpcClient({ baseUrl: "http://x.test" });
    const r = await c.call("health", {});
    expect(r).toEqual({ ok: true, version: "0.0.0", activeSessions: 0 });

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe("http://x.test/v1/jsonrpc");
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("health");
    expect(body.params).toEqual({});
    expect(typeof body.id).toBe("number");
  });

  it("auto-increments request ids", async () => {
    const ids: unknown[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      ids.push(body.id);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const c = new JsonRpcClient({ baseUrl: "http://x.test" });
    await c.call("health", {});
    await c.call("health", {});
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("throws JsonRpcTransportError when HTTP status is non-200", async () => {
    globalThis.fetch = (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const c = new JsonRpcClient({ baseUrl: "http://x.test" });
    await expect(c.call("health", {})).rejects.toThrow(JsonRpcTransportError);
  });

  it("throws JsonRpcTransportError when body is not valid JSON", async () => {
    globalThis.fetch = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    const c = new JsonRpcClient({ baseUrl: "http://x.test" });
    await expect(c.call("health", {})).rejects.toThrow(JsonRpcTransportError);
  });

  it("throws an Error with the JSON-RPC error payload on { error } response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Session not found: x" } }), { status: 200 })
    ) as unknown as typeof fetch;
    const c = new JsonRpcClient({ baseUrl: "http://x.test" });
    await expect(c.call("goto", { session_id: "x", url: "http://y" })).rejects.toThrow(/Session not found/);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const c = new JsonRpcClient({ baseUrl: "http://x.test/" });
    await c.call("health", {});
    expect(fetchMock.mock.calls[0][0]).toBe("http://x.test/v1/jsonrpc");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/sdk vitest run transport
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement transport**

`sdk-ts/src/transport.ts`:

```typescript
import type { JsonRpcResponse } from "./types.js";

export class JsonRpcTransportError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "JsonRpcTransportError";
  }
}

export class HuskApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "HuskApiError";
  }
}

export interface JsonRpcClientOptions {
  /** e.g. "http://localhost:7777" — trailing slash is stripped. */
  baseUrl: string;
  /** Optional fetch override (for tests + custom transports). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Minimal JSON-RPC 2.0 client over HTTP POST. v0 binds to /v1/jsonrpc on
 * the orchestrator. No retry, no batching, no timeout (caller handles).
 */
export class JsonRpcClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private nextId = 0;

  constructor(opts: JsonRpcClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /**
   * Invoke a JSON-RPC method. Returns the `result` payload on success or
   * throws `HuskApiError` (server returned `error`) or
   * `JsonRpcTransportError` (HTTP/parse issue).
   */
  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.nextId;
    const url = `${this.baseUrl}/v1/jsonrpc`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch (e) {
      throw new JsonRpcTransportError(`Fetch failed: ${(e as Error).message}`, e);
    }
    if (!res.ok) {
      throw new JsonRpcTransportError(`HTTP ${res.status} from ${url}`);
    }
    let body: JsonRpcResponse<T>;
    try {
      body = (await res.json()) as JsonRpcResponse<T>;
    } catch (e) {
      throw new JsonRpcTransportError("Response body was not valid JSON", e);
    }
    if ("error" in body) {
      throw new HuskApiError(body.error.message, body.error.code, body.error.data);
    }
    return body.result;
  }
}
```

- [ ] **Step 4: Run, verify PASS**

```
pnpm --filter @husk/sdk vitest run transport
pnpm --filter @husk/sdk typecheck
```
Expected: 6 tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add sdk-ts/src/transport.ts sdk-ts/tests/transport.test.ts
git commit -m "feat(sdk-ts): JsonRpcClient — fetch-based JSON-RPC transport"
```

---

## Task 3: TS SDK Session Class

**Files:**
- Create: `sdk-ts/src/session.ts`
- Modify: `sdk-ts/src/index.ts` (replace placeholder Husk with the functional one)
- Create: `sdk-ts/tests/session.test.ts`

- [ ] **Step 1: Write the failing test**

`sdk-ts/tests/session.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { Husk } from "../src/index.js";
import type { ActionResult } from "../src/types.js";

function makeMockFetch(routes: Record<string, (params: Record<string, unknown>) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const handler = routes[body.method];
    if (!handler) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `Method not found: ${body.method}` } }),
        { status: 200 }
      );
    }
    const result = handler(body.params);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { status: 200 }
    );
  });
}

describe("Husk + Session", () => {
  it("createSession returns a Session bound to the returned id", async () => {
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "abc-123" }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    expect(s.id).toBe("abc-123");
  });

  it("session.goto forwards to JSON-RPC goto", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "s1" }),
      goto: (p) => { calls.push({ method: "goto", params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    await s.goto("https://example.com");
    expect(calls).toContainEqual({ method: "goto", params: { session_id: "s1", url: "https://example.com" } });
  });

  it("session.snapshot returns the Snapshot result verbatim", async () => {
    const snap = { v: 1, url: "https://example.com", count: 1, root: { i: "x:1", r: "x", n: "", s: [] } };
    const h = new Husk({
      baseUrl: "http://x.test",
      fetch: makeMockFetch({ create_session: () => ({ session_id: "s1" }), snapshot: () => snap }) as unknown as typeof fetch,
    });
    const s = await h.createSession();
    const got = await s.snapshot();
    expect(got).toEqual(snap);
  });

  it("session.click returns ActionResult — successful path carries warnings", async () => {
    const h = new Husk({
      baseUrl: "http://x.test",
      fetch: makeMockFetch({
        create_session: () => ({ session_id: "s1" }),
        click: () => ({ ok: true, warnings: [] }),
      }) as unknown as typeof fetch,
    });
    const s = await h.createSession();
    const r: ActionResult = await s.click("button:ok");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it("session.click returns rejection envelope verbatim — agent re-plans", async () => {
    const snap = { v: 1, url: "", count: 0, root: { i: "x", r: "x", n: "", s: [] } };
    const h = new Husk({
      baseUrl: "http://x.test",
      fetch: makeMockFetch({
        create_session: () => ({ session_id: "s1" }),
        click: () => ({
          ok: false, reason: "element_not_found", verb: "click",
          stable_id_attempted: "button:ghost", candidates: [], snapshot_at_attempt: snap,
        }),
      }) as unknown as typeof fetch,
    });
    const s = await h.createSession();
    const r = await s.click("button:ghost");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("element_not_found");
      expect(r.candidates).toEqual([]);
    }
  });

  it("session.type / scroll / pressKey / close all forward correctly", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const trace = (m: string) => (p: Record<string, unknown>) => { calls.push({ method: m, params: p }); return { ok: true, warnings: [] }; };
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "s1" }),
      type: trace("type"),
      scroll: trace("scroll"),
      press_key: trace("press_key"),
      close_session: trace("close_session"),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    await s.type("textbox:e", "hi");
    await s.scroll(null, "down", 300);
    await s.pressKey("Enter");
    await s.close();
    expect(calls.map((c) => c.method)).toEqual(["type", "scroll", "press_key", "close_session"]);
    expect(calls[0].params).toEqual({ session_id: "s1", stable_id: "textbox:e", text: "hi" });
    expect(calls[1].params).toEqual({ session_id: "s1", stable_id: null, direction: "down", amount: 300 });
    expect(calls[2].params).toEqual({ session_id: "s1", key: "Enter" });
    expect(calls[3].params).toEqual({ session_id: "s1" });
  });

  it("setPolicy sends raw YAML via set_policy", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "s1" }),
      set_policy: (p) => { calls.push({ method: "set_policy", params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    await s.setPolicy("forbidden: []");
    expect(calls[0].params).toEqual({ session_id: "s1", policy_yaml: "forbidden: []" });
    await s.setPolicy(null);
    expect(calls[1].params).toEqual({ session_id: "s1", policy_yaml: null });
  });

  it("Husk.health proxies to the JSON-RPC health method", async () => {
    const h = new Husk({
      baseUrl: "http://x.test",
      fetch: makeMockFetch({ health: () => ({ ok: true, version: "0.0.0", activeSessions: 0 }) }) as unknown as typeof fetch,
    });
    const r = await h.health();
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/sdk vitest run session
```
Expected: FAIL — Husk doesn't export createSession yet.

- [ ] **Step 3: Implement `Session`**

`sdk-ts/src/session.ts`:

```typescript
import type { JsonRpcClient } from "./transport.js";
import type {
  ActionResult,
  Snapshot,
  SnapshotDiff,
} from "./types.js";

export type ScrollDirection = "up" | "down" | "left" | "right" | "into_view";

/**
 * Per-session API. One instance per session_id. All methods are thin
 * wrappers over the JSON-RPC server — no client-side state aside from
 * the id.
 */
export class Session {
  constructor(private readonly client: JsonRpcClient, public readonly id: string) {}

  async goto(url: string): Promise<void> {
    await this.client.call<{ ok: true }>("goto", { session_id: this.id, url });
  }

  async snapshot(): Promise<Snapshot> {
    return await this.client.call<Snapshot>("snapshot", { session_id: this.id });
  }

  async snapshotDiff(): Promise<SnapshotDiff | null> {
    return await this.client.call<SnapshotDiff | null>("snapshot_diff", { session_id: this.id });
  }

  async click(stable_id: string): Promise<ActionResult> {
    return await this.client.call<ActionResult>("click", { session_id: this.id, stable_id });
  }

  async type(stable_id: string, text: string): Promise<ActionResult> {
    return await this.client.call<ActionResult>("type", { session_id: this.id, stable_id, text });
  }

  async scroll(stable_id: string | null, direction: ScrollDirection, amount: number): Promise<ActionResult> {
    return await this.client.call<ActionResult>("scroll", { session_id: this.id, stable_id, direction, amount });
  }

  async pressKey(key: string): Promise<ActionResult> {
    return await this.client.call<ActionResult>("press_key", { session_id: this.id, key });
  }

  async setPolicy(policy_yaml: string | null): Promise<void> {
    await this.client.call("set_policy", { session_id: this.id, policy_yaml });
  }

  async close(): Promise<void> {
    await this.client.call("close_session", { session_id: this.id });
  }
}
```

- [ ] **Step 4: Replace placeholder index.ts**

`sdk-ts/src/index.ts`:

```typescript
import { JsonRpcClient } from "./transport.js";
import { Session } from "./session.js";

export const SDK_VERSION = "0.0.0";

export interface HuskOptions {
  /** Orchestrator URL. Defaults to `http://localhost:7777`. */
  baseUrl?: string;
  /** Optional fetch override (tests / custom transports). */
  fetch?: typeof globalThis.fetch;
}

export interface HealthResult {
  ok: boolean;
  version: string;
  activeSessions: number;
}

const DEFAULT_BASE_URL = "http://localhost:7777";

/**
 * Husk SDK client. Entry point for agent code.
 *
 * ```ts
 * const h = new Husk({ baseUrl: "http://localhost:7777" });
 * const s = await h.createSession();
 * await s.goto("https://example.com");
 * const snap = await s.snapshot();
 * const r = await s.click("button:submit");
 * if (!r.ok) console.log("rejected:", r.reason, r.candidates);
 * ```
 */
export class Husk {
  public readonly baseUrl: string;
  private readonly client: JsonRpcClient;

  constructor(options: HuskOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.client = new JsonRpcClient({ baseUrl: this.baseUrl, fetch: options.fetch });
  }

  async createSession(): Promise<Session> {
    const { session_id } = await this.client.call<{ session_id: string }>("create_session", {});
    return new Session(this.client, session_id);
  }

  async health(): Promise<HealthResult> {
    return await this.client.call<HealthResult>("health", {});
  }
}

export { Session } from "./session.js";
export { JsonRpcClient, JsonRpcTransportError, HuskApiError } from "./transport.js";
export type { ScrollDirection } from "./session.js";
export * from "./types.js";
```

- [ ] **Step 5: Run, verify PASS**

```
pnpm --filter @husk/sdk vitest run
pnpm --filter @husk/sdk typecheck
```
Expected: 17 tests pass (3 types + 6 transport + 8 session), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add sdk-ts/src/session.ts sdk-ts/src/index.ts sdk-ts/tests/session.test.ts
git commit -m "feat(sdk-ts): Session + Husk classes wired to JSON-RPC"
```

---

## Task 4: TS SDK Snapshot.find()

**Files:**
- Create: `sdk-ts/src/snapshot.ts`
- Modify: `sdk-ts/src/index.ts` (re-export `findInSnapshot`)
- Create: `sdk-ts/tests/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

`sdk-ts/tests/snapshot.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { findInSnapshot } from "../src/snapshot.js";
import type { Snapshot } from "../src/types.js";

const snap: Snapshot = {
  v: 1, url: "https://x.test", count: 4,
  root: {
    i: "RootWebArea:r", r: "RootWebArea", n: "Page", s: ["v"],
    c: [
      { i: "heading:h", r: "heading", n: "Hello Husk", s: ["v"] },
      { i: "button:submit", r: "button", n: "Submit Application", s: ["v", "e"] },
      { i: "button:disabled", r: "button", n: "Disabled Button", s: ["v", "d"] },
      { i: "textbox:email", r: "textbox", n: "Email", s: ["v", "e"] },
    ],
  },
};

describe("findInSnapshot", () => {
  it("finds by exact role + nameMatches regex", () => {
    const hit = findInSnapshot(snap, { role: "button", nameMatches: /submit/i });
    expect(hit?.i).toBe("button:submit");
  });

  it("returns null when no match", () => {
    expect(findInSnapshot(snap, { role: "link" })).toBeNull();
  });

  it("matches by name substring (string passed)", () => {
    const hit = findInSnapshot(snap, { name: "Hello" });
    expect(hit?.i).toBe("heading:h");
  });

  it("findAll returns all matches", () => {
    const { findAllInSnapshot } = require("../src/snapshot.js");
    const all = findAllInSnapshot(snap, { role: "button" });
    expect(all.map((n: { i: string }) => n.i)).toEqual(["button:submit", "button:disabled"]);
  });

  it("supports role omitted (any role)", () => {
    const hit = findInSnapshot(snap, { nameMatches: /Email/ });
    expect(hit?.i).toBe("textbox:email");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/sdk vitest run snapshot
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `findInSnapshot`**

`sdk-ts/src/snapshot.ts`:

```typescript
import type { Snapshot, SnapshotNode } from "./types.js";

export interface FindCriteria {
  role?: string;
  /** Regex tested against node.n (the accessible name). */
  nameMatches?: RegExp;
  /** Substring tested against node.n (case-insensitive). */
  name?: string;
}

function matches(node: SnapshotNode, criteria: FindCriteria): boolean {
  if (criteria.role && node.r !== criteria.role) return false;
  if (criteria.nameMatches && !criteria.nameMatches.test(node.n)) return false;
  if (criteria.name && !node.n.toLowerCase().includes(criteria.name.toLowerCase())) return false;
  return true;
}

/** Depth-first search; returns the first match or null. */
export function findInSnapshot(snapshot: Snapshot, criteria: FindCriteria): SnapshotNode | null {
  return walkFind(snapshot.root, criteria);
}

function walkFind(node: SnapshotNode, c: FindCriteria): SnapshotNode | null {
  if (matches(node, c)) return node;
  for (const child of node.c ?? []) {
    const hit = walkFind(child, c);
    if (hit) return hit;
  }
  return null;
}

/** Depth-first search; returns all matches in document order. */
export function findAllInSnapshot(snapshot: Snapshot, criteria: FindCriteria): SnapshotNode[] {
  const out: SnapshotNode[] = [];
  walkAll(snapshot.root, criteria, out);
  return out;
}

function walkAll(node: SnapshotNode, c: FindCriteria, out: SnapshotNode[]): void {
  if (matches(node, c)) out.push(node);
  for (const child of node.c ?? []) walkAll(child, c, out);
}
```

- [ ] **Step 4: Update test to use ESM import**

Replace the `require` line in the test (since the SDK is ESM) with a proper top import:

In `sdk-ts/tests/snapshot.test.ts`, change `const { findAllInSnapshot } = require(...)` to add at the top:

```typescript
import { findInSnapshot, findAllInSnapshot } from "../src/snapshot.js";
```

And use `findAllInSnapshot` directly inside the test.

- [ ] **Step 5: Re-export from index**

Append to `sdk-ts/src/index.ts`:

```typescript
export { findInSnapshot, findAllInSnapshot } from "./snapshot.js";
export type { FindCriteria } from "./snapshot.js";
```

- [ ] **Step 6: Run, verify PASS**

```
pnpm --filter @husk/sdk vitest run
pnpm --filter @husk/sdk typecheck
```
Expected: 22 tests pass (17 + 5 snapshot), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add sdk-ts/src/snapshot.ts sdk-ts/src/index.ts sdk-ts/tests/snapshot.test.ts
git commit -m "feat(sdk-ts): findInSnapshot + findAllInSnapshot helpers"
```

---

## Task 5: TS SDK Integration Test

**Files:**
- Create: `sdk-ts/tests/integration/sdk-e2e.test.ts`
- Modify: `sdk-ts/package.json` (add a workspace dependency on the orchestrator package to import its bin into tests, OR locate the orchestrator dist via path)

We'll spawn the orchestrator from its built `dist/index.js` by path rather than as a runtime dep — this preserves SDK package independence.

- [ ] **Step 1: Ensure orchestrator is built first**

The integration test relies on `orchestrator/dist/index.js` existing. Verify before authoring:
```
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/dist/index.js
```
If missing, run `pnpm --filter husk-orchestrator build` first. The CI pipeline already builds it.

- [ ] **Step 2: Write the integration test**

`sdk-ts/tests/integration/sdk-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { Husk } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorPath = join(__dirname, "..", "..", "..", "orchestrator", "dist", "index.js");
const lightpandaBin = process.env.LIGHTPANDA_BIN;

async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

const integrationOrSkip = (lightpandaBin && existsSync(orchestratorPath)) ? describe : describe.skip;

integrationOrSkip("sdk e2e — real husk start", () => {
  it("createSession → goto → snapshot → close against real orchestrator", async () => {
    const port = await findFreePort();
    const proc: ChildProcess = spawn(
      "node",
      [orchestratorPath, "start", "--port", String(port), "--log-level", "silent"],
      { env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin }, stdio: "pipe" }
    );

    try {
      // Wait for /healthz-equivalent: poll JSON-RPC health until success or 15s.
      const deadline = Date.now() + 15_000;
      const husk = new Husk({ baseUrl: `http://127.0.0.1:${port}` });
      while (Date.now() < deadline) {
        try {
          const h = await husk.health();
          if (h.ok) break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      const session = await husk.createSession();
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);

      // Drive against example.com — lightpanda handles it fine
      await session.goto("https://example.com");
      const snap = await session.snapshot();
      expect(snap.count).toBeGreaterThan(0);
      expect(snap.root.r).toBe("RootWebArea");

      await session.close();
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 45_000);

  it("click on a non-existent stable_id returns a rejection envelope", async () => {
    const port = await findFreePort();
    const proc = spawn(
      "node",
      [orchestratorPath, "start", "--port", String(port), "--log-level", "silent"],
      { env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin }, stdio: "pipe" }
    );

    try {
      const husk = new Husk({ baseUrl: `http://127.0.0.1:${port}` });
      // Wait for ready
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        try { if ((await husk.health()).ok) break; }
        catch { await new Promise((r) => setTimeout(r, 200)); }
      }
      const session = await husk.createSession();
      await session.goto("https://example.com");
      await session.snapshot();

      const result = await session.click("button:totally-fake");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("element_not_found");
        expect(Array.isArray(result.candidates)).toBe(true);
      }
      await session.close();
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 45_000);
});
```

- [ ] **Step 3: Run with LIGHTPANDA_BIN set**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter @husk/sdk vitest run integration
```
Expected: 2 tests pass.

- [ ] **Step 4: Run without LIGHTPANDA_BIN — verify graceful skip**

```
pnpm --filter @husk/sdk vitest run integration
```
Expected: SKIP, no failure.

- [ ] **Step 5: Run full SDK suite + typecheck**

```
pnpm --filter @husk/sdk vitest run
pnpm --filter @husk/sdk typecheck
```

- [ ] **Step 6: Commit**

```bash
git add sdk-ts/tests/integration/sdk-e2e.test.ts
git commit -m "test(sdk-ts): real-orchestrator e2e for createSession/goto/snapshot/click"
```

---

## Task 6: Python SDK Wire Types

**Files:**
- Modify: `sdk-py/pyproject.toml` (add `httpx` to runtime deps)
- Create: `sdk-py/husk/_types.py`
- Create: `sdk-py/tests/test_types.py`

- [ ] **Step 1: Update pyproject.toml**

Edit `sdk-py/pyproject.toml`. Change `dependencies = []` to:
```toml
dependencies = ["httpx>=0.27"]
```

Add `pytest-mock>=3.12` to `[project.optional-dependencies].dev` if not present.

Sync: `cd sdk-py && uv sync --extra dev` (or whatever python toolchain is wired — check existing `uv.lock` for the pattern).

- [ ] **Step 2: Write failing tests**

`sdk-py/tests/test_types.py`:

```python
"""Wire-type round-trip tests."""
from __future__ import annotations
import pytest
from husk._types import (
    Snapshot,
    SnapshotNode,
    RejectionEnvelope,
    parse_action_result,
    parse_snapshot,
)


def test_snapshot_parses_basic_payload() -> None:
    payload = {
        "v": 1,
        "url": "https://x.test",
        "count": 1,
        "root": {"i": "RootWebArea:r", "r": "RootWebArea", "n": "Page", "s": ["v"]},
    }
    snap = parse_snapshot(payload)
    assert snap.v == 1
    assert snap.root.i == "RootWebArea:r"
    assert snap.root.s == ("v",)
    assert snap.root.c == ()


def test_snapshot_walks_nested_children() -> None:
    payload = {
        "v": 1, "url": "", "count": 2,
        "root": {
            "i": "r:1", "r": "r", "n": "", "s": [],
            "c": [{"i": "b:1", "r": "button", "n": "OK", "s": ["v", "e"]}],
        },
    }
    snap = parse_snapshot(payload)
    assert len(snap.root.c) == 1
    assert snap.root.c[0].r == "button"


def test_parse_action_result_success_path() -> None:
    r = parse_action_result({"ok": True, "warnings": []})
    assert r.ok is True
    assert r.warnings == ()


def test_parse_action_result_rejection_path() -> None:
    payload = {
        "ok": False, "reason": "element_not_found", "verb": "click",
        "stable_id_attempted": "button:ghost", "candidates": [],
        "snapshot_at_attempt": {
            "v": 1, "url": "", "count": 0,
            "root": {"i": "x", "r": "x", "n": "", "s": []},
        },
    }
    r = parse_action_result(payload)
    assert r.ok is False
    assert isinstance(r, RejectionEnvelope)
    assert r.reason == "element_not_found"
    assert r.candidates == ()
```

- [ ] **Step 3: Run, verify FAIL**

```
cd sdk-py && uv run pytest tests/test_types.py
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement types**

`sdk-py/husk/_types.py`:

```python
"""Wire types for Husk JSON-RPC v1.

Mirrors `orchestrator/src/http/methods.ts` return shapes. Kept in sync via tests,
not via shared imports (the SDK has no orchestrator dependency).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Optional, Sequence, Union


Verb = Literal["click", "type", "scroll", "press_key"]
SnapshotStateFlag = Literal["e", "v", "c", "f", "d"]
RejectionReason = Literal[
    "element_not_found",
    "element_not_visible",
    "element_disabled",
    "wrong_role_for_action",
    "policy_forbidden",
    "policy_required_before",
    "policy_domain_denied",
]
WarningReason = Literal[
    "no_mutation_observed",
    "error_alert_appeared",
    "unexpected_navigation",
    "policy_warn",
]


@dataclass(frozen=True, slots=True)
class SnapshotNode:
    i: str
    r: str
    n: str
    s: tuple[SnapshotStateFlag, ...] = ()
    t: Optional[str] = None
    c: tuple["SnapshotNode", ...] = ()


@dataclass(frozen=True, slots=True)
class Snapshot:
    v: Literal[1]
    url: str
    count: int
    root: SnapshotNode


@dataclass(frozen=True, slots=True)
class SnapshotDiff:
    added: tuple[SnapshotNode, ...]
    removed: tuple[str, ...]
    changed: tuple[Mapping[str, Any], ...]


@dataclass(frozen=True, slots=True)
class Candidate:
    stable_id: str
    role: str
    name: str
    score: float


@dataclass(frozen=True, slots=True)
class Warning_:  # `Warning` shadows Python's builtin; expose as `Warning` via __init__
    reason: WarningReason
    message: str


@dataclass(frozen=True, slots=True)
class SuccessResult:
    ok: Literal[True]
    warnings: tuple[Warning_, ...] = ()


@dataclass(frozen=True, slots=True)
class RejectionEnvelope:
    ok: Literal[False]
    reason: RejectionReason
    verb: Verb
    stable_id_attempted: Optional[str]
    candidates: tuple[Candidate, ...]
    snapshot_at_attempt: Snapshot
    message: Optional[str] = None


ActionResult = Union[SuccessResult, RejectionEnvelope]


# ----- Parsers (raw dict from JSON → dataclass) -----

def parse_snapshot(d: Mapping[str, Any]) -> Snapshot:
    return Snapshot(
        v=1,
        url=d["url"],
        count=d["count"],
        root=_parse_node(d["root"]),
    )


def _parse_node(d: Mapping[str, Any]) -> SnapshotNode:
    return SnapshotNode(
        i=d["i"],
        r=d["r"],
        n=d["n"],
        s=tuple(d.get("s", [])),
        t=d.get("t"),
        c=tuple(_parse_node(c) for c in d.get("c", [])),
    )


def parse_action_result(d: Mapping[str, Any]) -> ActionResult:
    if d.get("ok") is True:
        return SuccessResult(
            ok=True,
            warnings=tuple(Warning_(reason=w["reason"], message=w["message"]) for w in d.get("warnings", [])),
        )
    return RejectionEnvelope(
        ok=False,
        reason=d["reason"],
        verb=d["verb"],
        stable_id_attempted=d.get("stable_id_attempted"),
        candidates=tuple(
            Candidate(
                stable_id=c["stable_id"], role=c["role"], name=c["name"], score=c["score"]
            )
            for c in d.get("candidates", [])
        ),
        snapshot_at_attempt=parse_snapshot(d["snapshot_at_attempt"]),
        message=d.get("message"),
    )
```

- [ ] **Step 5: Run, verify PASS**

```
cd sdk-py && uv run pytest tests/test_types.py
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add sdk-py/pyproject.toml sdk-py/uv.lock sdk-py/husk/_types.py sdk-py/tests/test_types.py
git commit -m "feat(sdk-py): wire dataclasses + parsers matching orchestrator HTTP API"
```

---

## Task 7: Python SDK JSON-RPC Transport

**Files:**
- Create: `sdk-py/husk/_transport.py`
- Create: `sdk-py/tests/test_transport.py`

- [ ] **Step 1: Write failing tests**

`sdk-py/tests/test_transport.py`:

```python
from __future__ import annotations
import json
import pytest
import httpx
from husk._transport import JsonRpcClient, JsonRpcTransportError, HuskApiError


@pytest.mark.asyncio
async def test_call_returns_result_on_success() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": body["id"], "result": {"ok": True, "version": "0.0.0", "activeSessions": 0}},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        r = await rpc.call("health", {})
        assert r["ok"] is True


@pytest.mark.asyncio
async def test_call_increments_request_ids() -> None:
    ids: list[int] = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        ids.append(body["id"])
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": None})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        await rpc.call("health", {})
        await rpc.call("health", {})
    assert ids[0] != ids[1]


@pytest.mark.asyncio
async def test_call_raises_transport_error_on_500() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"oops")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        with pytest.raises(JsonRpcTransportError):
            await rpc.call("health", {})


@pytest.mark.asyncio
async def test_call_raises_husk_api_error_on_error_envelope() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32001, "message": "Session not found: x"}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        with pytest.raises(HuskApiError) as e:
            await rpc.call("goto", {})
        assert "Session not found" in str(e.value)


@pytest.mark.asyncio
async def test_strips_trailing_slash_in_base_url() -> None:
    seen_urls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen_urls.append(str(req.url))
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": None})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test/", http_client=client)
        await rpc.call("health", {})
    assert seen_urls[0] == "http://x.test/v1/jsonrpc"


@pytest.mark.asyncio
async def test_call_raises_transport_error_on_invalid_json() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        with pytest.raises(JsonRpcTransportError):
            await rpc.call("health", {})
```

Add to `sdk-py/pyproject.toml` `[tool.pytest.ini_options]`:
```toml
asyncio_mode = "auto"
```

- [ ] **Step 2: Run, verify FAIL**

```
cd sdk-py && uv run pytest tests/test_transport.py
```
Expected: FAIL.

- [ ] **Step 3: Implement transport**

`sdk-py/husk/_transport.py`:

```python
"""JSON-RPC 2.0 client over HTTP for Husk SDK."""
from __future__ import annotations

import itertools
import json
from typing import Any, Mapping, Optional

import httpx


class JsonRpcTransportError(Exception):
    """Raised when the HTTP transport itself fails (non-200, bad JSON, etc.)."""


class HuskApiError(Exception):
    """Raised when the server returns a JSON-RPC error envelope."""

    def __init__(self, message: str, code: int, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


class JsonRpcClient:
    """Async JSON-RPC client. Reusable across many calls."""

    def __init__(
        self,
        base_url: str,
        *,
        http_client: Optional[httpx.AsyncClient] = None,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(timeout=timeout)
        self._ids = itertools.count(1)

    async def call(self, method: str, params: Mapping[str, Any]) -> Any:
        rpc_id = next(self._ids)
        url = f"{self._base_url}/v1/jsonrpc"
        try:
            res = await self._client.post(
                url,
                json={"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params},
            )
        except httpx.HTTPError as e:
            raise JsonRpcTransportError(f"HTTP transport failed: {e}") from e
        if res.status_code != 200:
            raise JsonRpcTransportError(f"HTTP {res.status_code} from {url}")
        try:
            body = res.json()
        except json.JSONDecodeError as e:
            raise JsonRpcTransportError("Response body was not valid JSON") from e
        if "error" in body:
            err = body["error"]
            raise HuskApiError(err["message"], err["code"], err.get("data"))
        return body["result"]

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> "JsonRpcClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()
```

- [ ] **Step 4: Run, verify PASS**

```
cd sdk-py && uv run pytest tests/test_transport.py
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add sdk-py/husk/_transport.py sdk-py/tests/test_transport.py sdk-py/pyproject.toml
git commit -m "feat(sdk-py): JsonRpcClient — async httpx transport"
```

---

## Task 8: Python SDK Session Class

**Files:**
- Create: `sdk-py/husk/_session.py`
- Modify: `sdk-py/husk/__init__.py` (replace placeholder Husk)
- Create: `sdk-py/tests/test_session.py`

- [ ] **Step 1: Write failing tests**

`sdk-py/tests/test_session.py`:

```python
from __future__ import annotations
import json
import pytest
import httpx
from husk import Husk
from husk._types import RejectionEnvelope, SuccessResult


def make_router(routes: dict[str, callable]) -> httpx.MockTransport:
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        h = routes.get(body["method"])
        if not h:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "error": {"code": -32601, "message": f"No: {body['method']}"}})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": h(body["params"])})
    return httpx.MockTransport(handler)


async def make_husk(routes: dict[str, callable]) -> Husk:
    client = httpx.AsyncClient(transport=make_router(routes))
    return Husk(base_url="http://x.test", _http_client=client)


@pytest.mark.asyncio
async def test_create_session_returns_session_bound_to_id() -> None:
    h = await make_husk({"create_session": lambda _: {"session_id": "abc"}})
    async with h:
        s = await h.create_session()
        assert s.id == "abc"


@pytest.mark.asyncio
async def test_goto_forwards_params() -> None:
    calls: list[dict] = []
    h = await make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "goto": lambda p: (calls.append(p), {"ok": True})[1],
    })
    async with h:
        s = await h.create_session()
        await s.goto("https://example.com")
    assert calls[0] == {"session_id": "s1", "url": "https://example.com"}


@pytest.mark.asyncio
async def test_snapshot_returns_parsed_snapshot() -> None:
    snap = {"v": 1, "url": "https://x.test", "count": 1, "root": {"i": "r:1", "r": "x", "n": "", "s": []}}
    h = await make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "snapshot": lambda _: snap,
    })
    async with h:
        s = await h.create_session()
        got = await s.snapshot()
        assert got.v == 1
        assert got.root.i == "r:1"


@pytest.mark.asyncio
async def test_click_returns_success_or_rejection() -> None:
    snap_payload = {"v": 1, "url": "", "count": 0, "root": {"i": "x", "r": "x", "n": "", "s": []}}
    h = await make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "click": lambda p: (
            {"ok": True, "warnings": []}
            if p["stable_id"] == "button:ok"
            else {"ok": False, "reason": "element_not_found", "verb": "click",
                  "stable_id_attempted": p["stable_id"], "candidates": [],
                  "snapshot_at_attempt": snap_payload}
        ),
    })
    async with h:
        s = await h.create_session()
        ok = await s.click("button:ok")
        rej = await s.click("button:ghost")
        assert isinstance(ok, SuccessResult) and ok.ok is True
        assert isinstance(rej, RejectionEnvelope) and rej.reason == "element_not_found"


@pytest.mark.asyncio
async def test_type_scroll_press_close_forward_correctly() -> None:
    calls: list[tuple[str, dict]] = []
    routes = {
        "create_session": lambda _: {"session_id": "s1"},
        "type": lambda p: (calls.append(("type", p)), {"ok": True, "warnings": []})[1],
        "scroll": lambda p: (calls.append(("scroll", p)), {"ok": True, "warnings": []})[1],
        "press_key": lambda p: (calls.append(("press_key", p)), {"ok": True, "warnings": []})[1],
        "close_session": lambda p: (calls.append(("close_session", p)), {"ok": True})[1],
    }
    h = await make_husk(routes)
    async with h:
        s = await h.create_session()
        await s.type("textbox:e", "hi")
        await s.scroll(None, "down", 300)
        await s.press_key("Enter")
        await s.close()
    assert [c[0] for c in calls] == ["type", "scroll", "press_key", "close_session"]
    assert calls[0][1] == {"session_id": "s1", "stable_id": "textbox:e", "text": "hi"}
    assert calls[1][1] == {"session_id": "s1", "stable_id": None, "direction": "down", "amount": 300}
    assert calls[2][1] == {"session_id": "s1", "key": "Enter"}


@pytest.mark.asyncio
async def test_set_policy_sends_raw_yaml_or_null() -> None:
    calls: list[dict] = []
    h = await make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "set_policy": lambda p: (calls.append(p), {"ok": True})[1],
    })
    async with h:
        s = await h.create_session()
        await s.set_policy("forbidden: []")
        await s.set_policy(None)
    assert calls[0] == {"session_id": "s1", "policy_yaml": "forbidden: []"}
    assert calls[1] == {"session_id": "s1", "policy_yaml": None}


@pytest.mark.asyncio
async def test_health_method() -> None:
    h = await make_husk({"health": lambda _: {"ok": True, "version": "0.0.0", "activeSessions": 0}})
    async with h:
        r = await h.health()
    assert r["ok"] is True


@pytest.mark.asyncio
async def test_husk_async_context_manager_closes_client() -> None:
    h = await make_husk({"health": lambda _: {"ok": True, "version": "0.0.0", "activeSessions": 0}})
    async with h:
        await h.health()
    # No assertion needed — if aclose doesn't run it leaks; test passes when context exits cleanly.
```

- [ ] **Step 2: Run, verify FAIL**

```
cd sdk-py && uv run pytest tests/test_session.py
```
Expected: FAIL — Husk doesn't have async API yet.

- [ ] **Step 3: Implement Session class**

`sdk-py/husk/_session.py`:

```python
"""Per-session async API for Husk."""
from __future__ import annotations

from typing import Literal, Optional

from ._transport import JsonRpcClient
from ._types import ActionResult, Snapshot, parse_action_result, parse_snapshot


ScrollDirection = Literal["up", "down", "left", "right", "into_view"]


class Session:
    """One Husk session. Use via Husk.create_session()."""

    def __init__(self, client: JsonRpcClient, session_id: str) -> None:
        self._client = client
        self._id = session_id

    @property
    def id(self) -> str:
        return self._id

    async def goto(self, url: str) -> None:
        await self._client.call("goto", {"session_id": self._id, "url": url})

    async def snapshot(self) -> Snapshot:
        raw = await self._client.call("snapshot", {"session_id": self._id})
        return parse_snapshot(raw)

    async def click(self, stable_id: str) -> ActionResult:
        raw = await self._client.call("click", {"session_id": self._id, "stable_id": stable_id})
        return parse_action_result(raw)

    async def type(self, stable_id: str, text: str) -> ActionResult:
        raw = await self._client.call("type", {"session_id": self._id, "stable_id": stable_id, "text": text})
        return parse_action_result(raw)

    async def scroll(self, stable_id: Optional[str], direction: ScrollDirection, amount: int) -> ActionResult:
        raw = await self._client.call(
            "scroll",
            {"session_id": self._id, "stable_id": stable_id, "direction": direction, "amount": amount},
        )
        return parse_action_result(raw)

    async def press_key(self, key: str) -> ActionResult:
        raw = await self._client.call("press_key", {"session_id": self._id, "key": key})
        return parse_action_result(raw)

    async def set_policy(self, policy_yaml: Optional[str]) -> None:
        await self._client.call("set_policy", {"session_id": self._id, "policy_yaml": policy_yaml})

    async def close(self) -> None:
        await self._client.call("close_session", {"session_id": self._id})
```

- [ ] **Step 4: Rewrite Husk client**

`sdk-py/husk/__init__.py`:

```python
"""Husk — open-source browser engine for AI agents (Python SDK)."""
from __future__ import annotations

from typing import Any, Optional

import httpx

from ._session import Session, ScrollDirection
from ._transport import JsonRpcClient, JsonRpcTransportError, HuskApiError
from ._types import (
    ActionResult,
    Candidate,
    RejectionEnvelope,
    Snapshot,
    SnapshotDiff,
    SnapshotNode,
    SuccessResult,
    Warning_ as Warning,
    parse_action_result,
    parse_snapshot,
)


__version__ = "0.0.0"
DEFAULT_BASE_URL = "http://localhost:7777"


class Husk:
    """Husk SDK client.

    >>> async with Husk(base_url="http://localhost:7777") as h:
    ...     s = await h.create_session()
    ...     await s.goto("https://example.com")
    ...     snap = await s.snapshot()
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        _http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.base_url = base_url
        self._client = JsonRpcClient(base_url=base_url, http_client=_http_client)

    async def create_session(self) -> Session:
        r = await self._client.call("create_session", {})
        return Session(self._client, r["session_id"])

    async def health(self) -> dict[str, Any]:
        return await self._client.call("health", {})

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "Husk":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()


__all__ = [
    "Husk",
    "Session",
    "ScrollDirection",
    "Snapshot",
    "SnapshotNode",
    "SnapshotDiff",
    "ActionResult",
    "SuccessResult",
    "RejectionEnvelope",
    "Warning",
    "Candidate",
    "JsonRpcTransportError",
    "HuskApiError",
    "parse_snapshot",
    "parse_action_result",
    "__version__",
    "DEFAULT_BASE_URL",
]
```

- [ ] **Step 5: Run, verify PASS**

```
cd sdk-py && uv run pytest
```
Expected: 18 tests pass (4 types + 6 transport + 8 session).

- [ ] **Step 6: Commit**

```bash
git add sdk-py/husk/_session.py sdk-py/husk/__init__.py sdk-py/tests/test_session.py
git commit -m "feat(sdk-py): Session + Husk async API"
```

---

## Task 9: Python SDK find_in_snapshot

**Files:**
- Create: `sdk-py/husk/_snapshot.py`
- Modify: `sdk-py/husk/__init__.py` (re-export)
- Create: `sdk-py/tests/test_snapshot.py`

- [ ] **Step 1: Write failing test**

`sdk-py/tests/test_snapshot.py`:

```python
from __future__ import annotations
import re
import pytest
from husk import find_in_snapshot, find_all_in_snapshot
from husk._types import parse_snapshot


SNAP = parse_snapshot({
    "v": 1, "url": "https://x.test", "count": 4,
    "root": {
        "i": "RootWebArea:r", "r": "RootWebArea", "n": "Page", "s": ["v"],
        "c": [
            {"i": "heading:h", "r": "heading", "n": "Hello Husk", "s": ["v"]},
            {"i": "button:submit", "r": "button", "n": "Submit Application", "s": ["v", "e"]},
            {"i": "button:disabled", "r": "button", "n": "Disabled Button", "s": ["v", "d"]},
            {"i": "textbox:email", "r": "textbox", "n": "Email", "s": ["v", "e"]},
        ],
    },
})


def test_find_by_role_and_name_regex() -> None:
    hit = find_in_snapshot(SNAP, role="button", name_matches=re.compile("submit", re.IGNORECASE))
    assert hit is not None and hit.i == "button:submit"


def test_find_returns_none_on_no_match() -> None:
    assert find_in_snapshot(SNAP, role="link") is None


def test_find_by_substring() -> None:
    hit = find_in_snapshot(SNAP, name="hello")
    assert hit is not None and hit.i == "heading:h"


def test_find_all_returns_in_document_order() -> None:
    all_ = find_all_in_snapshot(SNAP, role="button")
    assert [n.i for n in all_] == ["button:submit", "button:disabled"]


def test_find_without_role_matches_by_name_only() -> None:
    hit = find_in_snapshot(SNAP, name_matches=re.compile("email", re.IGNORECASE))
    assert hit is not None and hit.i == "textbox:email"
```

- [ ] **Step 2: Run, verify FAIL**

```
cd sdk-py && uv run pytest tests/test_snapshot.py
```

- [ ] **Step 3: Implement**

`sdk-py/husk/_snapshot.py`:

```python
"""Snapshot tree-walk helpers."""
from __future__ import annotations

from typing import Optional, Pattern

from ._types import Snapshot, SnapshotNode


def _matches(
    node: SnapshotNode,
    *,
    role: Optional[str],
    name: Optional[str],
    name_matches: Optional[Pattern[str]],
) -> bool:
    if role is not None and node.r != role:
        return False
    if name is not None and name.lower() not in node.n.lower():
        return False
    if name_matches is not None and not name_matches.search(node.n):
        return False
    return True


def find_in_snapshot(
    snapshot: Snapshot,
    *,
    role: Optional[str] = None,
    name: Optional[str] = None,
    name_matches: Optional[Pattern[str]] = None,
) -> Optional[SnapshotNode]:
    """Depth-first; returns the first matching node or None."""
    return _walk_find(snapshot.root, role=role, name=name, name_matches=name_matches)


def _walk_find(
    node: SnapshotNode,
    *,
    role: Optional[str],
    name: Optional[str],
    name_matches: Optional[Pattern[str]],
) -> Optional[SnapshotNode]:
    if _matches(node, role=role, name=name, name_matches=name_matches):
        return node
    for child in node.c:
        hit = _walk_find(child, role=role, name=name, name_matches=name_matches)
        if hit is not None:
            return hit
    return None


def find_all_in_snapshot(
    snapshot: Snapshot,
    *,
    role: Optional[str] = None,
    name: Optional[str] = None,
    name_matches: Optional[Pattern[str]] = None,
) -> list[SnapshotNode]:
    """Depth-first; returns all matching nodes in document order."""
    out: list[SnapshotNode] = []
    _walk_all(snapshot.root, out, role=role, name=name, name_matches=name_matches)
    return out


def _walk_all(
    node: SnapshotNode,
    out: list[SnapshotNode],
    *,
    role: Optional[str],
    name: Optional[str],
    name_matches: Optional[Pattern[str]],
) -> None:
    if _matches(node, role=role, name=name, name_matches=name_matches):
        out.append(node)
    for child in node.c:
        _walk_all(child, out, role=role, name=name, name_matches=name_matches)
```

Then add to `sdk-py/husk/__init__.py`:

```python
from ._snapshot import find_in_snapshot, find_all_in_snapshot
```

And append to `__all__`:
```python
"find_in_snapshot", "find_all_in_snapshot",
```

- [ ] **Step 4: Run + Commit**

```
cd sdk-py && uv run pytest
```
Expected: 23 tests pass (18 + 5).

```bash
git add sdk-py/husk/_snapshot.py sdk-py/husk/__init__.py sdk-py/tests/test_snapshot.py
git commit -m "feat(sdk-py): find_in_snapshot + find_all_in_snapshot helpers"
```

---

## Task 10: Python SDK Integration Test

**Files:**
- Create: `sdk-py/tests/integration/__init__.py` (empty)
- Create: `sdk-py/tests/integration/test_sdk_e2e.py`

- [ ] **Step 1: Write the integration test**

`sdk-py/tests/integration/test_sdk_e2e.py`:

```python
from __future__ import annotations
import asyncio
import os
import socket
import sys
import time
from pathlib import Path
from subprocess import Popen
from typing import AsyncIterator

import pytest
from husk import Husk

ORCHESTRATOR_PATH = (
    Path(__file__).resolve().parents[3] / "orchestrator" / "dist" / "index.js"
)
LIGHTPANDA_BIN = os.environ.get("LIGHTPANDA_BIN")

pytestmark = pytest.mark.skipif(
    not (LIGHTPANDA_BIN and ORCHESTRATOR_PATH.exists()),
    reason="integration test requires LIGHTPANDA_BIN env and built orchestrator/dist",
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _wait_ready(husk: Husk, deadline_s: float) -> None:
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        try:
            r = await husk.health()
            if r.get("ok"):
                return
        except Exception:
            await asyncio.sleep(0.2)
    raise RuntimeError("Orchestrator never became ready")


@pytest.mark.asyncio
async def test_create_session_goto_snapshot_close() -> None:
    port = _free_port()
    env = {**os.environ, "LIGHTPANDA_BIN": LIGHTPANDA_BIN or ""}
    proc = Popen(
        ["node", str(ORCHESTRATOR_PATH), "start", "--port", str(port), "--log-level", "silent"],
        env=env, stdout=sys.stderr, stderr=sys.stderr,
    )
    try:
        async with Husk(base_url=f"http://127.0.0.1:{port}") as h:
            await _wait_ready(h, 15.0)
            s = await h.create_session()
            assert len(s.id) == 36  # UUID
            await s.goto("https://example.com")
            snap = await s.snapshot()
            assert snap.count > 0
            assert snap.root.r == "RootWebArea"
            await s.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


@pytest.mark.asyncio
async def test_click_on_missing_returns_rejection() -> None:
    from husk._types import RejectionEnvelope

    port = _free_port()
    env = {**os.environ, "LIGHTPANDA_BIN": LIGHTPANDA_BIN or ""}
    proc = Popen(
        ["node", str(ORCHESTRATOR_PATH), "start", "--port", str(port), "--log-level", "silent"],
        env=env, stdout=sys.stderr, stderr=sys.stderr,
    )
    try:
        async with Husk(base_url=f"http://127.0.0.1:{port}") as h:
            await _wait_ready(h, 15.0)
            s = await h.create_session()
            await s.goto("https://example.com")
            await s.snapshot()
            result = await s.click("button:totally-fake")
            assert isinstance(result, RejectionEnvelope)
            assert result.reason == "element_not_found"
            await s.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
```

- [ ] **Step 2: Run with LIGHTPANDA_BIN set**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  cd /Users/nirmalghinaiya/Desktop/husk/sdk-py && uv run pytest tests/integration/
```
Expected: 2 tests pass.

- [ ] **Step 3: Run without LIGHTPANDA_BIN — verify skip**

```
cd sdk-py && uv run pytest tests/integration/
```
Expected: SKIP.

- [ ] **Step 4: Run full suite**

```
cd sdk-py && uv run pytest
```

- [ ] **Step 5: Commit**

```bash
git add sdk-py/tests/integration/__init__.py sdk-py/tests/integration/test_sdk_e2e.py
git commit -m "test(sdk-py): real-orchestrator e2e for createSession/goto/snapshot/click"
```

---

## Task 11: MCP Orchestrator Subprocess + Internal Client

The MCP server currently proxies lightpanda's stdio MCP. M6 pivots it to talk to the Husk orchestrator's HTTP/JSON-RPC layer, which means actions flow through the watchdog (T7 reuses the orchestrator's existing watchdog).

**Files:**
- Create: `mcp/src/orchestrator.ts` (subprocess manager — spawn `husk start`, wait for ready, hold port)
- Create: `mcp/src/client.ts` (minimal local JSON-RPC client — MCP must be self-contained, no sdk-ts dependency)
- Create: `mcp/tests/orchestrator.test.ts`
- Create: `mcp/tests/client.test.ts`

- [ ] **Step 1: Write failing tests**

`mcp/tests/client.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { HuskRpcClient } from "../src/client.js";

describe("HuskRpcClient", () => {
  it("calls JSON-RPC method via fetch and returns result", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true, version: "0.0.0", activeSessions: 0 } }), { status: 200 })
    );
    const c = new HuskRpcClient({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const r = await c.call<{ ok: boolean }>("health", {});
    expect(r.ok).toBe(true);
  });

  it("throws on JSON-RPC error envelope", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Session not found: x" } }), { status: 200 })
    );
    const c = new HuskRpcClient({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await expect(c.call("goto", {})).rejects.toThrow(/Session not found/);
  });
});
```

`mcp/tests/orchestrator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { startOrchestrator } from "../src/orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorPath = join(__dirname, "..", "..", "orchestrator", "dist", "index.js");
const lightpandaBin = process.env.LIGHTPANDA_BIN;

const integrationOrSkip = (lightpandaBin && existsSync(orchestratorPath)) ? describe : describe.skip;

integrationOrSkip("startOrchestrator", () => {
  it("spawns husk start, returns port, and stops cleanly", async () => {
    const orch = await startOrchestrator({
      orchestratorScript: orchestratorPath,
      lightpandaBin: lightpandaBin!,
      readyTimeoutMs: 15_000,
    });
    expect(orch.port).toBeGreaterThan(0);
    expect(orch.baseUrl).toBe(`http://127.0.0.1:${orch.port}`);
    await orch.stop();
  }, 30_000);

  it("times out if orchestrator never becomes ready", async () => {
    // Point at a non-existent script to force timeout
    await expect(
      startOrchestrator({
        orchestratorScript: "/nonexistent",
        lightpandaBin: lightpandaBin!,
        readyTimeoutMs: 2_000,
      })
    ).rejects.toThrow();
  }, 10_000);
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/mcp vitest run client orchestrator
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement HuskRpcClient**

`mcp/src/client.ts`:

```typescript
export interface HuskRpcClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export class HuskRpcClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private nextId = 0;

  constructor(opts: HuskRpcClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.nextId;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.baseUrl}/v1/jsonrpc`);
    const body = await res.json() as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  }
}
```

- [ ] **Step 4: Implement startOrchestrator**

`mcp/src/orchestrator.ts`:

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface OrchestratorOptions {
  /** Path to the built orchestrator JS entry (orchestrator/dist/index.js). */
  orchestratorScript: string;
  /** Path to the lightpanda binary. */
  lightpandaBin: string;
  /** Max ms to wait for the orchestrator to come up. */
  readyTimeoutMs?: number;
  /** Optional log sink for stderr; defaults to /dev/null. */
  log?: (line: string) => void;
}

export interface OrchestratorHandle {
  port: number;
  baseUrl: string;
  stop(): Promise<void>;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        s.close(() => resolve(port));
      } else {
        s.close();
        reject(new Error("Could not allocate free port"));
      }
    });
    s.on("error", reject);
  });
}

async function waitReady(baseUrl: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/v1/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "health", params: {} }),
      });
      if (res.ok) {
        const body = (await res.json()) as { result?: { ok?: boolean } };
        if (body.result?.ok) return;
      }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Orchestrator at ${baseUrl} did not become ready in time`);
}

/**
 * Spawn `husk start` as a child process and wait for it to be ready.
 * Used by the MCP server to bring up the orchestrator on demand.
 */
export async function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    "node",
    [opts.orchestratorScript, "start", "--port", String(port), "--log-level", "silent"],
    {
      env: { ...process.env, LIGHTPANDA_BIN: opts.lightpandaBin },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stderr?.on("data", (chunk) => opts.log?.(chunk.toString()));

  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.once("exit", (code, signal) => { exited = { code, signal }; });

  const deadline = Date.now() + (opts.readyTimeoutMs ?? 15_000);
  try {
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Orchestrator exited early: code=${exited.code} signal=${exited.signal}`);
      try {
        await waitReady(baseUrl, Math.min(deadline, Date.now() + 1_000));
        break;
      } catch { /* keep polling until deadline */ }
    }
    if (Date.now() >= deadline && !await healthOk(baseUrl)) {
      child.kill("SIGTERM");
      throw new Error(`Orchestrator at ${baseUrl} did not become ready within ${opts.readyTimeoutMs ?? 15_000}ms`);
    }
  } catch (e) {
    child.kill("SIGTERM");
    throw e;
  }

  return {
    port,
    baseUrl,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode != null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}

async function healthOk(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "health", params: {} }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: { ok?: boolean } };
    return !!body.result?.ok;
  } catch { return false; }
}
```

- [ ] **Step 5: Run, verify PASS**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter @husk/mcp vitest run client orchestrator
```
Expected: 4 tests pass (2 client + 2 orchestrator).

Run without LIGHTPANDA_BIN — orchestrator tests skip, client tests still pass:
```
pnpm --filter @husk/mcp vitest run client orchestrator
```

- [ ] **Step 6: Commit**

```bash
git add mcp/src/client.ts mcp/src/orchestrator.ts mcp/tests/client.test.ts mcp/tests/orchestrator.test.ts
git commit -m "feat(mcp): orchestrator subprocess manager + internal JSON-RPC client"
```

---

## Task 12: MCP Tool Surface — Replace Lightpanda Passthrough

**Files:**
- Create: `mcp/src/tool-surface.ts` (declarative tool list + handlers)
- Modify: `mcp/src/proxy.ts` (rewrite to route through HuskRpcClient instead of lightpanda stdio)
- Modify: `mcp/src/index.ts` (spawn orchestrator instead of lightpanda MCP)
- Delete: `mcp/src/tool-map.ts`, `mcp/src/transform.ts` (now obsolete)
- Create: `mcp/tests/tool-surface.test.ts`

- [ ] **Step 1: Write failing tests**

`mcp/tests/tool-surface.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { TOOL_SURFACE, handleToolCall } from "../src/tool-surface.js";

describe("TOOL_SURFACE", () => {
  it("lists Husk-branded tools with husk_ prefix", () => {
    const names = TOOL_SURFACE.map((t) => t.name);
    expect(names).toContain("husk_create_session");
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).toContain("husk_click");
    expect(names).toContain("husk_type");
    expect(names).toContain("husk_press_key");
    expect(names).toContain("husk_scroll");
    expect(names).toContain("husk_close_session");
    expect(names).toContain("husk_version");
    for (const t of TOOL_SURFACE) expect(t.name.startsWith("husk_")).toBe(true);
  });

  it("every tool has a description and inputSchema", () => {
    for (const t of TOOL_SURFACE) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema?.type).toBe("object");
    }
  });
});

describe("handleToolCall", () => {
  it("routes husk_goto to JSON-RPC goto with snake_case params", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    const r = await handleToolCall(
      client as any,
      "husk_goto",
      { session_id: "s1", url: "https://x.test" }
    );
    expect(client.call).toHaveBeenCalledWith("goto", { session_id: "s1", url: "https://x.test" });
    expect(r).toEqual({ ok: true });
  });

  it("routes husk_click and returns rejection envelopes verbatim", async () => {
    const envelope = {
      ok: false, reason: "element_not_found", verb: "click",
      stable_id_attempted: "button:x", candidates: [],
      snapshot_at_attempt: { v: 1, url: "", count: 0, root: { i: "x", r: "x", n: "", s: [] } },
    };
    const client = { call: vi.fn(async () => envelope) };
    const r = await handleToolCall(client as any, "husk_click", { session_id: "s1", stable_id: "button:x" });
    expect(client.call).toHaveBeenCalledWith("click", { session_id: "s1", stable_id: "button:x" });
    expect(r).toEqual(envelope);
  });

  it("husk_version is handled locally (no RPC)", async () => {
    const client = { call: vi.fn() };
    const r = await handleToolCall(client as any, "husk_version", {});
    expect(client.call).not.toHaveBeenCalled();
    expect((r as { name: string }).name).toBe("husk-mcp");
  });

  it("unknown tool name throws", async () => {
    const client = { call: vi.fn() };
    await expect(handleToolCall(client as any, "husk_bogus", {})).rejects.toThrow(/Unknown tool/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/mcp vitest run tool-surface
```

- [ ] **Step 3: Implement tool surface**

`mcp/src/tool-surface.ts`:

```typescript
import type { HuskRpcClient } from "./client.js";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_SURFACE: ToolSpec[] = [
  {
    name: "husk_create_session",
    description: "Husk — Create a new browser session. Returns { session_id }. Always call this first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "husk_goto",
    description: "Husk — Navigate the session to a URL.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session id from husk_create_session" },
        url: { type: "string", description: "Absolute URL" },
      },
      required: ["session_id", "url"],
    },
  },
  {
    name: "husk_snapshot",
    description: "Husk — Return a compressed accessibility-tree snapshot of the current page.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "husk_click",
    description: "Husk — Click an element by stable_id. Watchdog-protected: returns a rejection envelope with candidates if the element doesn't exist or fails sanity checks.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string", description: "Stable id from a snapshot" },
      },
      required: ["session_id", "stable_id"],
    },
  },
  {
    name: "husk_type",
    description: "Husk — Type into an element by stable_id. Watchdog-protected.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["session_id", "stable_id", "text"],
    },
  },
  {
    name: "husk_scroll",
    description: "Husk — Scroll the page or an element into view.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: ["string", "null"], description: "Element to scroll into view, or null for window scroll" },
        direction: { type: "string", enum: ["up", "down", "left", "right", "into_view"] },
        amount: { type: "number", description: "Pixels to scroll (ignored for into_view)" },
      },
      required: ["session_id", "direction", "amount"],
    },
  },
  {
    name: "husk_press_key",
    description: "Husk — Press a single key (Enter, Tab, Escape, ArrowUp/Down/Left/Right, Backspace, Space).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        key: { type: "string" },
      },
      required: ["session_id", "key"],
    },
  },
  {
    name: "husk_close_session",
    description: "Husk — Close a session and free resources.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "husk_version",
    description: "Husk — Return Husk MCP server version info.",
    inputSchema: { type: "object", properties: {} },
  },
];

// Map MCP tool name → JSON-RPC method name. husk_version is local-only.
const RPC_MAP: Record<string, string> = {
  husk_create_session: "create_session",
  husk_goto: "goto",
  husk_snapshot: "snapshot",
  husk_click: "click",
  husk_type: "type",
  husk_scroll: "scroll",
  husk_press_key: "press_key",
  husk_close_session: "close_session",
};

const VERSION = "0.0.0";

export async function handleToolCall(
  client: HuskRpcClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (toolName === "husk_version") {
    return { name: "husk-mcp", version: VERSION };
  }
  const method = RPC_MAP[toolName];
  if (!method) throw new Error(`Unknown tool: ${toolName}`);
  return await client.call(method, args);
}
```

- [ ] **Step 4: Rewrite proxy.ts**

The old `proxy.ts` connected to lightpanda's stdio MCP and rewrote tools. Replace it entirely with a stdio JSON-RPC handler that speaks the MCP protocol and routes to `handleToolCall`.

`mcp/src/proxy.ts`:

```typescript
import { TOOL_SURFACE, handleToolCall } from "./tool-surface.js";
import type { HuskRpcClient } from "./client.js";

/**
 * Minimal MCP protocol handler.
 *
 * Speaks newline-delimited JSON-RPC 2.0 over stdin/stdout. Implements:
 *   - initialize         → returns server info
 *   - tools/list         → returns TOOL_SURFACE
 *   - tools/call         → routes to handleToolCall
 *   - notifications/*    → silently ignored
 *
 * v0 only — no resources, prompts, or completions. Add as needed.
 */
export async function runMcpStdio(
  client: HuskRpcClient,
  options: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream } = {}
): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  let buffer = "";

  const send = (msg: unknown): void => {
    stdout.write(JSON.stringify(msg) + "\n");
  };

  const handle = async (req: { id?: unknown; method?: string; params?: Record<string, unknown> }) => {
    if (req.id === undefined) return; // notification — no response
    try {
      switch (req.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "husk-mcp", version: "0.0.0" },
            },
          });
          break;
        case "tools/list":
          send({ jsonrpc: "2.0", id: req.id, result: { tools: TOOL_SURFACE } });
          break;
        case "tools/call": {
          const { name, arguments: args } = (req.params ?? {}) as {
            name: string; arguments: Record<string, unknown>;
          };
          const result = await handleToolCall(client, name, args ?? {});
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result) }],
            },
          });
          break;
        }
        default:
          send({
            jsonrpc: "2.0", id: req.id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          });
      }
    } catch (e) {
      send({
        jsonrpc: "2.0", id: req.id,
        error: { code: -32603, message: (e as Error).message },
      });
    }
  };

  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        void handle(msg);
      } catch {
        // Drop malformed lines silently per MCP convention
      }
    }
  });

  await new Promise<void>((resolve) => stdin.on("end", () => resolve()));
}
```

- [ ] **Step 5: Rewrite index.ts**

The new `mcp/src/index.ts` spawns the orchestrator subprocess, builds a `HuskRpcClient`, and runs the stdio proxy.

```typescript
#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { locateLightpanda } from "./binary.js";
import { startOrchestrator } from "./orchestrator.js";
import { HuskRpcClient } from "./client.js";
import { runMcpStdio } from "./proxy.js";

const VERSION = "0.0.0";

const args = process.argv.slice(2);
const cmd = args[0] ?? "serve";

switch (cmd) {
  case "version":
  case "--version":
    console.log(`husk-mcp v${VERSION}`);
    break;
  case "help":
  case "--help":
    console.log(`husk-mcp v${VERSION}

The Husk MCP server. Routes Husk-branded tools (husk_goto, husk_snapshot,
husk_click, etc.) through the Husk orchestrator so they're watchdog-protected.

Usage:
  husk-mcp                Start the MCP server on stdio (default).
  husk-mcp serve          Same as above.
  husk-mcp version        Print version.
  husk-mcp help           Print this help.

Configure in Claude Desktop's claude_desktop_config.json:
  {
    "mcpServers": {
      "husk": {
        "command": "node",
        "args": ["/absolute/path/to/husk/mcp/dist/index.js"]
      }
    }
  }`);
    break;
  case "serve":
  default: {
    void main();
  }
}

async function main(): Promise<void> {
  const lightpandaBin = await locateLightpanda();
  // Resolve orchestrator script path: $HUSK_ORCHESTRATOR or sibling workspace dist
  const orchestratorScript =
    process.env.HUSK_ORCHESTRATOR ||
    resolveSiblingOrchestrator();

  const orch = await startOrchestrator({
    orchestratorScript,
    lightpandaBin,
    readyTimeoutMs: 30_000,
    log: (line) => process.stderr.write(line),
  });

  const client = new HuskRpcClient({ baseUrl: orch.baseUrl });

  const shutdown = async () => {
    try { await orch.stop(); } finally { process.exit(0); }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await runMcpStdio(client);
  await orch.stop();
}

function resolveSiblingOrchestrator(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/index.js → ../../orchestrator/dist/index.js
  return join(here, "..", "..", "orchestrator", "dist", "index.js");
}
```

- [ ] **Step 6: Delete obsolete files**

```bash
rm mcp/src/tool-map.ts mcp/src/transform.ts
```

If existing tests reference them (check `mcp/tests/`), delete or update those tests. The pre-existing M2.5 tests `tool-map.test.ts`, `transform.test.ts` should be removed since the surface they exercise no longer exists.

- [ ] **Step 7: Run all MCP tests + typecheck**

```
pnpm --filter @husk/mcp vitest run
pnpm --filter @husk/mcp typecheck
```
Expected: tool-surface (6) + client (2) + orchestrator (2 if LIGHTPANDA_BIN set, otherwise skipped) all pass. Old tool-map/transform tests deleted.

- [ ] **Step 8: Commit**

```bash
git add mcp/src/tool-surface.ts mcp/src/proxy.ts mcp/src/index.ts mcp/tests/tool-surface.test.ts
git rm mcp/src/tool-map.ts mcp/src/transform.ts mcp/tests/tool-map.test.ts mcp/tests/transform.test.ts
git commit -m "feat(mcp): route tool calls through Husk orchestrator (watchdog enforcement)"
```

(Delete only the test files that actually exist — check with `ls mcp/tests/`.)

---

## Task 13: MCP Real-Subprocess Integration Test

**Files:**
- Create: `mcp/tests/integration/mcp-e2e.test.ts`

- [ ] **Step 1: Write the integration test**

`mcp/tests/integration/mcp-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpEntry = join(__dirname, "..", "..", "dist", "index.js");
const orchestratorEntry = join(__dirname, "..", "..", "..", "orchestrator", "dist", "index.js");
const lightpandaBin = process.env.LIGHTPANDA_BIN;

const integrationOrSkip = (lightpandaBin && existsSync(mcpEntry) && existsSync(orchestratorEntry))
  ? describe
  : describe.skip;

function jsonRpcRequest(id: number, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

async function readUntilId(proc: ChildProcess, id: number, timeoutMs = 30_000): Promise<{ result?: unknown; error?: { message: string } }> {
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
          if (msg.id === id) {
            proc.stdout?.off("data", onData);
            return resolve({ result: msg.result, error: msg.error });
          }
        } catch { /* ignore */ }
      }
      if (Date.now() > deadline) {
        proc.stdout?.off("data", onData);
        reject(new Error("Timeout waiting for response"));
      }
    };
    proc.stdout?.on("data", onData);
  });
}

integrationOrSkip("mcp e2e — real husk-mcp subprocess", () => {
  it("initialize → tools/list → tools/call husk_create_session → husk_goto → husk_snapshot", async () => {
    const proc = spawn("node", [mcpEntry], {
      env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin, HUSK_ORCHESTRATOR: orchestratorEntry },
      stdio: "pipe",
    });
    proc.stderr?.on("data", (d) => process.stderr.write(d));

    try {
      proc.stdin?.write(jsonRpcRequest(1, "initialize"));
      const init = await readUntilId(proc, 1);
      expect((init.result as { serverInfo?: { name?: string } }).serverInfo?.name).toBe("husk-mcp");

      proc.stdin?.write(jsonRpcRequest(2, "tools/list"));
      const list = await readUntilId(proc, 2);
      const tools = (list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
      expect(tools).toContain("husk_goto");
      expect(tools).toContain("husk_click");

      proc.stdin?.write(jsonRpcRequest(3, "tools/call", { name: "husk_create_session", arguments: {} }));
      const create = await readUntilId(proc, 3);
      const createContent = JSON.parse(((create.result as { content: Array<{ text: string }> }).content[0].text));
      const sessionId = (createContent as { session_id: string }).session_id;
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

      proc.stdin?.write(jsonRpcRequest(4, "tools/call", {
        name: "husk_goto",
        arguments: { session_id: sessionId, url: "https://example.com" },
      }));
      const gotoRes = await readUntilId(proc, 4);
      const gotoContent = JSON.parse(((gotoRes.result as { content: Array<{ text: string }> }).content[0].text));
      expect(gotoContent).toEqual({ ok: true });

      proc.stdin?.write(jsonRpcRequest(5, "tools/call", {
        name: "husk_snapshot",
        arguments: { session_id: sessionId },
      }));
      const snap = await readUntilId(proc, 5);
      const snapContent = JSON.parse(((snap.result as { content: Array<{ text: string }> }).content[0].text));
      expect(snapContent.v).toBe(1);
      expect(snapContent.count).toBeGreaterThan(0);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 90_000);

  it("husk_click on a non-existent stable_id returns a rejection envelope through the MCP boundary", async () => {
    const proc = spawn("node", [mcpEntry], {
      env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin, HUSK_ORCHESTRATOR: orchestratorEntry },
      stdio: "pipe",
    });
    try {
      proc.stdin?.write(jsonRpcRequest(1, "initialize"));
      await readUntilId(proc, 1);

      proc.stdin?.write(jsonRpcRequest(2, "tools/call", { name: "husk_create_session", arguments: {} }));
      const create = await readUntilId(proc, 2);
      const sessionId = JSON.parse(((create.result as { content: Array<{ text: string }> }).content[0].text)).session_id;

      proc.stdin?.write(jsonRpcRequest(3, "tools/call", {
        name: "husk_goto",
        arguments: { session_id: sessionId, url: "https://example.com" },
      }));
      await readUntilId(proc, 3);

      proc.stdin?.write(jsonRpcRequest(4, "tools/call", {
        name: "husk_snapshot",
        arguments: { session_id: sessionId },
      }));
      await readUntilId(proc, 4);

      proc.stdin?.write(jsonRpcRequest(5, "tools/call", {
        name: "husk_click",
        arguments: { session_id: sessionId, stable_id: "button:totally-fake" },
      }));
      const click = await readUntilId(proc, 5);
      const env = JSON.parse(((click.result as { content: Array<{ text: string }> }).content[0].text));
      expect(env.ok).toBe(false);
      expect(env.reason).toBe("element_not_found");
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 90_000);
});
```

- [ ] **Step 2: Build MCP first**

The integration test spawns the MCP entry from `dist/index.js`, so build:
```
pnpm --filter @husk/mcp build
```

- [ ] **Step 3: Run with LIGHTPANDA_BIN set**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter @husk/mcp vitest run integration
```
Expected: 2 tests pass.

- [ ] **Step 4: Skip test without LIGHTPANDA_BIN**

```
pnpm --filter @husk/mcp vitest run integration
```
Expected: SKIP, no failure.

- [ ] **Step 5: Run full repo suite**

From repo root:
```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm test
```
Expected: 234 tests across orchestrator + sdk-ts + sdk-py + mcp.

- [ ] **Step 6: Commit**

```bash
git add mcp/tests/integration/mcp-e2e.test.ts
git commit -m "test(mcp): real-subprocess e2e for initialize/tools/list/call with watchdog rejection"
```

---

## Final Steps — Tag and Merge

- [ ] **Step A: Annotated tag**

```bash
git tag -a v0.0.7-m6 -m "M6 — SDKs + watchdog-aware MCP

TypeScript SDK (@husk/sdk): Husk + Session classes over native fetch.
Python SDK (husk-sdk): async Husk + Session over httpx. Both ship with
findInSnapshot helpers and zero LLM dependencies.

MCP rebuild (@husk/mcp): replaces lightpanda-MCP passthrough with an
orchestrator subprocess + Husk JSON-RPC client. All tool calls now
flow through the watchdog. Same agent-facing Husk-branded tool surface
(husk_goto, husk_snapshot, husk_click, etc.); lightpanda invisible.

Test count: 234 (was 173). Examples + docs deferred to M6.5/M7 per
the 2026-05-15 scope decision.

Spec §6 Interface 1 + Interface 3."
```

- [ ] **Step B: Merge to main with --no-ff**

```bash
git checkout main
git merge --no-ff m6-sdks-mcp -m "Merge Milestone 6 (SDKs + watchdog-aware MCP): client libraries + rebuilt MCP"
```

- [ ] **Step C: Push**

```bash
git push origin main v0.0.7-m6
```

---

## Self-Review Notes

**Spec coverage (§6):**
- [x] Interface 1 — Direct SDK (TS + Python) → Tasks 1–10
- [x] Interface 3 — MCP server (Husk-branded, watchdog-protected) → Tasks 11–13
- [ ] Interface 2 — Tool manifests (`husk-tools.openai.json` etc.) → **deferred to M6.5/M7**
- [ ] Interface 4 — CLI (`husk run`, `husk inspect`) → **deferred to M6.5/M7**
- [ ] Examples (`examples/01-wikipedia-research` etc.) → **deferred to M6.5/M7**

**Cross-cutting:**
- [x] Both SDKs are LLM-neutral (no OpenAI/Anthropic imports) → verified by dependency lists
- [x] `_resolver` stripping in jsonrpc.ts from M5 means SDKs receive snapshots without the internal field
- [x] Rejection envelopes preserved verbatim through SDK + MCP layers — agents can re-plan with `reason` + `candidates`
- [x] MCP gains watchdog enforcement automatically because every tool call now flows through `/v1/jsonrpc`

**Risk callouts:**
- The MCP integration test (T13) spawns TWO processes: the MCP server, which itself spawns the orchestrator. Race conditions on macOS may cause flakiness; readiness polling has a 30s timeout per test.
- `proxy.ts` was load-bearing in M2.5 — its rewrite means every existing MCP consumer (anyone who added Husk to Claude Desktop) gets the new code on next install. The Husk-branded tool *names* are preserved so config files don't break, but the behavior pivots from lightpanda-passthrough to watchdog-protected. This is the desired behavior change.

**No placeholders.** Every step has concrete code or an exact command.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-husk-m6-sdks-mcp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, spec + code review between tasks. This is the flow that's shipped M1–M5.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints.

Which approach? (`1` or `2`)
