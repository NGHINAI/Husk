# Husk Milestone 3 (HTTP API) — JSON-RPC Public Protocol

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the M2 `Session` class behind an HTTP server speaking JSON-RPC 2.0, so non-MCP / non-CLI agents (including the Python SDK in M6) can drive Husk over HTTP. After this plan ships, `husk start` runs an HTTP server on `:7777` that accepts six JSON-RPC methods, manages multiple concurrent sessions, and stays running until the process is killed.

**Architecture:** Single-process Node binary. Hono framework for HTTP routing. One `/v1/jsonrpc` endpoint that accepts JSON-RPC 2.0 envelopes and dispatches to method handlers. A `SessionManager` (Map<sessionId, Session>) owns the lifecycle of all live sessions. No HTTP auth in v0 — server binds to `127.0.0.1` only.

**Tech Stack:** TypeScript 5.5, Node 20 LTS, Hono ^4 (HTTP), Pino ^9 (structured logs), `node:crypto.randomUUID`, vitest. No new client-side deps.

**Source spec:** [`docs/superpowers/specs/2026-05-13-husk-design.md`](../specs/2026-05-13-husk-design.md), Section 4 (Architecture — public protocol), Section 6 Interface 1 (Direct SDK — what the HTTP surface enables).

**Branch:** `m3-http` (already created — verify with `git branch --show-current` returns `m3-http`).

**Estimated duration:** ~1 week for one engineer (much smaller than M2 production).

**Prerequisites:**
- All M2 work merged to main, tag `v0.0.3-m2` exists
- `husk demo <url>` works against a prebuilt lightpanda binary

---

## Pre-task Design Decisions

### Decision A — Sessions are first-class resources with explicit lifecycle

Agents `create_session` (returns `session_id`), use it for subsequent calls, and `close_session` when done. No implicit auto-creation, no anonymous "default" session. v0 has no LRU eviction or close-on-disconnect — a leaked `session_id` means a leaked lightpanda subprocess. v0.3 (cloud) adds session timeouts; v0 trusts callers.

### Decision B — JSON-RPC 2.0 dispatch is a switch over method name

Not a registry pattern, not a plugin system. A flat `switch (req.method) { case "create_session": ... }` in one file. Adding M5 watchdog methods is one new case. v1.0 may grow into a registry; v0 stays simple.

### Decision C — Hono over Express / Fastify / raw `node:http`

Hono is small (~12 KB unzipped), Node 20-native, has clean middleware. Already in the dependency table in the spec. Express is bigger and slower; Fastify has more features than we need; raw `node:http` lacks middleware ergonomics. Hono is the right v0 choice.

### Decision D — Structured logging via Pino, but with `silent` mode for tests

Pino emits JSON log lines. Tests run with `level: "silent"` to keep output clean. CLI runs with `level: "info"`. The orchestrator's `husk start` accepts `--log-level <level>` to override.

### Decision E — Errors map to JSON-RPC custom error codes

| Husk error | JSON-RPC error code |
|---|---|
| `session_not_found` (unknown session_id) | -32001 |
| `engine_error` (lightpanda subprocess failure) | -32002 |
| `binary_not_found` (no `LIGHTPANDA_BIN` / not on PATH) | -32003 |
| `invalid_url` (`goto` with malformed URL) | -32004 |
| Generic internal error | -32603 (JSON-RPC standard) |
| Parse error | -32700 (JSON-RPC standard) |
| Method not found | -32601 (JSON-RPC standard) |
| Invalid params | -32602 (JSON-RPC standard) |

### Decision F — `husk demo` keeps working

It already calls `Session.create()` directly. We don't reroute it through the HTTP API. Both code paths coexist: `husk demo` for one-shot CLI, `husk start` for the long-running server. M6 examples will use the HTTP API via the SDK.

---

## File Structure

### New TypeScript source files

| Path | Lines | Responsibility |
|---|---|---|
| `orchestrator/src/session/manager.ts` | ~120 | `SessionManager`: create/get/close, Map<id, Session>, uuid generation, close-all-on-shutdown. |
| `orchestrator/src/http/errors.ts` | ~60 | Husk error classes (`SessionNotFoundError`, `EngineError`, `BinaryNotFoundError`, `InvalidUrlError`) + JSON-RPC mapping. |
| `orchestrator/src/http/methods.ts` | ~140 | Method handlers: `health`, `create_session`, `goto`, `snapshot`, `snapshot_diff`, `close_session`. Each is `async (params, ctx) → result`. |
| `orchestrator/src/http/jsonrpc.ts` | ~110 | Dispatcher: parses incoming envelope, validates JSON-RPC shape, routes to method handler, wraps result/error in response envelope. |
| `orchestrator/src/http/server.ts` | ~80 | Hono app: registers `POST /v1/jsonrpc`, wires logger middleware, exposes `start(port, host)` and `stop()`. |
| `orchestrator/src/index.ts` | modify | Add `husk start [--port N] [--host H] [--log-level L]` subcommand. |

### New tests

| Path | Covers |
|---|---|
| `orchestrator/tests/session/manager.test.ts` | session lifecycle, id uniqueness, close-all |
| `orchestrator/tests/http/errors.test.ts` | error → JSON-RPC code mapping |
| `orchestrator/tests/http/jsonrpc.test.ts` | dispatcher: success, method not found, invalid envelope, parse error |
| `orchestrator/tests/http/methods.test.ts` | each method handler (with a mock SessionManager) |
| `orchestrator/tests/http/server.test.ts` | Hono server start/stop, basic POST to `/v1/jsonrpc` |
| `orchestrator/tests/integration/http-e2e.test.ts` | full HTTP e2e against a real `husk start` server with real lightpanda (skips without binary) |

### New dependencies in `orchestrator/package.json`

```json
"dependencies": {
  "@noble/hashes": "^1.5.0",
  "ws": "^8.18.0",
  "hono": "^4.6.0",
  "pino": "^9.5.0"
}
```

### Modified files

| Path | Change |
|---|---|
| `protocol/jsonrpc.openapi.yaml` | Replace M1 stub (one `health` method) with all 6 v0 methods + error codes. |
| `README.md` | Add `husk start` usage in the "What's Shipping in v0" section. |
| `docs/quickstart.md` | Add an HTTP-server demo section after `husk demo`. |

---

## Tasks

### Task 1: Add HTTP + logging dependencies; session manager

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/package.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/session/manager.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/session/manager.test.ts`

- [ ] **Step 1: Add hono + pino to dependencies**

Open `/Users/nirmalghinaiya/Desktop/husk/orchestrator/package.json`. Read it first. Add hono + pino to `dependencies`:

```json
{
  "name": "husk-orchestrator",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "husk": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "echo 'lint config in M3'",
    "typecheck": "tsc --noEmit",
    "start": "node ./dist/index.js"
  },
  "dependencies": {
    "@noble/hashes": "^1.5.0",
    "hono": "^4.6.0",
    "pino": "^9.5.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/ws": "^8.5.13",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Install**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install
```

Expected: success. Verify:

```sh
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/node_modules/hono/package.json
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/node_modules/pino/package.json
```

Both should exist.

- [ ] **Step 3: Write the failing test for SessionManager**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/session/manager.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { SessionManager, SessionNotFoundError } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

/**
 * Build a fake Session whose lifecycle we can observe in tests without
 * spawning a real lightpanda subprocess.
 */
function fakeSession(): Session {
  const fake = {
    closed: false,
    goto: vi.fn(async () => {}),
    snapshot: vi.fn(async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } })),
    snapshotDiff: vi.fn(async () => null),
    close: vi.fn(async () => {
      fake.closed = true;
    }),
  };
  return fake as unknown as Session;
}

describe("SessionManager", () => {
  it("create() returns a fresh session_id and stores the session", async () => {
    const fake = fakeSession();
    const mgr = new SessionManager(async () => fake);
    const id = await mgr.create();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(mgr.get(id)).toBe(fake);
  });

  it("create() returns unique ids across calls", async () => {
    const mgr = new SessionManager(async () => fakeSession());
    const a = await mgr.create();
    const b = await mgr.create();
    expect(a).not.toBe(b);
  });

  it("get() throws SessionNotFoundError for unknown ids", () => {
    const mgr = new SessionManager(async () => fakeSession());
    expect(() => mgr.get("no-such-session")).toThrow(SessionNotFoundError);
  });

  it("close(id) tears down the session and forgets the id", async () => {
    const fake = fakeSession();
    const mgr = new SessionManager(async () => fake);
    const id = await mgr.create();
    await mgr.close(id);
    expect(fake.close).toHaveBeenCalled();
    expect(() => mgr.get(id)).toThrow(SessionNotFoundError);
  });

  it("close(id) on unknown id is a no-op (does not throw)", async () => {
    const mgr = new SessionManager(async () => fakeSession());
    await expect(mgr.close("ghost")).resolves.not.toThrow();
  });

  it("closeAll() tears down every live session", async () => {
    const fakeA = fakeSession();
    const fakeB = fakeSession();
    let next = 0;
    const mgr = new SessionManager(async () => (next++ === 0 ? fakeA : fakeB));
    await mgr.create();
    await mgr.create();
    await mgr.closeAll();
    expect(fakeA.close).toHaveBeenCalled();
    expect(fakeB.close).toHaveBeenCalled();
    expect(mgr.activeCount()).toBe(0);
  });

  it("activeCount() reflects the number of live sessions", async () => {
    const mgr = new SessionManager(async () => fakeSession());
    expect(mgr.activeCount()).toBe(0);
    await mgr.create();
    expect(mgr.activeCount()).toBe(1);
    await mgr.create();
    expect(mgr.activeCount()).toBe(2);
  });
});
```

- [ ] **Step 4: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/session/manager.test.ts 2>&1 | tail -10
```

Expected: FAIL — module `../../src/session/manager.js` not found.

- [ ] **Step 5: Implement SessionManager**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/session/manager.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { Session } from "./session.js";

/**
 * Thrown when an operation references a session_id that doesn't exist
 * in the manager (either never created, or already closed).
 */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

/**
 * A factory function the manager uses to create new sessions. In
 * production this is `Session.create.bind(Session, opts)`. In tests we
 * pass a function returning a fake.
 */
export type SessionFactory = () => Promise<Session>;

/**
 * Owns the lifecycle of all live sessions. Each session has a unique id
 * (UUID v4). v0 has no eviction or auto-close — leaked ids leak engine
 * processes. v0.3 cloud milestone adds timeouts + LRU.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly factory: SessionFactory) {}

  async create(): Promise<string> {
    const session = await this.factory();
    const id = randomUUID();
    this.sessions.set(id, session);
    return id;
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new SessionNotFoundError(id);
    return s;
  }

  /**
   * Close and remove a session. No-op if the id is unknown (idempotent
   * close — agents may call this defensively).
   */
  async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    await s.close();
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.close(id)));
  }

  activeCount(): number {
    return this.sessions.size;
  }
}
```

- [ ] **Step 6: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/session/manager.test.ts 2>&1 | tail -10
```

Expected: PASS (7 tests).

- [ ] **Step 7: Full orchestrator suite**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -10
```

Expected: 49 tests pass (42 from M2 + 7 new).

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/package.json orchestrator/src/session/manager.ts orchestrator/tests/session/manager.test.ts pnpm-lock.yaml
git commit -m "feat(orchestrator): SessionManager + Hono/Pino deps"
```

---

### Task 2: HTTP error types + JSON-RPC mapping

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/errors.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/errors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  EngineError,
  InvalidUrlError,
  toJsonRpcError,
  JSONRPC_ERROR_CODES,
} from "../../src/http/errors.js";
import { SessionNotFoundError } from "../../src/session/manager.js";
import { LightpandaNotFoundError } from "../../src/engine/binary.js";

describe("Husk error classes", () => {
  it("EngineError carries its message", () => {
    const e = new EngineError("subprocess crashed");
    expect(e.message).toBe("subprocess crashed");
    expect(e.name).toBe("EngineError");
  });

  it("InvalidUrlError carries the offending URL", () => {
    const e = new InvalidUrlError("not a url");
    expect(e.message).toContain("not a url");
    expect(e.name).toBe("InvalidUrlError");
  });
});

describe("toJsonRpcError", () => {
  it("maps SessionNotFoundError to code -32001", () => {
    const err = new SessionNotFoundError("abc");
    const j = toJsonRpcError(err);
    expect(j.code).toBe(JSONRPC_ERROR_CODES.SESSION_NOT_FOUND);
    expect(j.code).toBe(-32001);
    expect(j.message).toContain("abc");
  });

  it("maps EngineError to code -32002", () => {
    const j = toJsonRpcError(new EngineError("oh no"));
    expect(j.code).toBe(-32002);
    expect(j.message).toBe("oh no");
  });

  it("maps LightpandaNotFoundError to code -32003", () => {
    const j = toJsonRpcError(new LightpandaNotFoundError("nope"));
    expect(j.code).toBe(-32003);
  });

  it("maps InvalidUrlError to code -32004", () => {
    const j = toJsonRpcError(new InvalidUrlError("badurl"));
    expect(j.code).toBe(-32004);
  });

  it("maps unknown Error to internal error -32603", () => {
    const j = toJsonRpcError(new Error("???"));
    expect(j.code).toBe(-32603);
    expect(j.message).toBe("???");
  });

  it("handles non-Error throwables by stringifying", () => {
    const j = toJsonRpcError("string-thrown");
    expect(j.code).toBe(-32603);
    expect(j.message).toContain("string-thrown");
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/errors.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/errors.ts`:

```typescript
import { SessionNotFoundError } from "../session/manager.js";
import { LightpandaNotFoundError } from "../engine/binary.js";

/**
 * JSON-RPC custom error codes used by Husk.
 *
 * The -32000..-32099 range is reserved by JSON-RPC 2.0 for "server errors"
 * that servers define themselves. We use the lower end of that range.
 */
export const JSONRPC_ERROR_CODES = {
  SESSION_NOT_FOUND: -32001,
  ENGINE_ERROR: -32002,
  BINARY_NOT_FOUND: -32003,
  INVALID_URL: -32004,
  // JSON-RPC standard codes (defined here so all codes are in one place)
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Raised when the lightpanda subprocess fails or returns malformed data. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

/** Raised when goto() is called with a syntactically invalid URL. */
export class InvalidUrlError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Invalid URL: ${url}`);
    this.name = "InvalidUrlError";
    this.url = url;
  }
}

export interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Map any thrown value to a JSON-RPC error envelope. Known Husk error
 * types get their assigned code; everything else becomes an internal
 * error (-32603).
 */
export function toJsonRpcError(err: unknown): JsonRpcErrorPayload {
  if (err instanceof SessionNotFoundError) {
    return { code: JSONRPC_ERROR_CODES.SESSION_NOT_FOUND, message: err.message };
  }
  if (err instanceof EngineError) {
    return { code: JSONRPC_ERROR_CODES.ENGINE_ERROR, message: err.message };
  }
  if (err instanceof LightpandaNotFoundError) {
    return { code: JSONRPC_ERROR_CODES.BINARY_NOT_FOUND, message: err.message };
  }
  if (err instanceof InvalidUrlError) {
    return { code: JSONRPC_ERROR_CODES.INVALID_URL, message: err.message };
  }
  if (err instanceof Error) {
    return { code: JSONRPC_ERROR_CODES.INTERNAL_ERROR, message: err.message };
  }
  return {
    code: JSONRPC_ERROR_CODES.INTERNAL_ERROR,
    message: `Non-Error thrown: ${String(err)}`,
  };
}
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/errors.test.ts 2>&1 | tail -10
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/http/errors.ts orchestrator/tests/http/errors.test.ts
git commit -m "feat(http): Husk error classes + JSON-RPC code mapping"
```

---

### Task 3: JSON-RPC method handlers

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/methods.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/methods.test.ts`

Each method is `async (params, ctx) → result`. The `ctx` holds a SessionManager + version info.

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/methods.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { METHODS, type MethodContext } from "../../src/http/methods.js";
import { SessionManager, SessionNotFoundError } from "../../src/session/manager.js";
import { InvalidUrlError } from "../../src/http/errors.js";
import type { Session } from "../../src/session/session.js";

function fakeSession(overrides: Partial<Session> = {}): Session {
  const base = {
    goto: vi.fn(async () => {}),
    snapshot: vi.fn(async () => ({
      v: 1,
      url: "https://example.com",
      count: 2,
      root: { i: "x", r: "RootWebArea", n: "", s: [] },
    })),
    snapshotDiff: vi.fn(async () => null),
    close: vi.fn(async () => {}),
  };
  return { ...base, ...overrides } as unknown as Session;
}

function buildCtx(): { ctx: MethodContext; mgr: SessionManager; created: Session[] } {
  const created: Session[] = [];
  const mgr = new SessionManager(async () => {
    const s = fakeSession();
    created.push(s);
    return s;
  });
  return {
    ctx: { sessions: mgr, version: "0.0.0-test" },
    mgr,
    created,
  };
}

describe("health", () => {
  it("returns ok + version + activeCount", async () => {
    const { ctx, mgr } = buildCtx();
    await mgr.create();
    const result = await METHODS.health({}, ctx);
    expect(result).toEqual({ ok: true, version: "0.0.0-test", activeSessions: 1 });
  });
});

describe("create_session", () => {
  it("returns a session_id string", async () => {
    const { ctx } = buildCtx();
    const result = (await METHODS.create_session({}, ctx)) as { session_id: string };
    expect(typeof result.session_id).toBe("string");
    expect(result.session_id.length).toBeGreaterThan(0);
  });
});

describe("goto", () => {
  it("calls Session.goto with the supplied url", async () => {
    const { ctx, mgr, created } = buildCtx();
    const id = await mgr.create();
    await METHODS.goto({ session_id: id, url: "https://example.com/" }, ctx);
    expect(created[0].goto).toHaveBeenCalledWith("https://example.com/");
  });

  it("throws SessionNotFoundError for unknown session", async () => {
    const { ctx } = buildCtx();
    await expect(
      METHODS.goto({ session_id: "nope", url: "https://example.com" }, ctx)
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it("throws InvalidUrlError when url is not a string", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      METHODS.goto({ session_id: id, url: 123 } as any, ctx)
    ).rejects.toBeInstanceOf(InvalidUrlError);
  });

  it("throws InvalidUrlError when url fails to parse", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    await expect(METHODS.goto({ session_id: id, url: "not a url" }, ctx)).rejects.toBeInstanceOf(
      InvalidUrlError
    );
  });
});

describe("snapshot", () => {
  it("returns the Session.snapshot() result", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    const result = await METHODS.snapshot({ session_id: id }, ctx);
    expect(result).toMatchObject({ v: 1, url: "https://example.com", count: 2 });
  });
});

describe("snapshot_diff", () => {
  it("returns null when there's no prior snapshot", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    const result = await METHODS.snapshot_diff({ session_id: id }, ctx);
    expect(result).toBeNull();
  });
});

describe("close_session", () => {
  it("closes the session and returns ok", async () => {
    const { ctx, mgr, created } = buildCtx();
    const id = await mgr.create();
    const result = await METHODS.close_session({ session_id: id }, ctx);
    expect(result).toEqual({ ok: true });
    expect(created[0].close).toHaveBeenCalled();
  });

  it("is idempotent on unknown session_id (no throw)", async () => {
    const { ctx } = buildCtx();
    const result = await METHODS.close_session({ session_id: "ghost" }, ctx);
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/methods.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement methods.ts**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/methods.ts`:

```typescript
import type { SessionManager } from "../session/manager.js";
import type { Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { InvalidUrlError } from "./errors.js";

/** Per-request context the methods need. Wired in by the JSON-RPC dispatcher. */
export interface MethodContext {
  sessions: SessionManager;
  /** Husk version string (mirrored from package.json / orchestrator/src/version.ts). */
  version: string;
}

/** Result of `health` — confirms the server is up and reports session count. */
export interface HealthResult {
  ok: true;
  version: string;
  activeSessions: number;
}

/** Result of `create_session`. */
export interface CreateSessionResult {
  session_id: string;
}

/** Result of `goto`. */
export interface GotoResult {
  ok: true;
}

/** Result of `close_session`. Also returned when the id was unknown (idempotent). */
export interface CloseSessionResult {
  ok: true;
}

/**
 * All v0 JSON-RPC method handlers. Add new methods here as flat
 * exports; the dispatcher in jsonrpc.ts routes by name via this map.
 */
export const METHODS = {
  async health(_params: unknown, ctx: MethodContext): Promise<HealthResult> {
    return { ok: true, version: ctx.version, activeSessions: ctx.sessions.activeCount() };
  },

  async create_session(_params: unknown, ctx: MethodContext): Promise<CreateSessionResult> {
    const session_id = await ctx.sessions.create();
    return { session_id };
  },

  async goto(
    params: { session_id: string; url: string },
    ctx: MethodContext
  ): Promise<GotoResult> {
    if (typeof params.url !== "string") throw new InvalidUrlError(String(params.url));
    try {
      // eslint-disable-next-line no-new
      new URL(params.url);
    } catch {
      throw new InvalidUrlError(params.url);
    }
    const session = ctx.sessions.get(params.session_id);
    await session.goto(params.url);
    return { ok: true };
  },

  async snapshot(
    params: { session_id: string },
    ctx: MethodContext
  ): Promise<Snapshot> {
    const session = ctx.sessions.get(params.session_id);
    return session.snapshot();
  },

  async snapshot_diff(
    params: { session_id: string },
    ctx: MethodContext
  ): Promise<SnapshotDiff | null> {
    const session = ctx.sessions.get(params.session_id);
    return session.snapshotDiff();
  },

  async close_session(
    params: { session_id: string },
    ctx: MethodContext
  ): Promise<CloseSessionResult> {
    await ctx.sessions.close(params.session_id);
    return { ok: true };
  },
} as const;

/** Type-level enumeration of all method names. */
export type MethodName = keyof typeof METHODS;
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/methods.test.ts 2>&1 | tail -10
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/http/methods.ts orchestrator/tests/http/methods.test.ts
git commit -m "feat(http): JSON-RPC method handlers (health, sessions, goto, snapshot, diff)"
```

---

### Task 4: JSON-RPC dispatcher

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/jsonrpc.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/jsonrpc.test.ts`

The dispatcher takes a parsed JSON-RPC request, validates the envelope, routes to a method handler by name, wraps the result/error in a response envelope.

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/jsonrpc.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { dispatch } from "../../src/http/jsonrpc.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";
import type { MethodContext } from "../../src/http/methods.js";

function fakeSessionMgr(): SessionManager {
  return new SessionManager(async () => ({
    goto: async () => {},
    snapshot: async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } }),
    snapshotDiff: async () => null,
    close: async () => {},
  } as unknown as Session));
}

function ctx(): MethodContext {
  return { sessions: fakeSessionMgr(), version: "0.0.0-test" };
}

describe("dispatch", () => {
  it("dispatches a valid health request and wraps in JSON-RPC response", async () => {
    const res = await dispatch({ jsonrpc: "2.0", id: 1, method: "health" }, ctx());
    expect(res).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect("result" in res).toBe(true);
    if ("result" in res) {
      expect(res.result).toMatchObject({ ok: true, version: "0.0.0-test" });
    }
  });

  it("returns method-not-found (-32601) for unknown method name", async () => {
    const res = await dispatch({ jsonrpc: "2.0", id: 2, method: "no_such_method" }, ctx());
    if (!("error" in res)) throw new Error("expected error envelope");
    expect(res.error.code).toBe(-32601);
    expect(res.error.message).toMatch(/no_such_method/);
  });

  it("returns invalid-request (-32600) when jsonrpc field is missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await dispatch({ id: 3, method: "health" } as any, ctx());
    if (!("error" in res)) throw new Error("expected error envelope");
    expect(res.error.code).toBe(-32600);
  });

  it("returns invalid-request when jsonrpc field is wrong version", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await dispatch({ jsonrpc: "1.0", id: 4, method: "health" } as any, ctx());
    if (!("error" in res)) throw new Error("expected error envelope");
    expect(res.error.code).toBe(-32600);
  });

  it("returns invalid-request when method is not a string", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await dispatch({ jsonrpc: "2.0", id: 5, method: 123 } as any, ctx());
    if (!("error" in res)) throw new Error("expected error envelope");
    expect(res.error.code).toBe(-32600);
  });

  it("preserves the request id (including string and null) in the response", async () => {
    const r1 = await dispatch({ jsonrpc: "2.0", id: "abc", method: "health" }, ctx());
    expect(r1.id).toBe("abc");
    const r2 = await dispatch({ jsonrpc: "2.0", id: null, method: "health" }, ctx());
    expect(r2.id).toBeNull();
  });

  it("passes params to the method handler", async () => {
    const c = ctx();
    const created = await dispatch({ jsonrpc: "2.0", id: 6, method: "create_session" }, c);
    if (!("result" in created)) throw new Error("expected result");
    const session_id = (created.result as { session_id: string }).session_id;
    const goto_res = await dispatch(
      { jsonrpc: "2.0", id: 7, method: "goto", params: { session_id, url: "https://example.com/" } },
      c
    );
    if (!("result" in goto_res)) throw new Error("expected result");
    expect(goto_res.result).toEqual({ ok: true });
  });

  it("maps method-thrown InvalidUrlError to JSON-RPC error code -32004", async () => {
    const c = ctx();
    const created = await dispatch({ jsonrpc: "2.0", id: 8, method: "create_session" }, c);
    if (!("result" in created)) throw new Error("expected result");
    const session_id = (created.result as { session_id: string }).session_id;
    const res = await dispatch(
      { jsonrpc: "2.0", id: 9, method: "goto", params: { session_id, url: "not a url" } },
      c
    );
    if (!("error" in res)) throw new Error("expected error envelope");
    expect(res.error.code).toBe(-32004);
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/jsonrpc.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement dispatcher**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/jsonrpc.ts`:

```typescript
import { JSONRPC_ERROR_CODES, toJsonRpcError } from "./errors.js";
import { METHODS, type MethodContext, type MethodName } from "./methods.js";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

function isValidEnvelope(req: unknown): req is JsonRpcRequest {
  if (!req || typeof req !== "object") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = req as any;
  if (r.jsonrpc !== "2.0") return false;
  if (typeof r.method !== "string") return false;
  return true;
}

/**
 * Dispatch a single JSON-RPC request. Always resolves with a JSON-RPC
 * response envelope; never throws. Method-handler errors are caught and
 * mapped via toJsonRpcError.
 */
export async function dispatch(req: unknown, ctx: MethodContext): Promise<JsonRpcResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id: JsonRpcId = (req as any)?.id ?? null;

  if (!isValidEnvelope(req)) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
        message: "Invalid JSON-RPC envelope: requires jsonrpc='2.0' and method:string",
      },
    };
  }

  const handler = METHODS[req.method as MethodName];
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: `Method not found: ${req.method}`,
      },
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (handler as any)(req.params ?? {}, ctx);
    return { jsonrpc: "2.0", id: req.id, result };
  } catch (err) {
    return { jsonrpc: "2.0", id: req.id, error: toJsonRpcError(err) };
  }
}
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/jsonrpc.test.ts 2>&1 | tail -10
```

Expected: PASS (8 tests).

- [ ] **Step 5: Full suite**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 75 tests (42 + 7 + 8 + 10 + 8).

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/http/jsonrpc.ts orchestrator/tests/http/jsonrpc.test.ts
git commit -m "feat(http): JSON-RPC 2.0 dispatcher with envelope validation"
```

---

### Task 5: Hono HTTP server

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/server.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/http/server.test.ts`:

```typescript
import { describe, expect, it, afterEach } from "vitest";
import { createHuskServer, type HuskServer } from "../../src/http/server.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function fakeMgr(): SessionManager {
  return new SessionManager(async () => ({
    goto: async () => {},
    snapshot: async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } }),
    snapshotDiff: async () => null,
    close: async () => {},
  } as unknown as Session));
}

describe("createHuskServer", () => {
  let server: HuskServer | undefined;
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("starts on an ephemeral port and responds to /v1/jsonrpc with health", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "0.0.0-test",
      logLevel: "silent",
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "health" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(body.result).toMatchObject({ ok: true, version: "0.0.0-test" });
  });

  it("returns parse error (-32700) on malformed JSON body", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "x",
      logLevel: "silent",
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(200); // JSON-RPC: HTTP 200, error in envelope
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it("returns 405 for non-POST methods", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "x",
      logLevel: "silent",
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("stop() closes the listening socket and releases the port", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "x",
      logLevel: "silent",
    });
    const port = server.port;
    await server.stop();
    server = undefined; // prevent afterEach re-stop
    await expect(
      fetch(`http://127.0.0.1:${port}/v1/jsonrpc`, {
        method: "POST",
        body: "{}",
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/server.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement Hono server**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/server.ts`:

```typescript
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import pino, { type Logger } from "pino";
import { dispatch } from "./jsonrpc.js";
import { JSONRPC_ERROR_CODES } from "./errors.js";
import type { MethodContext } from "./methods.js";
import type { SessionManager } from "../session/manager.js";

export interface HuskServerOptions {
  port: number;
  host: string;
  sessions: SessionManager;
  /** Version surfaced via health responses. */
  version: string;
  /** Pino log level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent". */
  logLevel?: string;
}

export interface HuskServer {
  /** Resolved bound port (useful when caller passed 0). */
  port: number;
  /** Underlying logger so the caller can emit its own structured logs. */
  log: Logger;
  /** Stop accepting new connections and close the listening socket. */
  stop(): Promise<void>;
}

/**
 * Start the Husk HTTP server. Resolves once the listening socket is
 * bound. v0 binds to 127.0.0.1 only; no TLS, no auth.
 */
export async function createHuskServer(opts: HuskServerOptions): Promise<HuskServer> {
  const log = pino({ level: opts.logLevel ?? "info", name: "husk-orchestrator" });
  const app = new Hono();

  const ctx: MethodContext = { sessions: opts.sessions, version: opts.version };

  app.post("/v1/jsonrpc", async (c) => {
    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: JSONRPC_ERROR_CODES.PARSE_ERROR, message: "Invalid JSON in request body" },
        },
        200
      );
    }
    const response = await dispatch(parsed, ctx);
    log.debug({ method: (parsed as { method?: string })?.method, id: response.id }, "jsonrpc");
    return c.json(response, 200);
  });

  // Method-not-allowed for non-POST
  app.all("/v1/jsonrpc", (c) => c.text("Method Not Allowed", 405));

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, (info) => {
      log.info({ port: info.port, host: opts.host }, "husk http server listening");
      resolve(s);
    });
  });

  const addr = (server as { address?: () => unknown }).address?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundPort = typeof addr === "object" && addr !== null ? (addr as any).port : opts.port;

  return {
    port: boundPort,
    log,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).close((err?: Error) => (err ? reject(err) : resolve()));
      }),
  };
}
```

- [ ] **Step 4: Add `@hono/node-server` to deps**

The Hono framework itself doesn't include a Node http listener — `@hono/node-server` provides `serve()`. Add it to `orchestrator/package.json` dependencies:

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm --filter ./orchestrator add @hono/node-server@^1.13.0
```

Verify:

```sh
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/node_modules/@hono/node-server/package.json
```

- [ ] **Step 5: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/http/server.test.ts 2>&1 | tail -10
```

Expected: PASS (4 tests).

- [ ] **Step 6: Full suite**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 79 tests pass.

- [ ] **Step 7: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/package.json orchestrator/src/http/server.ts orchestrator/tests/http/server.test.ts pnpm-lock.yaml
git commit -m "feat(http): Hono server on /v1/jsonrpc + pino logging"
```

---

### Task 6: `husk start` CLI subcommand

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/index.ts`

The current CLI has `version`, `help`, `demo`. Add `start [--port N] [--host H] [--log-level L]`.

- [ ] **Step 1: Read the current index.ts**

Read `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/index.ts`. Then replace it with:

```typescript
#!/usr/bin/env node
import { getVersion } from "./version.js";
import { Session } from "./session/session.js";
import { SessionManager } from "./session/manager.js";
import { createHuskServer } from "./http/server.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

switch (cmd) {
  case "version":
  case "--version":
  case "-v":
    console.log(`husk v${getVersion()}`);
    break;
  case "demo": {
    const url = args[1];
    if (!url) {
      console.error("Usage: husk demo <url>");
      process.exit(1);
    }
    await runDemo(url);
    break;
  }
  case "start":
    await runServer(parseStartArgs(args.slice(1)));
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`husk v${getVersion()}

Usage:
  husk version                            Print version
  husk help                               Print this help
  husk demo <url>                         One-shot: drive lightpanda against URL,
                                          print the spec-§5.2 snapshot, exit
  husk start [--port N] [--host H] [--log-level L]
                                          Start the HTTP/JSON-RPC server on the
                                          given port (default 7777) and host
                                          (default 127.0.0.1). Runs until killed.

Coming in later milestones:
  husk run <example>      Run an example agent (M6)
  husk inspect <id>       Inspect a live session (M6)`);
    break;
  default:
    console.error(`Unknown command: ${cmd}. Try 'husk help'.`);
    process.exit(1);
}

async function runDemo(url: string): Promise<void> {
  let session: Session | undefined;
  try {
    session = await Session.create({ log: (l) => console.error(l) });
    await session.goto(url);
    const snap = await session.snapshot();
    console.log(JSON.stringify(snap, null, 2));
  } catch (err) {
    console.error("[husk demo] FAILED:", (err as Error).message);
    process.exitCode = 1;
  } finally {
    await session?.close();
  }
}

interface StartArgs {
  port: number;
  host: string;
  logLevel: string;
}

function parseStartArgs(rest: string[]): StartArgs {
  const out: StartArgs = { port: 7777, host: "127.0.0.1", logLevel: "info" };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--port" && rest[i + 1]) {
      out.port = Number(rest[++i]);
      if (!Number.isFinite(out.port) || out.port < 0) {
        console.error("husk start: --port must be a non-negative integer");
        process.exit(1);
      }
    } else if (a === "--host" && rest[i + 1]) {
      out.host = rest[++i];
    } else if (a === "--log-level" && rest[i + 1]) {
      out.logLevel = rest[++i];
    } else {
      console.error(`husk start: unknown arg ${a}`);
      process.exit(1);
    }
  }
  return out;
}

async function runServer(args: StartArgs): Promise<void> {
  // The SessionManager's factory calls Session.create(), which itself locates
  // the lightpanda binary. If the binary is missing the first create_session
  // call will reject with a structured BinaryNotFoundError; the server stays
  // up so callers see the error rather than a connection refusal.
  const sessions = new SessionManager(() => Session.create({ log: (l) => process.stderr.write(l + "\n") }));

  const server = await createHuskServer({
    port: args.port,
    host: args.host,
    sessions,
    version: getVersion(),
    logLevel: args.logLevel,
  });

  // Graceful shutdown on SIGINT / SIGTERM
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    server.log.info({ signal }, "husk: shutting down");
    await sessions.closeAll();
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
```

- [ ] **Step 2: Build + typecheck**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Smoke-test `husk start` (background, then curl, then kill)**

```sh
node /Users/nirmalghinaiya/Desktop/husk/orchestrator/dist/index.js start --port 7778 --log-level error > /tmp/husk-server.log 2>&1 &
HUSK_PID=$!
sleep 1
echo "=== POST health to /v1/jsonrpc ==="
curl -s -X POST http://127.0.0.1:7778/v1/jsonrpc \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"health"}'
echo ""
echo "=== Kill server ==="
kill $HUSK_PID 2>/dev/null
wait $HUSK_PID 2>/dev/null
echo "=== Server output ==="
cat /tmp/husk-server.log | head -10
```

You should see `{"jsonrpc":"2.0","id":1,"result":{"ok":true,"version":"0.0.0","activeSessions":0}}` and a clean shutdown.

- [ ] **Step 4: Full suite (no regression)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 79 tests still pass.

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/index.ts
git commit -m "feat(orchestrator): husk start CLI subcommand"
```

---

### Task 7: Integration test against a real `husk start` server with real lightpanda

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/http-e2e.test.ts`

This is the formal end-to-end check: spawn `husk start` on an ephemeral port, drive it via POST requests with real session create + goto + snapshot. Skips if no lightpanda binary.

- [ ] **Step 1: Write the integration test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/http-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startFixtureServer } from "./fixture-server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUSK_BIN = resolve(__dirname, "../../dist/index.js");

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

interface JsonRpcResult {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

async function post(url: string, body: unknown): Promise<JsonRpcResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<JsonRpcResult>;
}

async function waitForUp(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await post(url, { jsonrpc: "2.0", id: 0, method: "health" });
      if (r.result) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`husk start server not ready after ${timeoutMs}ms`);
}

integrationOrSkip("HTTP e2e — husk start → create_session → goto → snapshot", () => {
  it("full request/response flow against a real lightpanda binary", async () => {
    // Pick an unlikely-occupied port for this test
    const port = 17777 + Math.floor(Math.random() * 1000);
    const child = spawn("node", [HUSK_BIN, "start", "--port", String(port), "--log-level", "silent"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rpcUrl = `http://127.0.0.1:${port}/v1/jsonrpc`;

    const fixture = await startFixtureServer();
    try {
      await waitForUp(rpcUrl);

      // 1. health
      const health = await post(rpcUrl, { jsonrpc: "2.0", id: 1, method: "health" });
      expect(health.result).toMatchObject({ ok: true, activeSessions: 0 });

      // 2. create_session
      const createRes = await post(rpcUrl, { jsonrpc: "2.0", id: 2, method: "create_session" });
      const session_id = (createRes.result as { session_id: string }).session_id;
      expect(typeof session_id).toBe("string");

      // 3. goto
      const gotoRes = await post(rpcUrl, {
        jsonrpc: "2.0",
        id: 3,
        method: "goto",
        params: { session_id, url: fixture.url },
      });
      expect(gotoRes.result).toEqual({ ok: true });

      // 4. snapshot
      const snapRes = await post(rpcUrl, {
        jsonrpc: "2.0",
        id: 4,
        method: "snapshot",
        params: { session_id },
      });
      const snap = snapRes.result as { v: number; count: number };
      expect(snap.v).toBe(1);
      expect(snap.count).toBeGreaterThan(0);

      // 5. close_session
      const closeRes = await post(rpcUrl, {
        jsonrpc: "2.0",
        id: 5,
        method: "close_session",
        params: { session_id },
      });
      expect(closeRes.result).toEqual({ ok: true });

      // 6. health post-close shows 0 active
      const health2 = await post(rpcUrl, { jsonrpc: "2.0", id: 6, method: "health" });
      expect(health2.result).toMatchObject({ activeSessions: 0 });
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
      await fixture.close();
    }
  }, 45_000);
});
```

- [ ] **Step 2: Build (needed for the test to find dist/index.js)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm build 2>&1 | tail -3
```

- [ ] **Step 3: Run the integration test (skips without binary)**

If lightpanda is on `LIGHTPANDA_BIN` or PATH, the test will run end-to-end. If not, it skips.

```sh
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && \
  pnpm test tests/integration/http-e2e.test.ts 2>&1 | tail -15
```

Expected (with binary): PASS (1 test).
Expected (without binary): SKIPPED.

- [ ] **Step 4: Full suite**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -10
```

Expected: 79 unit tests pass, 2 integration tests skipped (without binary) or 2 passed (with binary).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/tests/integration/http-e2e.test.ts
git commit -m "feat(http): integration test — full JSON-RPC flow against real lightpanda"
```

---

### Task 8: Update protocol/jsonrpc.openapi.yaml with the real method surface

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/protocol/jsonrpc.openapi.yaml`

The M1 stub had one `health` method. Now it gets all six. This is the public API spec — SDKs (M6) generate against it.

- [ ] **Step 1: Replace the OpenAPI spec**

Replace `/Users/nirmalghinaiya/Desktop/husk/protocol/jsonrpc.openapi.yaml` with:

```yaml
openapi: 3.1.0
info:
  title: Husk JSON-RPC API
  version: 0.0.0
  description: |
    JSON-RPC 2.0 over HTTP/1.1 + HTTP/2 (server: Node `http`). Single
    endpoint at /v1/jsonrpc accepting POSTed JSON-RPC envelopes.

    Six methods in v0:
      - health           — server liveness + active session count
      - create_session   — spawn a lightpanda subprocess + open CDP
      - goto             — navigate the session to a URL
      - snapshot         — return a spec-§5.2 JSON-LD snapshot
      - snapshot_diff    — return diff vs prior snapshot, or null
      - close_session    — tear down the session

    Custom JSON-RPC error codes:
      -32001  Session not found
      -32002  Engine error (lightpanda subprocess failure)
      -32003  Lightpanda binary not found
      -32004  Invalid URL

    Plus JSON-RPC 2.0 standard codes (-32600..-32700).
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: http://localhost:7777
    description: Local orchestrator (default)

paths:
  /v1/jsonrpc:
    post:
      summary: JSON-RPC 2.0 endpoint
      operationId: jsonrpc
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/JsonRpcRequest"
      responses:
        "200":
          description: JSON-RPC response (success or error in envelope)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/JsonRpcResponse"
        "405":
          description: Method Not Allowed (only POST accepted on this endpoint)

components:
  schemas:
    JsonRpcRequest:
      type: object
      required: [jsonrpc, method, id]
      properties:
        jsonrpc:
          type: string
          const: "2.0"
        method:
          type: string
          enum:
            - health
            - create_session
            - goto
            - snapshot
            - snapshot_diff
            - close_session
        params:
          type: object
        id:
          oneOf: [{ type: string }, { type: integer }]

    JsonRpcResponse:
      type: object
      required: [jsonrpc, id]
      properties:
        jsonrpc:
          type: string
          const: "2.0"
        result: {}
        error:
          $ref: "#/components/schemas/JsonRpcError"
        id:
          oneOf: [{ type: string }, { type: integer }, { type: "null" }]

    JsonRpcError:
      type: object
      required: [code, message]
      properties:
        code:
          type: integer
          description: |
            JSON-RPC error code. Husk custom codes: -32001 (session not
            found), -32002 (engine error), -32003 (binary not found),
            -32004 (invalid URL). Plus JSON-RPC 2.0 standard codes.
        message:
          type: string
        data: {}

    HealthResult:
      type: object
      required: [ok, version, activeSessions]
      properties:
        ok:
          type: boolean
          const: true
        version:
          type: string
        activeSessions:
          type: integer

    CreateSessionResult:
      type: object
      required: [session_id]
      properties:
        session_id:
          type: string

    GotoParams:
      type: object
      required: [session_id, url]
      properties:
        session_id:
          type: string
        url:
          type: string
          format: uri

    SnapshotParams:
      type: object
      required: [session_id]
      properties:
        session_id:
          type: string

    CloseSessionParams:
      type: object
      required: [session_id]
      properties:
        session_id:
          type: string
```

- [ ] **Step 2: Verify the YAML parses**

```sh
python3 -c "import yaml; yaml.safe_load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/jsonrpc.openapi.yaml')); print('OK')"
```

Expected: `OK`. If `yaml` is missing, install via `python3 -m pip install pyyaml`.

- [ ] **Step 3: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add protocol/jsonrpc.openapi.yaml
git commit -m "feat(protocol): real JSON-RPC method surface in OpenAPI spec"
```

---

### Task 9: Documentation updates + smoke + tag

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/README.md`
- Modify: `/Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md`

- [ ] **Step 1: Add `husk start` to the README Quickstart**

Find the `## Quickstart` section in `/Users/nirmalghinaiya/Desktop/husk/README.md`. After the existing `husk demo` example, append a new block. Read the README first to find the right insertion point; the existing Quickstart shell block ends with `node ./orchestrator/dist/index.js demo https://example.com | head -50`.

Insert AFTER that line, before the next markdown section:

```sh
# Or run the full HTTP/JSON-RPC server (M3 — runs until you Ctrl-C)
node ./orchestrator/dist/index.js start --port 7777

# In another terminal — drive Husk over HTTP
curl -s -X POST http://127.0.0.1:7777/v1/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_session"}'
```

- [ ] **Step 2: Add an HTTP section to docs/quickstart.md**

Append at the end of `/Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md`:

```markdown

## Run the HTTP server

The `husk start` subcommand runs the orchestrator's JSON-RPC server on
port 7777 (default) for use by non-CLI agents and SDK clients.

```sh
LIGHTPANDA_BIN=~/.husk/bin/lightpanda \
  node ./orchestrator/dist/index.js start --port 7777
```

The server stays up until you send SIGINT (Ctrl-C). It accepts
JSON-RPC 2.0 envelopes at POST `/v1/jsonrpc`. Six methods are available:

- `health` — server liveness + active session count
- `create_session` — start a lightpanda subprocess + open CDP, returns a `session_id`
- `goto` — navigate the session to a URL
- `snapshot` — return a spec-§5.2 JSON-LD snapshot
- `snapshot_diff` — return diff vs prior snapshot, or `null` if no prior
- `close_session` — tear down the session

Example flow:

```sh
RPC=http://127.0.0.1:7777/v1/jsonrpc

# 1. Create a session
SID=$(curl -s -X POST $RPC -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_session"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['result']['session_id'])")

# 2. Navigate
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"goto\",\"params\":{\"session_id\":\"$SID\",\"url\":\"https://example.com/\"}}"

# 3. Snapshot
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"snapshot\",\"params\":{\"session_id\":\"$SID\"}}" \
  | head -40

# 4. Close
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"close_session\",\"params\":{\"session_id\":\"$SID\"}}"
```

The full OpenAPI spec is at
[`protocol/jsonrpc.openapi.yaml`](../protocol/jsonrpc.openapi.yaml).
SDKs in M6 will be generated against this spec.
```

(Use triple-backticks in the actual file. The block above shows the markdown content with embedded triple-backtick code blocks.)

- [ ] **Step 3: Commit docs**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add README.md docs/quickstart.md
git commit -m "docs: husk start + HTTP API flow in README and quickstart"
```

- [ ] **Step 4: End-to-end smoke + tag**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
make clean 2>&1 | tail -3
pnpm install 2>&1 | tail -3
make all 2>&1 | tail -8
make test 2>&1 | grep -E "(passed|Tests|Files|skipped)" | tail -10
```

Expected: ≥ 79 orchestrator tests + 33 mcp + 4 sdk-ts + 4 sdk-py = ≥ 120 tests passing.

Optional: if the prebuilt lightpanda binary is available locally, run a manual integration smoke:

```sh
test -x /Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda && \
  LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  node /Users/nirmalghinaiya/Desktop/husk/orchestrator/dist/index.js start --port 7779 --log-level error > /tmp/m3-smoke.log 2>&1 &
HUSK_PID=$!
sleep 2
curl -s -X POST http://127.0.0.1:7779/v1/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"health"}' && echo ""
kill $HUSK_PID 2>/dev/null; wait $HUSK_PID 2>/dev/null
```

You should see a `{"jsonrpc":"2.0","id":1,"result":{"ok":true,...}}` JSON response.

- [ ] **Step 5: Tag the milestone**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git tag -a v0.0.4-m3 -m "Milestone 3 (HTTP API) complete: husk start serves JSON-RPC on :7777"
git tag --list | tail -5
```

- [ ] **Step 6: Print summary**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
echo "=== M3 commits on this branch ==="
git log --oneline main..HEAD
echo ""
echo "=== Test totals ==="
make test 2>&1 | grep -E "(passed|Tests|Files|skipped)" | tail -10
echo ""
echo "=== Next: invoke superpowers:finishing-a-development-branch ==="
```

---

## Definition of Done

- [ ] All 9 tasks committed on branch `m3-http`
- [ ] `make clean && pnpm install && make all` exits 0
- [ ] `pnpm test` in `orchestrator/` shows ≥ 79 unit tests + 2 integration tests (skipped or passing depending on binary availability)
- [ ] `husk start --port 7777` runs and accepts POSTs to `/v1/jsonrpc`
- [ ] `curl -X POST .../v1/jsonrpc -d '{"jsonrpc":"2.0","id":1,"method":"health"}'` returns a valid JSON-RPC envelope
- [ ] `protocol/jsonrpc.openapi.yaml` has all 6 v0 methods enumerated
- [ ] README + quickstart updated with `husk start` examples
- [ ] Tag `v0.0.4-m3` exists
- [ ] No code changes outside `orchestrator/`, `protocol/`, `README.md`, `docs/quickstart.md`

If any DoD checkbox fails, the milestone is not complete; address the gap before merging to main.

---

## What's NOT in this plan (deferred)

- **Site graph cache** (per-domain stable_id → selector persistence) — M4
- **Watchdog rule engine + action planner** — M5
- **SDK transports** (TS + Python clients hitting the JSON-RPC API) — M6
- **MCP watchdog integration** (the MCP shim becomes policy-aware) — M5/M6
- **HTTP auth** (API keys / bearer tokens) — v0.3 cloud milestone
- **Session timeouts / LRU eviction** — v0.3
- **Pino logging to file + log rotation** — v0.3 ops polish
- **HTTPS / TLS** — v0.3
- **Rate limiting** — v0.3
- **Multiple `/v1/jsonrpc` request batching** (JSON-RPC 2.0 supports it; not needed for v0)
- **SSE / WebSocket for streaming snapshots** — v0.1 nice-to-have

When this plan ships, the next plan is **Plan #5 — M4 (snapshot pipeline + site graph cache)**, which adds the SQLite per-domain stable_id store and cross-page resolution that makes the watchdog (M5) actually durable across navigations.
