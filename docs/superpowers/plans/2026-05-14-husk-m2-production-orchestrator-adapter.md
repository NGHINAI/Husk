# Husk Milestone 2 (Production) — Orchestrator-Side Lightpanda Adapter

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the orchestrator-side adapter that drives a prebuilt lightpanda binary via CDP, extracts the full accessibility tree, and emits spec-§5.2 short-key JSON-LD snapshots with v0 stable IDs and orchestrator-polled mutation diffs. Ship enough working code that `husk session create → goto → snapshot` produces a real semantic JSON-LD blob, demonstrating M2 is functionally complete.

**Architecture:** All work in `orchestrator/src/` (TypeScript). No Zig changes. No engine patches. The orchestrator spawns lightpanda as a subprocess (`lightpanda serve --host 127.0.0.1 --port <ephemeral>`), opens a CDP WebSocket via `/json/list`, attaches to a fresh target via `Target.createTarget` + `Target.attachToTarget`, calls `Accessibility.enable` + `Page.navigate` + `Accessibility.getFullAXTree`, and runs the resulting AXNode tree through a snapshot adapter that produces spec-§5.2 short-key JSON-LD with blake3-hashed stable IDs.

**Tech Stack:** TypeScript 5.5, Node 20 LTS, vitest, ws (WebSocket), @noble/hashes (blake3 pure-JS), node:child_process. No Hono yet (M3). No SQLite yet (M4). No watchdog yet (M5).

**Source spec:** [`docs/superpowers/specs/2026-05-13-husk-design.md`](../specs/2026-05-13-husk-design.md) (amended for v0 orchestrator-only ship)

**Spike findings consumed:** [`docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md`](../spikes/2026-05-14-m2-lightpanda-audit/DECISION.md). T7 PoC at `engine/spike/snapshot-poc.mjs` is the reference implementation we port and harden.

**Branch:** `m2-production` (already created — verify with `git branch --show-current` returns `m2-production`).

**Estimated duration:** 2 weeks for one engineer.

---

## Pre-task Design Decisions (lock these before starting)

These are not separate tasks; they're decisions that pre-date Task 1 to avoid mid-plan ambiguity.

### Decision A — Binary distribution: env var + PATH for v0

The orchestrator locates the lightpanda binary in this order:
1. `LIGHTPANDA_BIN` environment variable, if set, must point to an executable file.
2. `lightpanda` on `PATH` (via `which lightpanda`).
3. If neither found, throw a structured error with a one-line install hint pointing at `docs/quickstart.md`.

No postinstall download. No native packaging. Postinstall + cross-platform tarball publishing is its own milestone (likely M7 launch prep). For v0 dev, contributors download the binary manually per the quickstart docs.

### Decision B — blake3 implementation: `@noble/hashes`

`@noble/hashes` provides `blake3` as a pure-JS function (no native bindings, no postinstall compilation). MIT-licensed. Audited. Used by Solana/Polkadot/Lightning ecosystem clients in production. The performance penalty vs native blake3 is real (~5-10× slower) but per-snapshot we hash maybe 50-200 elements, so total overhead is sub-millisecond. v0.1 can swap to a native implementation if profiling shows it matters.

### Decision C — "xpath" in v0 stable_id is synthetic, not real DOM xpath

Spec §5.1 (amended for v0) says: `stable_id = blake3(role || name_norm || xpath)[:16]`. In v0, `xpath` is *not* a real DOM xpath. It is a **synthetic a11y-tree path** computed orchestrator-side: a slash-separated chain of pruned-sibling indices from the root of our compressed snapshot to the element. This is stable within a single page load (the lifetime in which an agent's actions reference stable_ids) and sufficient for the watchdog's responsibilities. Cross-load stability via real DOM xpath is a v0.1 task — either via `DOM.querySelector`-based lookups or by switching the snapshot pipeline to lightpanda's MCP `semantic_tree` tool which already emits real xpaths.

---

## File Structure

This plan creates one new dependency block in `orchestrator/package.json` and ten new TypeScript files under `orchestrator/src/`, with matching unit tests under `orchestrator/tests/`. The integration test in Task 8 lives under `orchestrator/tests/integration/`. README and quickstart updates land in Task 9.

### New TypeScript source files

| Path | Lines | Responsibility |
|---|---|---|
| `orchestrator/src/engine/binary.ts` | ~80 | Locate the `lightpanda` binary (env var → PATH → throw). |
| `orchestrator/src/engine/lifecycle.ts` | ~150 | Spawn lightpanda as a subprocess on an ephemeral port. Wait for readiness. Kill cleanly. |
| `orchestrator/src/engine/cdp-client.ts` | ~180 | WebSocket + JSON-RPC dispatch. Session attachment. Request/response by id. |
| `orchestrator/src/snapshot/types.ts` | ~70 | Type definitions: `AXNode`, `SnapshotNode`, `Snapshot`, `Diff`. |
| `orchestrator/src/snapshot/passthrough-roles.ts` | ~25 | List of roles that are skipped during tree pruning. |
| `orchestrator/src/snapshot/stable-id.ts` | ~50 | `stableId(role, name, xpath)` using blake3. Name normalization helper. |
| `orchestrator/src/snapshot/adapter.ts` | ~150 | Transform `AXNode` tree → `Snapshot` (spec-§5.2 shape). Compose passthrough pruning + stable IDs + state flags. |
| `orchestrator/src/snapshot/poller.ts` | ~100 | Periodic snapshot fetch + diff. |
| `orchestrator/src/session/session.ts` | ~120 | Compose `lifecycle + cdp-client` into one `Session` object with `goto`, `snapshot`, `close` methods. |
| `orchestrator/src/index.ts` | modify | Add a `husk demo` subcommand that runs end-to-end against a fixture URL and prints the snapshot. |

### New tests

| Path | Covers |
|---|---|
| `orchestrator/tests/engine/binary.test.ts` | env var + PATH resolution, error paths |
| `orchestrator/tests/snapshot/stable-id.test.ts` | hash stability, name normalization |
| `orchestrator/tests/snapshot/adapter.test.ts` | AXNode → Snapshot transformation, passthrough pruning, state flags |
| `orchestrator/tests/snapshot/poller.test.ts` | diff computation against fake snapshot sequences |
| `orchestrator/tests/integration/lightpanda-e2e.test.ts` | end-to-end against real prebuilt binary (skipped if not available) |

### New dependencies in `orchestrator/package.json`

```json
"dependencies": {
  "@noble/hashes": "^1.5.0",
  "ws": "^8.18.0"
},
"devDependencies": {
  "@types/ws": "^8.5.13"
}
```

---

## Tasks

### Task 1: Add runtime dependencies + binary discovery

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/package.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/engine/binary.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/engine/binary.test.ts`

- [ ] **Step 1: Add dependencies to orchestrator/package.json**

Open `/Users/nirmalghinaiya/Desktop/husk/orchestrator/package.json` and add the `dependencies` block (currently it has only `devDependencies`). Resulting file:

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

- [ ] **Step 2: Install + verify**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install
```

Expected: `Done in Xs`. The lockfile is updated. Verify `@noble/hashes` and `ws` are present:

```sh
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/node_modules/@noble/hashes/package.json
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/node_modules/ws/package.json
```

Both should exist.

- [ ] **Step 3: Write the failing test for binary discovery**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/engine/binary.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { locateLightpanda, LightpandaNotFoundError } from "../../src/engine/binary.js";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("locateLightpanda", () => {
  let tmpDir: string;
  let fakeBin: string;
  const originalEnv = process.env.LIGHTPANDA_BIN;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "husk-bin-test-"));
    fakeBin = join(tmpDir, "lightpanda");
    writeFileSync(fakeBin, "#!/bin/sh\necho fake\n");
    chmodSync(fakeBin, 0o755);
  });

  afterEach(() => {
    process.env.LIGHTPANDA_BIN = originalEnv;
    process.env.PATH = originalPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns LIGHTPANDA_BIN when set and executable", async () => {
    process.env.LIGHTPANDA_BIN = fakeBin;
    process.env.PATH = "";
    const found = await locateLightpanda();
    expect(found).toBe(fakeBin);
  });

  it("falls back to PATH when LIGHTPANDA_BIN unset", async () => {
    delete process.env.LIGHTPANDA_BIN;
    process.env.PATH = tmpDir;
    const found = await locateLightpanda();
    expect(found).toBe(fakeBin);
  });

  it("throws LightpandaNotFoundError when neither found", async () => {
    delete process.env.LIGHTPANDA_BIN;
    process.env.PATH = mkdtempSync(join(tmpdir(), "husk-empty-"));
    await expect(locateLightpanda()).rejects.toBeInstanceOf(LightpandaNotFoundError);
  });

  it("throws if LIGHTPANDA_BIN points to a nonexistent path", async () => {
    process.env.LIGHTPANDA_BIN = join(tmpDir, "does-not-exist");
    process.env.PATH = "";
    await expect(locateLightpanda()).rejects.toBeInstanceOf(LightpandaNotFoundError);
  });

  it("throws if LIGHTPANDA_BIN points to a non-executable file", async () => {
    const nonExec = join(tmpDir, "non-exec");
    writeFileSync(nonExec, "");
    chmodSync(nonExec, 0o644);
    process.env.LIGHTPANDA_BIN = nonExec;
    process.env.PATH = "";
    await expect(locateLightpanda()).rejects.toBeInstanceOf(LightpandaNotFoundError);
  });
});
```

- [ ] **Step 4: Run the test, confirm it fails**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/engine/binary.test.ts 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../../src/engine/binary.js'`.

- [ ] **Step 5: Implement binary discovery**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/engine/binary.ts`:

```typescript
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

export class LightpandaNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LightpandaNotFoundError";
  }
}

/**
 * Locate the lightpanda binary on the local filesystem.
 *
 * Resolution order:
 *   1. `LIGHTPANDA_BIN` environment variable, if set, must point to an
 *      executable file.
 *   2. `lightpanda` discovered on `PATH` via directory scan.
 *
 * @throws {LightpandaNotFoundError} if neither path resolves to an
 *   executable. Error message includes the install hint.
 */
export async function locateLightpanda(): Promise<string> {
  const envPath = process.env.LIGHTPANDA_BIN;
  if (envPath) {
    if (await isExecutable(envPath)) return envPath;
    throw new LightpandaNotFoundError(
      `LIGHTPANDA_BIN is set to "${envPath}" but the path is not an executable file. ` +
        `Verify the file exists and has exec permissions, or unset LIGHTPANDA_BIN. ` +
        `See docs/quickstart.md.`
    );
  }

  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, "lightpanda");
    if (await isExecutable(candidate)) return candidate;
  }

  throw new LightpandaNotFoundError(
    `No lightpanda binary found on PATH and LIGHTPANDA_BIN is unset. ` +
      `Download a prebuilt binary from https://github.com/lightpanda-io/browser/releases ` +
      `and either place it on PATH or set LIGHTPANDA_BIN to its absolute location. ` +
      `See docs/quickstart.md.`
  );
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run the test, confirm green**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/engine/binary.test.ts 2>&1 | tail -10
```

Expected: PASS (5 tests).

- [ ] **Step 7: Run the full test suite to confirm no regression**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -10
```

Expected: 8 tests pass (3 from M1 `version.test.ts` + 5 new from `binary.test.ts`).

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/package.json orchestrator/src/engine/binary.ts orchestrator/tests/engine/binary.test.ts pnpm-lock.yaml
git commit -m "feat(orchestrator): add lightpanda binary discovery + deps"
```

---

### Task 2: Subprocess lifecycle manager

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/engine/lifecycle.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/engine/lifecycle.test.ts`

The lifecycle manager spawns `lightpanda serve --host 127.0.0.1 --port <port>`, waits until the CDP HTTP endpoint responds, exposes accessors for the port + CDP base URL, and provides a `close()` that terminates the subprocess cleanly (SIGTERM, then SIGKILL after 5s).

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/engine/lifecycle.test.ts`:

```typescript
import { describe, expect, it, beforeAll } from "vitest";
import { createServer } from "node:http";
import { writeFileSync, chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnLightpanda, type LightpandaProcess } from "../../src/engine/lifecycle.js";

/**
 * Tests use a fake "lightpanda" script that:
 *   - Reads --port flag from argv
 *   - Opens an HTTP server on that port returning [] for /json/list
 *   - Exits when it receives SIGTERM
 * This lets us test the lifecycle manager without needing real lightpanda.
 */
function makeFakeBinary(): string {
  const tmp = mkdtempSync(join(tmpdir(), "husk-lp-fake-"));
  const path = join(tmp, "fake-lightpanda");
  const script = `#!/usr/bin/env node
const port = (process.argv.find(a => a.startsWith("--port=")) || "").split("=")[1] ||
             process.argv[process.argv.indexOf("--port") + 1];
const { createServer } = require("node:http");
const srv = createServer((req, res) => {
  if (req.url === "/json/list") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  } else {
    res.writeHead(404);
    res.end();
  }
});
srv.listen(Number(port), "127.0.0.1");
process.on("SIGTERM", () => { srv.close(); process.exit(0); });
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("spawnLightpanda", () => {
  let fakeBin: string;
  beforeAll(() => {
    fakeBin = makeFakeBinary();
  });

  it("spawns the binary on a discoverable port and reports readiness", async () => {
    const proc = await spawnLightpanda({ binary: fakeBin });
    expect(proc.port).toBeGreaterThan(0);
    expect(proc.cdpBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // Verify the HTTP endpoint really responds
    const res = await fetch(`${proc.cdpBaseUrl}/json/list`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    await proc.close();
  });

  it("close() terminates the subprocess", async () => {
    const proc = await spawnLightpanda({ binary: fakeBin });
    await proc.close();
    // After close, the port should no longer accept connections
    await expect(fetch(`${proc.cdpBaseUrl}/json/list`)).rejects.toThrow();
  });

  it("rejects if readiness times out", async () => {
    // Use /bin/sleep — never opens any port
    await expect(
      spawnLightpanda({ binary: "/bin/sleep", args: ["10"], readinessTimeoutMs: 500 })
    ).rejects.toThrow(/readiness timeout/i);
  });

  it("rejects if the binary exits before readiness", async () => {
    // Use /bin/true — exits immediately
    await expect(spawnLightpanda({ binary: "/bin/true" })).rejects.toThrow(/exited before/i);
  });
});
```

- [ ] **Step 2: Confirm test fails**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/engine/lifecycle.test.ts 2>&1 | tail -10
```

Expected: FAIL — cannot resolve `../../src/engine/lifecycle.js`.

- [ ] **Step 3: Implement the lifecycle manager**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/engine/lifecycle.ts`:

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface LightpandaSpawnOptions {
  /** Absolute path to the lightpanda binary. */
  binary: string;
  /** Extra args passed to the binary instead of the default `serve` flags. Optional override. */
  args?: string[];
  /** Host the binary binds to. Defaults to 127.0.0.1. */
  host?: string;
  /**
   * Port to bind. If omitted, an OS-allocated ephemeral port is used.
   * Note: the binary itself reopens the port, so there is a tiny race
   * window between port discovery and binary startup. Acceptable for
   * dev; v0.3 cloud milestone will use a port broker.
   */
  port?: number;
  /** Maximum wall-clock time to wait for /json/list to respond. Defaults to 10s. */
  readinessTimeoutMs?: number;
  /** Optional stderr/stdout logger. Defaults to no-op. */
  log?: (line: string) => void;
}

export interface LightpandaProcess {
  /** The bound port, useful for the CDP client. */
  port: number;
  /** The base URL of the CDP HTTP endpoint. */
  cdpBaseUrl: string;
  /** The underlying child process (escape hatch for advanced use). */
  child: ChildProcess;
  /** Terminate the subprocess. SIGTERM, then SIGKILL after 5s. */
  close(): Promise<void>;
}

/**
 * Spawn lightpanda as a subprocess in CDP-server mode and wait for it to
 * start serving /json/list.
 *
 * Returns once the readiness probe succeeds, or rejects if the binary
 * exits early / times out / fails to bind.
 */
export async function spawnLightpanda(opts: LightpandaSpawnOptions): Promise<LightpandaProcess> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? (await pickEphemeralPort());
  const readinessTimeoutMs = opts.readinessTimeoutMs ?? 10_000;
  const log = opts.log ?? (() => {});

  const args = opts.args ?? ["serve", "--host", host, "--port", String(port)];

  const child = spawn(opts.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  let exited = false;
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });
  child.stdout?.on("data", (chunk: Buffer) => log(`[lightpanda stdout] ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk: Buffer) => log(`[lightpanda stderr] ${chunk.toString().trimEnd()}`));

  const cdpBaseUrl = `http://${host}:${port}`;
  await waitForReadiness(cdpBaseUrl, readinessTimeoutMs, () => exited, () => exitInfo, child);

  return {
    port,
    cdpBaseUrl,
    child,
    close: () => terminateChild(child),
  };
}

async function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("Failed to pick ephemeral port"));
      }
    });
  });
}

async function waitForReadiness(
  cdpBaseUrl: string,
  timeoutMs: number,
  exited: () => boolean,
  exitInfo: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  child: ChildProcess
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (exited()) {
      const info = exitInfo();
      throw new Error(
        `lightpanda exited before becoming ready (code=${info?.code ?? "?"} signal=${info?.signal ?? "?"})`
      );
    }
    try {
      const res = await fetch(`${cdpBaseUrl}/json/list`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return;
    } catch {
      // Not ready yet — try again
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  // Timed out — best-effort kill and throw
  child.kill("SIGTERM");
  throw new Error(`lightpanda readiness timeout after ${timeoutMs}ms`);
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGTERM");
  const killHard = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 5_000);
  await exited;
  clearTimeout(killHard);
}
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/engine/lifecycle.test.ts 2>&1 | tail -15
```

Expected: PASS (4 tests).

- [ ] **Step 5: Full suite check**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -10
```

Expected: 12 tests pass (3 + 5 + 4).

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/engine/lifecycle.ts orchestrator/tests/engine/lifecycle.test.ts
git commit -m "feat(orchestrator): add lightpanda subprocess lifecycle manager"
```

---

### Task 3: CDP WebSocket client

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/engine/cdp-client.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/engine/cdp-client.test.ts`

CDP client wraps a single WebSocket connection. Each request gets a unique numeric id. Responses are dispatched to pending promises. Target attachment uses `flatten: true` so all session traffic goes over the same socket. The client exposes `.send(method, params, sessionId?)`.

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/engine/cdp-client.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import { CdpClient } from "../../src/engine/cdp-client.js";
import { AddressInfo } from "node:net";

interface MockServer {
  url: string;
  server: WebSocketServer;
  socket: NodeWebSocket | null;
  received: any[];
  close: () => Promise<void>;
}

function startMockCdp(handler: (msg: any) => any | Promise<any>): Promise<MockServer> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const received: any[] = [];
    let socket: NodeWebSocket | null = null;
    server.on("connection", (s) => {
      socket = s;
      s.on("message", async (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        const result = await handler(msg);
        if (result !== undefined) s.send(JSON.stringify(result));
      });
    });
    server.on("listening", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${addr.port}/devtools/page/test`,
        server,
        socket,
        received,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("CdpClient", () => {
  let mock: MockServer;
  let client: CdpClient;

  afterEach(async () => {
    await client?.close();
    await mock?.close();
  });

  it("connects, sends a request, and resolves with the response", async () => {
    mock = await startMockCdp((msg) => ({ id: msg.id, result: { value: 42 } }));
    client = new CdpClient(mock.url);
    await client.ready;
    const result = await client.send("Test.method", { foo: "bar" });
    expect(result).toEqual({ value: 42 });
    expect(mock.received[0]).toMatchObject({ method: "Test.method", params: { foo: "bar" } });
  });

  it("rejects when the server returns a JSON-RPC error", async () => {
    mock = await startMockCdp((msg) => ({
      id: msg.id,
      error: { code: -32000, message: "Server error" },
    }));
    client = new CdpClient(mock.url);
    await client.ready;
    await expect(client.send("Test.broken")).rejects.toThrow(/-32000.*Server error/);
  });

  it("passes sessionId through when provided", async () => {
    mock = await startMockCdp((msg) => ({ id: msg.id, sessionId: msg.sessionId, result: {} }));
    client = new CdpClient(mock.url);
    await client.ready;
    await client.send("Test.method", {}, "session-abc");
    expect(mock.received[0].sessionId).toBe("session-abc");
  });

  it("close() ends the connection", async () => {
    mock = await startMockCdp((msg) => ({ id: msg.id, result: {} }));
    client = new CdpClient(mock.url);
    await client.ready;
    await client.close();
    await expect(client.send("Test.method")).rejects.toThrow();
  });

  it("creates and attaches to a target in one helper call", async () => {
    mock = await startMockCdp((msg) => {
      if (msg.method === "Target.createTarget") {
        return { id: msg.id, result: { targetId: "target-xyz" } };
      }
      if (msg.method === "Target.attachToTarget") {
        return { id: msg.id, result: { sessionId: "session-xyz" } };
      }
      return { id: msg.id, result: {} };
    });
    client = new CdpClient(mock.url);
    await client.ready;
    const sessionId = await client.createAndAttachTarget("about:blank");
    expect(sessionId).toBe("session-xyz");
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/engine/cdp-client.test.ts 2>&1 | tail -10
```

Expected: FAIL — cannot resolve `../../src/engine/cdp-client.js`.

- [ ] **Step 3: Implement CdpClient**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/engine/cdp-client.ts`:

```typescript
import WebSocket from "ws";

export interface CdpErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export class CdpError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(payload: CdpErrorPayload) {
    super(`${payload.code}: ${payload.message}`);
    this.name = "CdpError";
    this.code = payload.code;
    this.data = payload.data;
  }
}

type PendingEntry = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
};

/**
 * Minimal Chrome DevTools Protocol client over a single WebSocket.
 *
 * Uses JSON-RPC 2.0-like envelopes (`{id, method, params, sessionId?}`)
 * matching lightpanda's CDP server. All sessions multiplex over one
 * socket via the `flatten: true` attach pattern.
 */
export class CdpClient {
  private readonly ws: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, PendingEntry>();
  readonly ready: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.on("message", (data: WebSocket.RawData) => this.onMessage(data));
    this.ws.on("close", () => this.onClose());
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (err) => reject(err));
    });
  }

  /**
   * Send a CDP method call and await the response.
   * @param method CDP method name, e.g. `"Page.navigate"`.
   * @param params Method parameters object.
   * @param sessionId Optional session id (omit for browser-level methods).
   */
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CdpClient: socket not open (state=${this.ws.readyState})`));
    }
    const id = ++this.nextId;
    const envelope: Record<string, unknown> = { id, method, params };
    if (sessionId) envelope.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(envelope), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * Convenience helper: create a fresh target for `url` and attach to it
   * with `flatten: true`. Returns the sessionId for subsequent calls.
   */
  async createAndAttachTarget(url: string): Promise<string> {
    const createRes = (await this.send("Target.createTarget", { url })) as { targetId: string };
    const attachRes = (await this.send("Target.attachToTarget", {
      targetId: createRes.targetId,
      flatten: true,
    })) as { sessionId: string };
    return attachRes.sessionId;
  }

  /** Close the underlying socket. Pending requests are rejected. */
  close(): Promise<void> {
    if (
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      return Promise.resolve();
    }
    const closed = new Promise<void>((resolve) => this.ws.once("close", () => resolve()));
    this.ws.close();
    return closed;
  }

  private onMessage(data: WebSocket.RawData): void {
    const text = typeof data === "string" ? data : data.toString();
    let msg: { id?: number; result?: unknown; error?: CdpErrorPayload };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id == null) return; // event notification — ignored in v0
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.error) entry.reject(new CdpError(msg.error));
    else entry.resolve(msg.result ?? null);
  }

  private onClose(): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error("CdpClient: connection closed"));
    }
    this.pending.clear();
  }
}
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/engine/cdp-client.test.ts 2>&1 | tail -15
```

Expected: PASS (5 tests).

- [ ] **Step 5: Full suite check**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 17 tests pass (3 + 5 + 4 + 5).

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/engine/cdp-client.ts orchestrator/tests/engine/cdp-client.test.ts
git commit -m "feat(orchestrator): add CDP WebSocket client with target-attach helper"
```

---

### Task 4: Snapshot types + passthrough role list

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/types.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/passthrough-roles.ts`

These two files have no test of their own (they're type-only / constant-only) but they're consumed by Tasks 5-7 which test against them.

- [ ] **Step 1: Create the types file**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/types.ts`:

```typescript
/**
 * Snapshot type definitions for Husk's spec-§5.2 representation.
 *
 * We have three layers:
 *   - `AXNode` — what lightpanda's `Accessibility.getFullAXTree` emits (raw CDP shape)
 *   - `SnapshotNode` — what we emit to agents (compressed JSON-LD with short keys)
 *   - `Snapshot` — the top-level envelope (root node + metadata)
 */

// ----- Raw CDP a11y tree shape -----

/** A CDP-style typed value, e.g. `{ type: "string", value: "Submit" }`. */
export interface CdpTypedValue {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export interface AXNodeProperty {
  name: string;
  value: CdpTypedValue;
}

/** A single accessibility-tree node as emitted by CDP. */
export interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: CdpTypedValue;
  name?: CdpTypedValue;
  description?: CdpTypedValue;
  value?: CdpTypedValue;
  properties?: AXNodeProperty[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

// ----- Husk's compressed snapshot shape (spec §5.2) -----

/** State flags compressed to single letters: `e`=enabled, `v`=visible, `c`=checked, `f`=focused, `d`=disabled. */
export type SnapshotStateFlag = "e" | "v" | "c" | "f" | "d";

/** A single node in our compressed JSON-LD snapshot tree. */
export interface SnapshotNode {
  /** Stable ID — blake3(role || name_norm || xpath)[:16] (URL-safe base64, 22 chars no padding). */
  i: string;
  /** ARIA role. */
  r: string;
  /** Accessible name (raw, not normalized). */
  n: string;
  /** State flags. */
  s: SnapshotStateFlag[];
  /** Optional raw text content (only for `r === "text"` nodes). */
  t?: string;
  /** Children. */
  c?: SnapshotNode[];
}

export interface Snapshot {
  /** Snapshot format version (spec §5.2 reserves 0 for stub, 1 for v0). */
  v: 1;
  /** URL of the page snapshotted. */
  url: string;
  /** Total number of nodes after pruning. */
  count: number;
  /** Root of the snapshot tree. */
  root: SnapshotNode;
}

// ----- Diff types for mutation poller (Task 6) -----

export interface SnapshotDiff {
  added: SnapshotNode[];
  removed: string[]; // stable_ids no longer present
  changed: Array<{ id: string; before: SnapshotNode; after: SnapshotNode }>;
}
```

- [ ] **Step 2: Create the passthrough-roles file**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/passthrough-roles.ts`:

```typescript
/**
 * Roles whose nodes are *skipped through* during snapshot tree pruning.
 *
 * The pruner walks the AXNode tree; when it hits a passthrough role, it
 * descends into the node's children but does NOT emit a SnapshotNode for
 * the passthrough node itself. The children become direct children of
 * the passthrough's parent in the output tree.
 *
 * Sourced from the T7 spike PoC findings (M2 spike, 2026-05-14):
 *   - `none` and `generic`: AX equivalents of layout-only divs/spans
 *   - `StaticText` and `InlineTextBox`: text leaves that bubble up to
 *     their parent's name
 *
 * Adding more roles here is a v0.1 tuning concern.
 */
export const PASSTHROUGH_ROLES: ReadonlySet<string> = new Set([
  "none",
  "generic",
  "StaticText",
  "InlineTextBox",
]);

export function isPassthroughRole(role: string | undefined): boolean {
  return role !== undefined && PASSTHROUGH_ROLES.has(role);
}
```

- [ ] **Step 3: Typecheck**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/snapshot/types.ts orchestrator/src/snapshot/passthrough-roles.ts
git commit -m "feat(orchestrator): add snapshot type definitions + passthrough role list"
```

---

### Task 5: Stable-ID computation

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/stable-id.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/snapshot/stable-id.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/snapshot/stable-id.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { stableId, normalizeName } from "../../src/snapshot/stable-id.js";

describe("normalizeName", () => {
  it("lowercases input", () => {
    expect(normalizeName("Submit Application")).toBe("submit application");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeName("   hello   ")).toBe("hello");
  });

  it("collapses internal whitespace runs to single spaces", () => {
    expect(normalizeName("foo   bar\t\nbaz")).toBe("foo bar baz");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeName("   \t\n")).toBe("");
  });

  it("handles empty input", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("stableId", () => {
  it("returns a 22-character URL-safe base64 string with role prefix", () => {
    const id = stableId("button", "Submit", "/main/form/[0]");
    expect(id).toMatch(/^button:[A-Za-z0-9_-]{22}$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "Submit", "/main/form/[0]");
    expect(a).toBe(b);
  });

  it("changes when role changes", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("link", "Submit", "/main/form/[0]");
    expect(a).not.toBe(b);
  });

  it("changes when name changes (after normalization)", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "Cancel", "/main/form/[0]");
    expect(a).not.toBe(b);
  });

  it("does NOT change when name differs only in case/whitespace (normalization)", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "  SUBMIT  ", "/main/form/[0]");
    expect(a).toBe(b);
  });

  it("changes when xpath changes", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "Submit", "/main/form/[1]");
    expect(a).not.toBe(b);
  });

  it("hash portion does not contain unsafe URL characters (no +, /, =)", () => {
    const id = stableId("button", "Submit", "/main/form/[0]");
    const hash = id.split(":")[1];
    expect(hash).not.toMatch(/[+/=]/);
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/snapshot/stable-id.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/stable-id.ts`:

```typescript
import { blake3 } from "@noble/hashes/blake3";

/**
 * Normalize an accessible name for stable-ID hashing:
 *   1. Lowercase
 *   2. Trim leading/trailing whitespace
 *   3. Collapse internal whitespace runs to single spaces
 */
export function normalizeName(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Compute a Husk v0 stable ID:
 *
 *   stable_id = `${role}:${base64url(blake3(role ‖ '\0' ‖ name_norm ‖ '\0' ‖ xpath)[:16])}`
 *
 * The `role:` prefix is for human readability in logs / agent error
 * messages. The hash is 16 bytes (128 bits) of blake3 output, encoded
 * as URL-safe base64 without padding (22 characters).
 *
 * @param role   CDP-emitted ARIA role (e.g. "button", "textbox")
 * @param name   Raw accessible name (we normalize internally)
 * @param xpath  Synthetic a11y-tree path (for v0; real DOM xpath comes in v0.1)
 */
export function stableId(role: string, name: string, xpath: string): string {
  const nameNorm = normalizeName(name);
  const input = new TextEncoder().encode(`${role} ${nameNorm} ${xpath}`);
  const hashBytes = blake3(input, { dkLen: 16 });
  const hash = bytesToBase64Url(hashBytes);
  return `${role}:${hash}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // Buffer is always available in Node 20+; toString('base64url') gives
  // us the URL-safe variant with no padding.
  return Buffer.from(bytes).toString("base64url");
}
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/snapshot/stable-id.test.ts 2>&1 | tail -15
```

Expected: PASS (12 tests — 5 in `normalizeName`, 7 in `stableId`).

- [ ] **Step 5: Full suite check**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 29 tests pass.

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/snapshot/stable-id.ts orchestrator/tests/snapshot/stable-id.test.ts
git commit -m "feat(orchestrator): add blake3 stable-id computation for v0"
```

---

### Task 6: Snapshot adapter (AXTree → JSON-LD)

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/adapter.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/snapshot/adapter.test.ts`

This is where the spec §5.2 transformation lives. Reads an `AXNode` tree, prunes passthrough roles, computes stable IDs per surviving node, packs into spec-§5.2 `SnapshotNode` shape with state flags. Produces a `Snapshot` envelope.

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/snapshot/adapter.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { transformAxTree } from "../../src/snapshot/adapter.js";
import type { AXNode } from "../../src/snapshot/types.js";

function ax(
  nodeId: string,
  role: string,
  name: string,
  childIds: string[] = [],
  properties: AXNode["properties"] = []
): AXNode {
  return {
    nodeId,
    ignored: false,
    role: { type: "internalRole", value: role },
    name: { type: "computedString", value: name },
    childIds,
    properties,
  };
}

function tree(...nodes: AXNode[]): AXNode[] {
  return nodes;
}

describe("transformAxTree", () => {
  it("emits a Snapshot with v=1 and the supplied URL", () => {
    const nodes = tree(ax("1", "RootWebArea", "Page"));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.v).toBe(1);
    expect(snap.url).toBe("https://example.com");
    expect(snap.count).toBe(1);
    expect(snap.root.r).toBe("RootWebArea");
  });

  it("assigns short-key fields per spec §5.2", () => {
    const nodes = tree(ax("1", "button", "Submit"));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root).toMatchObject({
      r: "button",
      n: "Submit",
    });
    expect(snap.root.i).toMatch(/^button:[A-Za-z0-9_-]{22}$/);
    expect(snap.root.s).toContain("e"); // enabled by default
  });

  it("skip-through prunes passthrough roles (generic, none, StaticText, InlineTextBox)", () => {
    const nodes = tree(
      ax("1", "main", "Main", ["2", "3"]),
      ax("2", "generic", "wrapper", ["4"]),
      ax("3", "StaticText", "loose text"),
      ax("4", "button", "Submit")
    );
    const snap = transformAxTree(nodes, "1", "https://example.com");
    // Root is 'main', its direct children should be 'button' (skipping 'generic'),
    // and StaticText / loose text should be skipped entirely.
    expect(snap.root.r).toBe("main");
    const children = snap.root.c ?? [];
    expect(children.length).toBe(1);
    expect(children[0].r).toBe("button");
    expect(snap.count).toBe(2); // main + button
  });

  it("computes the disabled state from the absence of `focusable` property", () => {
    // Per the T7 spike finding: a button without `focusable` is considered disabled.
    const nodes = tree(ax("1", "button", "Disabled", [], [
      // no focusable property
    ]));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root.s).toContain("d");
    expect(snap.root.s).not.toContain("e");
  });

  it("sets enabled flag when `focusable` is true on a button", () => {
    const nodes = tree(ax("1", "button", "Submit", [], [
      { name: "focusable", value: { type: "booleanOrUndefined", value: true } },
    ]));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root.s).toContain("e");
    expect(snap.root.s).not.toContain("d");
  });

  it("sets checked flag for checkboxes when `checked` property is true", () => {
    const nodes = tree(ax("1", "checkbox", "Agree", [], [
      { name: "focusable", value: { type: "booleanOrUndefined", value: true } },
      { name: "checked", value: { type: "tristate", value: true } },
    ]));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root.s).toContain("c");
    expect(snap.root.s).toContain("e");
  });

  it("assigns identical stable_ids to identical (role, name, position) tuples", () => {
    const nodes = tree(ax("1", "RootWebArea", "", ["2"]), ax("2", "button", "Submit"));
    const a = transformAxTree(nodes, "1", "https://example.com");
    const b = transformAxTree(nodes, "1", "https://example.com");
    expect(a.root.c?.[0].i).toBe(b.root.c?.[0].i);
  });

  it("assigns different stable_ids to two same-role-same-name buttons at different positions", () => {
    const nodes = tree(
      ax("1", "RootWebArea", "", ["2", "3"]),
      ax("2", "button", "Submit"),
      ax("3", "button", "Submit")
    );
    const snap = transformAxTree(nodes, "1", "https://example.com");
    const [a, b] = snap.root.c ?? [];
    expect(a.i).not.toBe(b.i); // different xpath positions disambiguate
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/snapshot/adapter.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/adapter.ts`:

```typescript
import type { AXNode, AXNodeProperty, Snapshot, SnapshotNode, SnapshotStateFlag } from "./types.js";
import { isPassthroughRole } from "./passthrough-roles.js";
import { stableId } from "./stable-id.js";

/**
 * Transform an `Accessibility.getFullAXTree` response into a spec-§5.2
 * compressed JSON-LD `Snapshot`.
 *
 * Pruning: nodes with passthrough roles (see `passthrough-roles.ts`) are
 * skipped — their children are reparented to the closest non-passthrough
 * ancestor in the output tree.
 *
 * Stable ID: each surviving node gets a `stable_id` computed from
 * (role, accessible_name, xpath), where `xpath` is a synthetic
 * a11y-tree path of the form `/parent/[idx]` joined.
 *
 * State flags follow the T7 spike findings:
 *   - `e` (enabled) — when `focusable` property exists and is `true`
 *   - `d` (disabled) — when `focusable` is absent on an interactive role
 *   - `c` (checked) — when `checked` property is `true`
 *   - `f` (focused) — when `focused` property is `true`
 *   - `v` (visible) — always set for now; visibility comes from CDP DOM in v0.1
 */
export function transformAxTree(nodes: AXNode[], rootId: string, url: string): Snapshot {
  const byId = new Map<string, AXNode>();
  for (const n of nodes) byId.set(n.nodeId, n);
  const root = byId.get(rootId);
  if (!root) throw new Error(`transformAxTree: root id "${rootId}" not present in nodes`);

  let count = 0;
  const visit = (node: AXNode, parentXpath: string, indexInParent: number): SnapshotNode | SnapshotNode[] => {
    const role = node.role?.value ?? "generic";
    // For passthrough nodes: emit their children flattened into our parent's child list.
    if (isPassthroughRole(role)) {
      const childNodes = (node.childIds ?? [])
        .map((cid, i) => {
          const child = byId.get(cid);
          if (!child || child.ignored) return null;
          return visit(child, parentXpath, indexInParent + i);
        })
        .filter((x): x is SnapshotNode | SnapshotNode[] => x != null)
        .flat();
      return childNodes;
    }

    const xpath = `${parentXpath}/[${indexInParent}]`;
    const name = node.name?.value ?? "";
    const id = stableId(role, name, xpath);

    const flags = computeStateFlags(role, node.properties ?? []);

    const out: SnapshotNode = { i: id, r: role, n: name, s: flags };

    const children: SnapshotNode[] = [];
    let childIdx = 0;
    for (const cid of node.childIds ?? []) {
      const child = byId.get(cid);
      if (!child || child.ignored) continue;
      const transformed = visit(child, xpath, childIdx);
      if (Array.isArray(transformed)) {
        children.push(...transformed);
        childIdx += transformed.length;
      } else {
        children.push(transformed);
        childIdx += 1;
      }
    }
    if (children.length) out.c = children;

    count += 1;
    return out;
  };

  const result = visit(root, "", 0);
  // The root cannot be a passthrough role (it should always be RootWebArea
  // or similar); if it somehow is, surface that explicitly.
  if (Array.isArray(result)) {
    throw new Error("transformAxTree: root resolved to passthrough nodes only");
  }
  return { v: 1, url, count, root: result };
}

function computeStateFlags(role: string, properties: AXNodeProperty[]): SnapshotStateFlag[] {
  const flags: SnapshotStateFlag[] = [];
  flags.push("v"); // visibility default-true; v0.1 wires real CDP visibility

  const focusable = properties.find((p) => p.name === "focusable")?.value?.value;
  const checked = properties.find((p) => p.name === "checked")?.value?.value;
  const focused = properties.find((p) => p.name === "focused")?.value?.value;

  if (isInteractiveRole(role)) {
    if (focusable === true) flags.push("e");
    else flags.push("d");
  } else {
    flags.push("e");
  }
  if (checked === true) flags.push("c");
  if (focused === true) flags.push("f");
  return flags;
}

function isInteractiveRole(role: string): boolean {
  return (
    role === "button" ||
    role === "link" ||
    role === "textbox" ||
    role === "combobox" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "menuitem" ||
    role === "tab" ||
    role === "option" ||
    role === "switch" ||
    role === "slider"
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/snapshot/adapter.test.ts 2>&1 | tail -15
```

Expected: PASS (8 tests).

- [ ] **Step 5: Full suite check**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 37 tests pass.

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/snapshot/adapter.ts orchestrator/tests/snapshot/adapter.test.ts
git commit -m "feat(orchestrator): snapshot adapter — AXTree to spec-§5.2 JSON-LD"
```

---

### Task 7: Mutation poller

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/poller.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/snapshot/poller.test.ts`

The poller doesn't actually fetch from CDP — it accepts a `getSnapshot` callback and produces diffs. This keeps it testable without spawning lightpanda. The integration layer (Task 9) wires it to the real fetch.

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/snapshot/poller.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../../src/snapshot/poller.js";
import type { Snapshot, SnapshotNode } from "../../src/snapshot/types.js";

function snap(root: SnapshotNode, url = "https://example.com"): Snapshot {
  return { v: 1, url, count: countNodes(root), root };
}

function countNodes(n: SnapshotNode): number {
  return 1 + (n.c ?? []).reduce((s, c) => s + countNodes(c), 0);
}

function node(id: string, role = "button", name = "x", children: SnapshotNode[] = []): SnapshotNode {
  return { i: id, r: role, n: name, s: ["e", "v"], c: children.length ? children : undefined };
}

describe("diffSnapshots", () => {
  it("returns empty diff for identical snapshots", () => {
    const s = snap(node("a:1", "main", "M", [node("b:2"), node("b:3")]));
    const diff = diffSnapshots(s, s);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("detects an added node", () => {
    const before = snap(node("a:1", "main", "M", [node("b:2")]));
    const after = snap(node("a:1", "main", "M", [node("b:2"), node("b:3")]));
    const diff = diffSnapshots(before, after);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].i).toBe("b:3");
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("detects a removed node by stable_id", () => {
    const before = snap(node("a:1", "main", "M", [node("b:2"), node("b:3")]));
    const after = snap(node("a:1", "main", "M", [node("b:2")]));
    const diff = diffSnapshots(before, after);
    expect(diff.removed).toEqual(["b:3"]);
  });

  it("detects a changed node when state flags differ", () => {
    const before = snap(node("a:1", "main", "M", [{ i: "b:2", r: "button", n: "Submit", s: ["e", "v"] }]));
    const after = snap(node("a:1", "main", "M", [{ i: "b:2", r: "button", n: "Submit", s: ["d", "v"] }]));
    const diff = diffSnapshots(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].id).toBe("b:2");
    expect(diff.changed[0].before.s).toEqual(["e", "v"]);
    expect(diff.changed[0].after.s).toEqual(["d", "v"]);
  });

  it("detects a name change as a removal+addition (because stable_id changes)", () => {
    const before = snap(node("a:1", "main", "M", [{ i: "b:2", r: "button", n: "Old", s: ["e"] }]));
    const after = snap(node("a:1", "main", "M", [{ i: "b:3", r: "button", n: "New", s: ["e"] }]));
    const diff = diffSnapshots(before, after);
    expect(diff.removed).toContain("b:2");
    expect(diff.added.map((n) => n.i)).toContain("b:3");
    expect(diff.changed).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/snapshot/poller.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/snapshot/poller.ts`:

```typescript
import type { Snapshot, SnapshotDiff, SnapshotNode } from "./types.js";

/**
 * Compute a flat diff between two snapshots.
 *
 * The shape:
 *   - added: nodes present in `after` but not `before` (by stable_id)
 *   - removed: stable_ids present in `before` but not `after`
 *   - changed: stable_ids in both, where the node payload differs (e.g.
 *     state flags flipped, name changed without changing stable_id)
 *
 * Note: when an element's accessible name or role changes such that its
 * stable_id also changes, it appears as both a `removed` (old id) and
 * `added` (new id). The diff has no way to know they're the "same"
 * element. Agents that need cross-id linking can use position-based
 * heuristics on top of this output.
 *
 * Cost: O(N) on the size of the new snapshot, plus O(N) on the size of
 * the old. Trees are walked once each, indexed into Maps.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeMap = flatten(before.root);
  const afterMap = flatten(after.root);

  const added: SnapshotNode[] = [];
  const removed: string[] = [];
  const changed: SnapshotDiff["changed"] = [];

  for (const [id, n] of afterMap) {
    const prior = beforeMap.get(id);
    if (!prior) {
      added.push(n);
    } else if (!nodesEqual(prior, n)) {
      changed.push({ id, before: prior, after: n });
    }
  }
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) removed.push(id);
  }

  return { added, removed, changed };
}

function flatten(root: SnapshotNode): Map<string, SnapshotNode> {
  const out = new Map<string, SnapshotNode>();
  const walk = (n: SnapshotNode): void => {
    out.set(n.i, n);
    for (const c of n.c ?? []) walk(c);
  };
  walk(root);
  return out;
}

function nodesEqual(a: SnapshotNode, b: SnapshotNode): boolean {
  // Compare scalar fields. We do NOT compare children: a parent's payload
  // doesn't change just because a grandchild was added — that's captured
  // separately as the grandchild's add/remove.
  if (a.r !== b.r) return false;
  if (a.n !== b.n) return false;
  if (a.t !== b.t) return false;
  if (!sameFlags(a.s, b.s)) return false;
  return true;
}

function sameFlags(a: SnapshotNode["s"], b: SnapshotNode["s"]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const f of b) if (!setA.has(f)) return false;
  return true;
}
```

- [ ] **Step 4: Confirm tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/snapshot/poller.test.ts 2>&1 | tail -15
```

Expected: PASS (5 tests).

- [ ] **Step 5: Full suite check**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 42 tests pass.

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/snapshot/poller.ts orchestrator/tests/snapshot/poller.test.ts
git commit -m "feat(orchestrator): snapshot diff/poller logic"
```

---

### Task 8: Session — compose lifecycle + cdp-client + adapter

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/session/session.ts`

This composes the pieces from Tasks 2-7 into a `Session` class that callers (Task 9's `husk demo` CLI, and M3's HTTP API later) use. No unit test for the composition — it's exercised by Task 9's integration test.

- [ ] **Step 1: Implement Session**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/session/session.ts`:

```typescript
import { spawnLightpanda, type LightpandaProcess } from "../engine/lifecycle.js";
import { CdpClient } from "../engine/cdp-client.js";
import { transformAxTree } from "../snapshot/adapter.js";
import { diffSnapshots } from "../snapshot/poller.js";
import type { AXNode, Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { locateLightpanda } from "../engine/binary.js";

export interface SessionOptions {
  /** Override binary path. Defaults to LIGHTPANDA_BIN env / PATH discovery. */
  binary?: string;
  /** Pass through to lifecycle manager. */
  readinessTimeoutMs?: number;
  /** Logger for engine stderr/stdout. Defaults to no-op. */
  log?: (line: string) => void;
}

/**
 * High-level Husk session.
 *
 * Lifecycle:
 *   1. `Session.create(opts)` — spawns lightpanda, opens a CDP WebSocket,
 *      creates and attaches to a fresh target. Returns a ready session.
 *   2. `session.goto(url)` — navigates the target.
 *   3. `session.snapshot()` — returns a spec-§5.2 `Snapshot`.
 *   4. `session.snapshotDiff()` — returns a `SnapshotDiff` vs the prior snapshot,
 *      or `null` if there is no prior. The current snapshot becomes the new baseline.
 *   5. `session.close()` — disconnects and kills the subprocess.
 */
export class Session {
  private constructor(
    private readonly engine: LightpandaProcess,
    private readonly cdp: CdpClient,
    private readonly sessionId: string,
    private currentUrl: string,
    private lastSnapshot: Snapshot | null = null
  ) {}

  static async create(opts: SessionOptions = {}): Promise<Session> {
    const binary = opts.binary ?? (await locateLightpanda());
    const engine = await spawnLightpanda({
      binary,
      readinessTimeoutMs: opts.readinessTimeoutMs,
      log: opts.log,
    });

    // Discover the CDP WebSocket via /json/list and open a connection.
    const listRes = await fetch(`${engine.cdpBaseUrl}/json/list`);
    const targets = (await listRes.json()) as Array<{ webSocketDebuggerUrl?: string }>;
    if (!targets[0]?.webSocketDebuggerUrl) {
      await engine.close();
      throw new Error("Session.create: lightpanda /json/list returned no usable target");
    }
    const cdp = new CdpClient(targets[0].webSocketDebuggerUrl);
    await cdp.ready;

    // Create a fresh target and attach to it (sessionId for subsequent calls).
    const sessionId = await cdp.createAndAttachTarget("about:blank");
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Accessibility.enable", {}, sessionId);

    return new Session(engine, cdp, sessionId, "about:blank");
  }

  async goto(url: string): Promise<void> {
    await this.cdp.send("Page.navigate", { url }, this.sessionId);
    this.currentUrl = url;
    // Crude wait — sufficient for v0. M5 will hook Page.loadEventFired.
    await new Promise((r) => setTimeout(r, 1000));
  }

  async snapshot(): Promise<Snapshot> {
    const tree = (await this.cdp.send(
      "Accessibility.getFullAXTree",
      {},
      this.sessionId
    )) as { nodes: AXNode[] };
    const root = tree.nodes.find((n) => !n.parentId) ?? tree.nodes[0];
    if (!root) throw new Error("snapshot: Accessibility.getFullAXTree returned no nodes");
    const snap = transformAxTree(tree.nodes, root.nodeId, this.currentUrl);
    this.lastSnapshot = snap;
    return snap;
  }

  async snapshotDiff(): Promise<SnapshotDiff | null> {
    const prior = this.lastSnapshot;
    const current = await this.snapshot();
    if (!prior) return null;
    return diffSnapshots(prior, current);
  }

  async close(): Promise<void> {
    await this.cdp.close();
    await this.engine.close();
  }
}
```

- [ ] **Step 2: Typecheck**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/session/session.ts
git commit -m "feat(orchestrator): Session — composes lifecycle + CDP + adapter"
```

---

### Task 9: Integration test against real lightpanda + `husk demo` CLI

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/lightpanda-e2e.test.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/fixture-server.ts`
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/index.ts` (add `husk demo` subcommand)
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/vitest.config.ts` (add integration test pattern)

The integration test spawns a small in-process HTTP server (the fixture), creates a `Session` pointed at it, asserts the snapshot has the expected structure, and tears down.

If the real `lightpanda` binary isn't available (no `LIGHTPANDA_BIN`, no PATH hit), the test is **skipped** gracefully — this lets CI on machines without lightpanda still pass the rest of the suite.

- [ ] **Step 1: Add the fixture server helper**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/fixture-server.ts`:

```typescript
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-process HTTP server that serves a single fixture page on /.
 * Required because lightpanda doesn't accept file:// URLs (per T7 spike finding).
 */
export const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Husk M2 E2E Fixture</title></head>
<body>
  <main role="main">
    <h1>Hello Husk</h1>
    <button type="submit">Submit Application</button>
    <button type="button" disabled>Disabled Button</button>
    <label><input type="checkbox" id="agree"> I agree</label>
  </main>
</body>
</html>`;

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
```

- [ ] **Step 2: Add the integration test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/lightpanda-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { Session } from "../../src/session/session.js";
import { startFixtureServer } from "./fixture-server.js";
import { locateLightpanda } from "../../src/engine/binary.js";

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

integrationOrSkip("end-to-end with prebuilt lightpanda", () => {
  it("produces a valid spec-§5.2 snapshot of the fixture page", async () => {
    const fixture = await startFixtureServer();
    let session: Session | undefined;
    try {
      session = await Session.create({ readinessTimeoutMs: 15_000 });
      await session.goto(fixture.url);
      const snap = await session.snapshot();
      expect(snap.v).toBe(1);
      expect(snap.url).toBe(fixture.url);
      expect(snap.count).toBeGreaterThan(0);
      // The fixture has a "Submit Application" button. Walk the tree to find it.
      const found = findById(snap.root, (n) => n.r === "button" && n.n.includes("Submit"));
      expect(found).toBeTruthy();
    } finally {
      await session?.close();
      await fixture.close();
    }
  }, 30_000);
});

function findById(
  node: import("../../src/snapshot/types.js").SnapshotNode,
  pred: (n: import("../../src/snapshot/types.js").SnapshotNode) => boolean
): import("../../src/snapshot/types.js").SnapshotNode | null {
  if (pred(node)) return node;
  for (const c of node.c ?? []) {
    const r = findById(c, pred);
    if (r) return r;
  }
  return null;
}
```

- [ ] **Step 3: Update vitest config to include integration tests**

Edit `/Users/nirmalghinaiya/Desktop/husk/orchestrator/vitest.config.ts` to add the integration include pattern:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000, // integration tests need headroom
  },
});
```

- [ ] **Step 4: Add `husk demo` subcommand to index.ts**

Replace the contents of `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/index.ts` with:

```typescript
#!/usr/bin/env node
import { getVersion } from "./version.js";
import { Session } from "./session/session.js";

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
  case "help":
  case "--help":
  case "-h":
    console.log(`husk v${getVersion()}

Usage:
  husk version            Print version
  husk help               Print this help
  husk demo <url>         Drive lightpanda against URL and print the spec-§5.2 snapshot

Coming in later milestones:
  husk start              Start the orchestrator (M3)
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
```

- [ ] **Step 5: Build + typecheck**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm build 2>&1 | tail -5
```

Expected: no compilation errors.

- [ ] **Step 6: Run all tests (integration will skip if no lightpanda binary)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -15
```

Expected: at least 42 unit tests pass. The integration test either passes (if lightpanda binary discoverable) or is skipped.

- [ ] **Step 7: Manually run the demo against a public site (if lightpanda is on PATH)**

If `lightpanda` is available locally (via the spike's prebuilt at `engine/spike/.scratch/lightpanda` or installed globally):

```sh
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  node /Users/nirmalghinaiya/Desktop/husk/orchestrator/dist/index.js demo https://example.com 2>&1 | tail -50
```

You should see a JSON snapshot printed. If the binary isn't around, skip this step — it's just demonstration polish, not a DoD requirement.

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/tests/integration/ orchestrator/src/index.ts orchestrator/vitest.config.ts
git commit -m "feat(orchestrator): husk demo CLI + lightpanda integration test"
```

---

### Task 10: Documentation updates + end-to-end smoke

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/README.md`
- Modify: `/Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md`

The spec amendment (already committed in `b2c32db`) shifted v0 to "consume prebuilt lightpanda binary." The user-facing docs need to catch up with that pivot.

- [ ] **Step 1: Update README's "What's Shipping in v0" table**

Open `/Users/nirmalghinaiya/Desktop/husk/README.md`. Replace the existing `## What's Shipping in v0` table with this updated version:

```markdown
## What's Shipping in v0

| Pillar | v0 status |
|---|---|
| Browser runtime (consumes prebuilt lightpanda binary) | ✅ |
| Snapshot compression (a11y-tree-based JSON-LD with full text preserved) | ✅ |
| Watchdog (sanity + policy, deterministic, no LLM) | ✅ |
| TypeScript SDK + Python SDK | ✅ |
| MCP server (Claude Desktop / Cursor / Continue / Windsurf) | ✅ |
| CLI | ✅ |
| Auth pillar (cookies / SSO / MFA) | v0.2 |
| DOM-drift router (cross-deploy resolver) | v0.1 |
| Cloud-hosted Husk | v0.3 |
| WebGL / WebRTC / WebAssembly / Gmail / Salesforce | inherited limitation |
| IndexedDB (affects Firebase Auth, Auth0 SPA, AWS Amplify) | inherited limitation; flagged in v0.2 |
```

(The change is one row: "Browser runtime (forked lightpanda)" → "Browser runtime (consumes prebuilt lightpanda binary)", plus a new row for IndexedDB per the M2 spike's v0.2 risk flag.)

- [ ] **Step 2: Replace the Quickstart section in the README**

Find the `## Quickstart` section in the README. Replace its existing shell block with this updated version (using triple-backticks in the actual file):

```sh
# Prerequisites: Node 20, pnpm 9, Python 3.11+
git clone https://github.com/NGHINAI/Husk
cd Husk

# Install lightpanda binary (M2: consume prebuilt; no Zig build needed for v0)
mkdir -p ~/.husk/bin
curl -fsSL -o ~/.husk/bin/lightpanda \
  https://github.com/lightpanda-io/browser/releases/download/0.3.0/lightpanda-$(uname -m | sed 's/x86_64/x86_64/;s/arm64/aarch64/')-$(uname -s | tr A-Z a-z)
chmod +x ~/.husk/bin/lightpanda
export LIGHTPANDA_BIN=~/.husk/bin/lightpanda

# Build husk
pnpm install
make all

# Smoke test
make test

# Demo: drive lightpanda end-to-end
node ./orchestrator/dist/index.js demo https://example.com | head -50
```

- [ ] **Step 3: Replace the `docs/quickstart.md` body with a more thorough M2 version**

Replace the contents of `/Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md` with:

```markdown
# Husk Quickstart

This guide gets you to a working `husk demo` invocation against a real
URL using the prebuilt lightpanda binary.

## Prerequisites

- Node 20 LTS
- pnpm 9
- Python 3.11+
- A prebuilt `lightpanda` binary (see "Install lightpanda" below). Zig is
  NOT required for v0; the engine is consumed as a prebuilt binary.

## Install lightpanda

Download the prebuilt binary for your platform from
https://github.com/lightpanda-io/browser/releases (latest at time of
writing: `0.3.0`):

```sh
# Pick the asset that matches your platform:
#   - lightpanda-aarch64-macos   (Apple Silicon)
#   - lightpanda-x86_64-macos    (Intel Mac)
#   - lightpanda-aarch64-linux
#   - lightpanda-x86_64-linux
mkdir -p ~/.husk/bin
ASSET="lightpanda-$(uname -m | sed 's/x86_64/x86_64/;s/arm64/aarch64/')-$(uname -s | tr A-Z a-z)"
curl -fsSL -o ~/.husk/bin/lightpanda \
  "https://github.com/lightpanda-io/browser/releases/download/0.3.0/$ASSET"
chmod +x ~/.husk/bin/lightpanda
```

Either add `~/.husk/bin` to your `PATH` or export `LIGHTPANDA_BIN`:

```sh
export LIGHTPANDA_BIN=~/.husk/bin/lightpanda
```

Verify:

```sh
$LIGHTPANDA_BIN --version
```

## Build Husk

```sh
git clone https://github.com/NGHINAI/Husk
cd Husk
pnpm install
make all
```

## Verify

```sh
make test                  # runs all package tests
./orchestrator/dist/index.js version   # should print: husk v0.0.0
```

## Demo

The `husk demo` subcommand drives lightpanda against any URL and prints
the resulting spec-§5.2 snapshot:

```sh
node ./orchestrator/dist/index.js demo https://example.com | head -40
```

Output is a JSON tree of pruned, stable-id-tagged accessibility nodes —
this is what your AI agent will consume in production.

## Known limitations (v0)

- `file://` URLs are not supported by lightpanda. Use HTTP/HTTPS or
  start a local server (`python3 -m http.server`) and point at it.
- Sites requiring IndexedDB will fail (Firebase Auth, Auth0 SPA SDK,
  AWS Amplify). Tracked for v0.2.
- Sites that depend on WebGL, WebRTC, or WebAssembly will not render.
  Tracked for v2.0 (hybrid engine with stripped Chromium fallback).

## Next

- [Architecture overview](./architecture.md)
- [Full design spec](./superpowers/specs/2026-05-13-husk-design.md)
- [Contributing guide](../CONTRIBUTING.md)
- [M2 spike findings](./superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md)
```

- [ ] **Step 4: Verify the doc changes**

```sh
grep -q "consume prebuilt lightpanda binary" /Users/nirmalghinaiya/Desktop/husk/README.md && echo OK
grep -q "lightpanda is NOT required" /Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md && echo OK
```

Both should print `OK`. If they don't, re-read the file and confirm the edits stuck.

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add README.md docs/quickstart.md
git commit -m "docs: update README + quickstart for v0 prebuilt-lightpanda flow"
```

---

### Task 11: End-to-end smoke + tag

- [ ] **Step 1: Re-run the full test matrix from clean**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
make clean
pnpm install
make all 2>&1 | tail -20
make test 2>&1 | tail -15
```

Expected: `make all` succeeds. `make test` shows at least 42 unit tests passing (and the integration test either passes if lightpanda is on PATH or skips gracefully).

- [ ] **Step 2: If lightpanda is available locally, run the demo against `example.com`**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  node ./orchestrator/dist/index.js demo https://example.com 2>&1 | head -30
```

Expected: a JSON snapshot is printed.

If the lightpanda binary isn't around, skip this — it's polish, not a gate.

- [ ] **Step 3: Tag the milestone**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git tag -a v0.0.2-m2 -m "Milestone 2 complete: orchestrator-side adapter, lightpanda binary consumed as dep"
git tag --list | grep v0.0.2-m2
```

- [ ] **Step 4: Print summary**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
echo "=== M2 production commits ==="
git log --oneline main..HEAD
echo ""
echo "=== Tests ==="
make test 2>&1 | tail -10
echo ""
echo "=== Next step ==="
echo "Use superpowers:finishing-a-development-branch to merge m2-production into main."
```

---

## Definition of Done (M2 production)

- [ ] All 11 tasks committed on branch `m2-production`
- [ ] `make clean && pnpm install && make all` exits 0 on macOS arm64
- [ ] `pnpm test` in `orchestrator/` shows ≥ 42 unit tests passing
- [ ] Integration test (`tests/integration/lightpanda-e2e.test.ts`) either passes (with real lightpanda binary) or skips (gracefully, when no binary is found)
- [ ] `husk demo <url>` produces a valid spec-§5.2 JSON snapshot when run against a real URL with a real lightpanda binary
- [ ] README.md and docs/quickstart.md reflect the prebuilt-binary install flow
- [ ] Tag `v0.0.2-m2` exists
- [ ] No new files outside `orchestrator/` (except documentation updates) — this milestone is strictly orchestrator-side

If any DoD checkbox fails, the milestone is not complete; address the gap before merging to main.

---

## What's NOT in M2 (deferred to later milestones)

- HTTP server / JSON-RPC public protocol — Milestone 3
- Site graph cache (per-domain stable_id → selector SQLite) — Milestone 4
- Real CDP MutationObserver event wiring (polling is v0) — Milestone v0.1
- Watchdog rule engine (sanity + policy) — Milestone 5
- Action planner (intent → CDP ops) — Milestone 5
- TS SDK / Python SDK transport implementations — Milestone 6
- MCP package (watchdog-aware proxy over upstream MCP) — Milestone 6
- Three example agents (`01-wikipedia-research`, `02-static-form-fill`, `03-shopify-pricecheck`) — Milestone 6
- Engine patches (landmark_path threading, native CDP mutation events) — Milestone v0.1
- IndexedDB upstream contribution — Milestone v0.2 (or "won't fix" if scope grows)
- Postinstall download / cross-platform binary packaging — Milestone 7 (launch prep)

When this plan ships, the next plan is **Plan #4 — Milestone 3 (orchestrator HTTP API)** which wraps the M2 `Session` class behind the JSON-RPC public protocol from spec §4.
