# Husk MCP Shim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `@husk/mcp` package — currently a placeholder from M1 — functional as a Husk-branded thin proxy over upstream lightpanda's stdio MCP server. After this plan ships, an AI agent connecting to MCP sees Husk-named tools (`husk_goto`, `husk_snapshot`, `husk_click`, etc.) and never sees lightpanda directly. Lightpanda is invisible implementation detail.

**Architecture:** `husk-mcp` (Node CLI) spawns `lightpanda mcp` as a subprocess. Reads JSON-RPC 2.0 newline-delimited messages from its own stdin and pipes them — after tool-name translation — to lightpanda's stdin. Reads responses from lightpanda's stdout, rewrites `tools/list` responses to expose Husk-branded names + descriptions, and pipes them to its own stdout. Adds one Husk-native tool, `husk_version`, that proves Husk owns the surface (not just relabels). No watchdog yet (M5+M6).

**Tech Stack:** TypeScript 5.5, Node 20 LTS, vitest, `node:child_process`, `node:readline`. Zero new npm dependencies — pure Node stdlib + the existing devDeps from M1.

**Source spec:** [`docs/superpowers/specs/2026-05-13-husk-design.md`](../specs/2026-05-13-husk-design.md), §6 Interface 3 (MCP server). M2 spike findings on upstream MCP: [`docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md`](../spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md) §6.

**Branch:** `mcp-shim` (already created — verify with `git branch --show-current` returns `mcp-shim`).

**Estimated duration:** 1–2 days for one engineer.

**Prerequisites:**
- Node 20 LTS, pnpm 9 (from M1)
- A prebuilt lightpanda binary on disk (anywhere — `LIGHTPANDA_BIN` env var or `lightpanda` on `PATH`). The spike already downloaded one at `engine/spike/.scratch/lightpanda`; that works for local dev.

---

## Pre-task Design Decisions

These are not separate tasks; they lock decisions before Task 1.

### Decision A — Binary discovery is duplicated, not shared (for v0)

Both `mcp/` and `orchestrator/` (when Plan #3 lands) need to locate the lightpanda binary. The clean solution is a shared workspace package — but that's a refactor we don't want during v0. Instead:

- `mcp/src/binary.ts` contains its own `locateLightpanda()` function (~80 lines)
- `orchestrator/src/engine/binary.ts` contains an identical-by-purpose function (when Plan #3 lands)
- Both files have a comment: `// DUPLICATED from / will-be-shared-with orchestrator/src/engine/binary.ts (v0.1: consolidate into @husk/shared)`

When v0.1 starts, both get refactored into one `packages/shared/binary.ts`. For v0 the duplication is cheap and acceptable.

### Decision B — Description rewriting: prepend "Husk — " to upstream descriptions

Each upstream tool has a description string (e.g., `goto`'s description is something like "Navigate the browser to a URL"). We prepend `"Husk — "` to each one so the LLM sees `"Husk — Navigate the browser to a URL"`. Reasons:

- Cheap (one-line transformation, no manual copy)
- Branding-correct (LLM sees "Husk" in every tool's description)
- Preserves semantic meaning from upstream (we don't have to maintain diverging copies)
- Easy to swap for full custom descriptions later (M6 watchdog-aware MCP can rewrite further when policy hooks are added)

### Decision C — Tool name mapping is a single bidirectional table

One `tool-map.ts` module exports two `Record<string, string>` objects (`UPSTREAM_TO_HUSK` and its inverse `HUSK_TO_UPSTREAM`). The full upstream-tool list from the M2 spike (T6) is 20 tools — all get Husk-prefixed names. Aliases (`navigate` vs `goto`, `eval` vs `evaluate`) are preserved as distinct entries so agents who saw lightpanda docs first can still find the tool they expect.

### Decision D — The proxy accepts streams as parameters

`runProxy(agentIn, agentOut, upstreamIn, upstreamOut, opts)` — not `runProxy(process, subprocess)`. This lets unit tests pass in `PassThrough` mock streams. Production wires real stdio. Same code path.

### Decision E — No npm publishing in this plan

`@husk/mcp` does not get published to npm in this plan. Agents install Husk by running it from a local clone (`"command": "node", "args": ["/abs/path/to/husk/mcp/dist/index.js"]`) for v0. npm publication is M7 launch prep. The plan's docs update covers both the local-path setup and the eventual `npx -y @husk/mcp` form.

---

## File Structure

### New TypeScript source files (all under `mcp/`)

| Path | Lines | Responsibility |
|---|---|---|
| `mcp/src/binary.ts` | ~80 | Locate lightpanda binary (env var → PATH). Duplicated from Plan #3's `orchestrator/src/engine/binary.ts`. |
| `mcp/src/types.ts` | ~50 | JSON-RPC 2.0 envelope types + MCP-specific types (tool, content, etc.). |
| `mcp/src/tool-map.ts` | ~80 | Bidirectional mapping between upstream tool names and `husk_*` names. |
| `mcp/src/transform.ts` | ~100 | Pure functions: rewrite `tools/list` responses; rewrite `tools/call` requests. No I/O. |
| `mcp/src/husk-tools.ts` | ~70 | Husk-native tool handlers (just `husk_version` for v0). |
| `mcp/src/proxy.ts` | ~140 | Stream-based proxy: stdin → upstream stdin (with `tools/call` rewriting + husk-native interception); upstream stdout → stdout (with `tools/list` rewriting). |
| `mcp/src/index.ts` | replaced | CLI entrypoint: locate binary, spawn subprocess, run proxy. Replaces the M1 placeholder. |

### New tests

| Path | Covers |
|---|---|
| `mcp/tests/binary.test.ts` | env var + PATH resolution, error paths |
| `mcp/tests/tool-map.test.ts` | mapping completeness + invertibility |
| `mcp/tests/transform.test.ts` | tools/list rewriting, tools/call rewriting, pass-through for unknown methods |
| `mcp/tests/husk-tools.test.ts` | husk_version returns expected shape |
| `mcp/tests/proxy.test.ts` | end-to-end stream proxy with mock streams |
| `mcp/tests/integration/lightpanda-mcp-e2e.test.ts` | spawn real lightpanda mcp + verify Husk-branded tools/list (skipped if binary not found) |

### Modified files

| Path | Change |
|---|---|
| `mcp/package.json` | Add `test`, `test:watch`, `typecheck` scripts (currently `test` is an echo stub). Add `vitest` to devDeps. |
| `docs/mcp-setup.md` | Replace placeholder with real install instructions for Claude Desktop / Cursor. |

### vitest config

`mcp/vitest.config.ts` does not currently exist (M1 only created it for orchestrator and sdk-ts). Task 1 creates it.

---

## Tasks

### Task 1: Wire mcp/ into the test runner + binary discovery

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/mcp/package.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/vitest.config.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/binary.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/binary.test.ts`

The M1 placeholder shipped `mcp/` with a stub `test` script (`echo 'tests added in M6'`). Time to turn it on, since we're "M6" for the MCP subset.

- [ ] **Step 1: Update mcp/package.json with real test setup**

Replace the contents of `/Users/nirmalghinaiya/Desktop/husk/mcp/package.json`:

```json
{
  "name": "@husk/mcp",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "husk-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "echo 'lint config in M3'",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create mcp/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 3: Update mcp/tsconfig.json to exclude tests**

The M1 mcp/tsconfig.json exists. Edit it to add `"tests"` to the `exclude` array if missing. Final content:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

(If "tests" is already in `exclude`, leave the file alone.)

- [ ] **Step 4: Install workspace deps to pick up vitest in mcp**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install
```

Expected: `Done in Xs`. Vitest gets symlinked into `mcp/node_modules/`.

- [ ] **Step 5: Write the failing test for binary discovery**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/binary.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { locateLightpanda, LightpandaNotFoundError } from "../src/binary.js";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("locateLightpanda (mcp)", () => {
  let tmpDir: string;
  let fakeBin: string;
  const originalEnv = process.env.LIGHTPANDA_BIN;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "husk-mcp-bin-test-"));
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
    expect(await locateLightpanda()).toBe(fakeBin);
  });

  it("falls back to PATH when LIGHTPANDA_BIN unset", async () => {
    delete process.env.LIGHTPANDA_BIN;
    process.env.PATH = tmpDir;
    expect(await locateLightpanda()).toBe(fakeBin);
  });

  it("throws LightpandaNotFoundError when neither found", async () => {
    delete process.env.LIGHTPANDA_BIN;
    process.env.PATH = mkdtempSync(join(tmpdir(), "husk-mcp-empty-"));
    await expect(locateLightpanda()).rejects.toBeInstanceOf(LightpandaNotFoundError);
  });

  it("throws if LIGHTPANDA_BIN points to a nonexistent path", async () => {
    process.env.LIGHTPANDA_BIN = join(tmpDir, "does-not-exist");
    process.env.PATH = "";
    await expect(locateLightpanda()).rejects.toBeInstanceOf(LightpandaNotFoundError);
  });
});
```

- [ ] **Step 6: Run test, confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test 2>&1 | tail -10
```

Expected: FAIL — module `../src/binary.js` not found.

- [ ] **Step 7: Implement binary discovery (duplicate from Plan #3 design)**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/src/binary.ts`:

```typescript
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

// DUPLICATED from / will-be-shared-with orchestrator/src/engine/binary.ts
// (v0.1: consolidate into @husk/shared workspace package)

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
      `See docs/mcp-setup.md.`
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

- [ ] **Step 8: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test 2>&1 | tail -10
```

Expected: PASS (4 tests in `binary.test.ts`).

- [ ] **Step 9: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/package.json mcp/tsconfig.json mcp/vitest.config.ts mcp/src/binary.ts mcp/tests/binary.test.ts pnpm-lock.yaml
git commit -m "feat(mcp): wire vitest + lightpanda binary discovery"
```

---

### Task 2: JSON-RPC envelope types

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/types.ts`

This is type definitions only — no logic, no test. Consumed by Tasks 3–7.

- [ ] **Step 1: Write the types file**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/src/types.ts`:

```typescript
/**
 * JSON-RPC 2.0 + MCP type definitions used by the Husk MCP shim.
 *
 * MCP protocol version: 2024-11-05. Stdio transport is newline-delimited
 * JSON-RPC 2.0; each message is one JSON object on its own line.
 */

// ----- JSON-RPC 2.0 envelopes -----

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

// ----- MCP-specific shapes (subset we care about) -----

export interface McpTool {
  name: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema?: any;
}

export interface McpToolsListResult {
  tools: McpTool[];
  nextCursor?: string;
}

export interface McpToolCallParams {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arguments?: any;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}
```

- [ ] **Step 2: Typecheck**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/src/types.ts
git commit -m "feat(mcp): JSON-RPC 2.0 + MCP envelope types"
```

---

### Task 3: Tool name mapping

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/tool-map.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/tool-map.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/tool-map.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  UPSTREAM_TO_HUSK,
  HUSK_TO_UPSTREAM,
  upstreamNameOf,
  huskNameOf,
} from "../src/tool-map.js";

describe("tool name mapping", () => {
  it("covers all 20 upstream tools known from the M2 spike", () => {
    const expected = [
      "goto",
      "navigate",
      "evaluate",
      "eval",
      "markdown",
      "links",
      "semantic_tree",
      "nodeDetails",
      "interactiveElements",
      "structuredData",
      "detectForms",
      "click",
      "fill",
      "scroll",
      "waitForSelector",
      "hover",
      "press",
      "selectOption",
      "setChecked",
      "findElement",
    ];
    for (const name of expected) {
      expect(UPSTREAM_TO_HUSK).toHaveProperty(name);
      expect(UPSTREAM_TO_HUSK[name]).toMatch(/^husk_/);
    }
    expect(Object.keys(UPSTREAM_TO_HUSK)).toHaveLength(20);
  });

  it("HUSK_TO_UPSTREAM is the exact inverse of UPSTREAM_TO_HUSK", () => {
    for (const [upstream, husk] of Object.entries(UPSTREAM_TO_HUSK)) {
      expect(HUSK_TO_UPSTREAM[husk]).toBe(upstream);
    }
    expect(Object.keys(HUSK_TO_UPSTREAM)).toHaveLength(Object.keys(UPSTREAM_TO_HUSK).length);
  });

  it("upstreamNameOf converts husk_* back to upstream", () => {
    expect(upstreamNameOf("husk_goto")).toBe("goto");
    expect(upstreamNameOf("husk_snapshot")).toBe("semantic_tree");
  });

  it("upstreamNameOf returns the input unchanged when name is not Husk-prefixed", () => {
    expect(upstreamNameOf("unknown_tool")).toBe("unknown_tool");
  });

  it("huskNameOf converts upstream to husk_*", () => {
    expect(huskNameOf("goto")).toBe("husk_goto");
    expect(huskNameOf("semantic_tree")).toBe("husk_snapshot");
  });

  it("huskNameOf returns the input unchanged when there is no mapping", () => {
    expect(huskNameOf("unknown_upstream_tool")).toBe("unknown_upstream_tool");
  });

  it("renames semantic_tree to husk_snapshot (the only non-prefix-only rename)", () => {
    expect(UPSTREAM_TO_HUSK["semantic_tree"]).toBe("husk_snapshot");
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/tool-map.test.ts 2>&1 | tail -10
```

Expected: FAIL — module `../src/tool-map.js` not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/src/tool-map.ts`:

```typescript
/**
 * Bidirectional mapping between upstream lightpanda MCP tool names and
 * Husk-branded names that agents see.
 *
 * The full list of 20 upstream tools comes from the M2 spike audit
 * (T6 — see docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md §6).
 *
 * Naming policy:
 *   - Most tools: prepend `husk_` (e.g., goto → husk_goto)
 *   - camelCase upstream names: convert to snake_case + husk_ prefix
 *     (e.g., nodeDetails → husk_node_details)
 *   - One semantic rename: `semantic_tree → husk_snapshot`
 *     (consistent with spec §5.2 "snapshot" terminology)
 *   - Aliases (goto/navigate, evaluate/eval) are preserved as
 *     distinct husk_* entries so users who learned the upstream alias
 *     can find the Husk equivalent.
 */
export const UPSTREAM_TO_HUSK: Record<string, string> = {
  goto: "husk_goto",
  navigate: "husk_navigate",
  evaluate: "husk_evaluate",
  eval: "husk_eval",
  markdown: "husk_markdown",
  links: "husk_links",
  semantic_tree: "husk_snapshot",
  nodeDetails: "husk_node_details",
  interactiveElements: "husk_interactive_elements",
  structuredData: "husk_structured_data",
  detectForms: "husk_detect_forms",
  click: "husk_click",
  fill: "husk_fill",
  scroll: "husk_scroll",
  waitForSelector: "husk_wait_for_selector",
  hover: "husk_hover",
  press: "husk_press",
  selectOption: "husk_select_option",
  setChecked: "husk_set_checked",
  findElement: "husk_find_element",
};

export const HUSK_TO_UPSTREAM: Record<string, string> = Object.fromEntries(
  Object.entries(UPSTREAM_TO_HUSK).map(([upstream, husk]) => [husk, upstream])
);

/**
 * Translate a Husk-prefixed tool name back to its upstream form for
 * forwarding to lightpanda. If the name has no mapping, return it
 * unchanged (forward-as-is).
 */
export function upstreamNameOf(huskOrUnknown: string): string {
  return HUSK_TO_UPSTREAM[huskOrUnknown] ?? huskOrUnknown;
}

/**
 * Translate an upstream tool name to its Husk-branded form for display
 * to agents. If the name has no mapping, return it unchanged.
 */
export function huskNameOf(upstreamOrUnknown: string): string {
  return UPSTREAM_TO_HUSK[upstreamOrUnknown] ?? upstreamOrUnknown;
}
```

- [ ] **Step 4: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/tool-map.test.ts 2>&1 | tail -10
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/src/tool-map.ts mcp/tests/tool-map.test.ts
git commit -m "feat(mcp): bidirectional tool-name mapping (upstream ↔ husk_*)"
```

---

### Task 4: Husk-native tools (`husk_version`)

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/husk-tools.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/husk-tools.test.ts`

`husk_version` is the proof that Husk owns the surface — not just relabels. It returns `{husk: "0.0.0", lightpanda: "0.3.0", protocol: "..."}` and is fully implemented in our process (never forwarded to lightpanda).

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/husk-tools.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { HUSK_NATIVE_TOOLS, callHuskNativeTool, isHuskNativeTool } from "../src/husk-tools.js";

describe("HUSK_NATIVE_TOOLS", () => {
  it("declares husk_version as a tool", () => {
    const v = HUSK_NATIVE_TOOLS.find((t) => t.name === "husk_version");
    expect(v).toBeDefined();
    expect(v?.description).toMatch(/husk/i);
    expect(v?.inputSchema).toMatchObject({ type: "object" });
  });
});

describe("isHuskNativeTool", () => {
  it("recognizes husk_version", () => {
    expect(isHuskNativeTool("husk_version")).toBe(true);
  });

  it("rejects upstream-wrapped tools", () => {
    expect(isHuskNativeTool("husk_goto")).toBe(false);
    expect(isHuskNativeTool("husk_snapshot")).toBe(false);
  });

  it("rejects unknown tools", () => {
    expect(isHuskNativeTool("not_a_tool")).toBe(false);
  });
});

describe("callHuskNativeTool", () => {
  it("returns Husk + lightpanda + protocol versions for husk_version", async () => {
    const res = await callHuskNativeTool("husk_version", {}, { lightpandaVersion: "0.3.0-test" });
    expect(res.content).toBeInstanceOf(Array);
    expect(res.content[0].type).toBe("text");
    const parsed = JSON.parse((res.content[0].text ?? "") as string);
    expect(parsed.husk).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.lightpanda).toBe("0.3.0-test");
    expect(parsed.protocol).toBe("2024-11-05");
  });

  it("returns an error result for unknown native tools", async () => {
    const res = await callHuskNativeTool("not_native", {}, { lightpandaVersion: "x" });
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/husk-tools.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/src/husk-tools.ts`:

```typescript
import type { McpTool, McpToolCallResult } from "./types.js";

/** Husk's MCP protocol version pinned to the version supported by upstream lightpanda. */
const HUSK_MCP_PROTOCOL = "2024-11-05";

/** Husk MCP package version. Bumped on each release; mirrored from package.json. */
const HUSK_VERSION = "0.0.0";

/**
 * Tools defined natively by Husk (not forwarded to lightpanda).
 *
 * For v0 there is only one: `husk_version`. M5+M6 will add more
 * (e.g., `husk_set_policy`, `husk_diff`, `husk_resolve_stable_id`).
 */
export const HUSK_NATIVE_TOOLS: McpTool[] = [
  {
    name: "husk_version",
    description:
      "Husk — return version information about the Husk MCP shim and the underlying lightpanda engine it wraps.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

const HUSK_NATIVE_NAMES = new Set(HUSK_NATIVE_TOOLS.map((t) => t.name));

export function isHuskNativeTool(name: string): boolean {
  return HUSK_NATIVE_NAMES.has(name);
}

export interface HuskNativeContext {
  /** Version of lightpanda actually being proxied (discovered at startup). */
  lightpandaVersion: string;
}

export async function callHuskNativeTool(
  name: string,
  _args: unknown,
  ctx: HuskNativeContext
): Promise<McpToolCallResult> {
  switch (name) {
    case "husk_version": {
      const payload = {
        husk: HUSK_VERSION,
        lightpanda: ctx.lightpandaVersion,
        protocol: HUSK_MCP_PROTOCOL,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
      };
    }
    default:
      return {
        content: [{ type: "text", text: `Unknown Husk-native tool: ${name}` }],
        isError: true,
      };
  }
}
```

- [ ] **Step 4: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/husk-tools.test.ts 2>&1 | tail -10
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/src/husk-tools.ts mcp/tests/husk-tools.test.ts
git commit -m "feat(mcp): husk_version native tool — proves we own the MCP surface"
```

---

### Task 5: Message transform functions

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/transform.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/transform.test.ts`

Pure functions, no I/O. Easy to test. Two transformations:

1. `rewriteToolsListResponse(msg)` — when lightpanda responds to a `tools/list` request, we rename each tool in the response: name → `husk_*`, description → `"Husk — " + original`. We also append Husk-native tools (e.g., `husk_version`) to the list.
2. `rewriteToolsCallRequest(msg)` — when an agent sends a `tools/call` for a `husk_*` name, we translate the name back to upstream so lightpanda understands. (If it's a Husk-native tool, we don't translate — `index.ts` handles the routing.)

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/transform.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  rewriteToolsListResponse,
  rewriteToolsCallRequest,
  isToolsListResponse,
  isToolsCallRequest,
} from "../src/transform.js";

describe("isToolsListResponse / isToolsCallRequest", () => {
  it("detects tools/list response shape", () => {
    expect(
      isToolsListResponse({ jsonrpc: "2.0", id: 1, result: { tools: [] } })
    ).toBe(true);
  });

  it("rejects non-result messages", () => {
    expect(isToolsListResponse({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(false);
  });

  it("detects tools/call request shape", () => {
    expect(
      isToolsCallRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } })
    ).toBe(true);
  });

  it("rejects non-tools/call methods", () => {
    expect(
      isToolsCallRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    ).toBe(false);
  });
});

describe("rewriteToolsListResponse", () => {
  it("renames each upstream tool to its husk_ form", () => {
    const input = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "goto", description: "Navigate the browser to a URL." },
          { name: "semantic_tree", description: "Return the page semantic tree." },
        ],
      },
    };
    const out = rewriteToolsListResponse(input);
    const names = (out.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).not.toContain("goto");
    expect(names).not.toContain("semantic_tree");
  });

  it('prepends "Husk — " to each upstream tool description', () => {
    const input = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "click", description: "Click an element by selector." }],
      },
    };
    const out = rewriteToolsListResponse(input);
    const desc = (out.result as { tools: { description: string }[] }).tools[0].description;
    expect(desc).toMatch(/^Husk — /);
    expect(desc).toContain("Click an element by selector.");
  });

  it("appends Husk-native tools to the list", () => {
    const input = {
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "goto", description: "Navigate." }] },
    };
    const out = rewriteToolsListResponse(input);
    const names = (out.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain("husk_version");
  });

  it("preserves the response id and jsonrpc version", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 42,
      result: { tools: [] },
    };
    const out = rewriteToolsListResponse(input);
    expect(out.id).toBe(42);
    expect(out.jsonrpc).toBe("2.0");
  });
});

describe("rewriteToolsCallRequest", () => {
  it("translates husk_goto → goto in params.name", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 7,
      method: "tools/call",
      params: { name: "husk_goto", arguments: { url: "https://example.com" } },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.params.name).toBe("goto");
    expect(out.params.arguments).toEqual({ url: "https://example.com" });
  });

  it("translates husk_snapshot → semantic_tree", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 7,
      method: "tools/call",
      params: { name: "husk_snapshot", arguments: {} },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.params.name).toBe("semantic_tree");
  });

  it("returns the input unchanged when params.name is not a husk_ name", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 7,
      method: "tools/call",
      params: { name: "unknown_tool", arguments: {} },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.params.name).toBe("unknown_tool");
  });

  it("preserves the request id, jsonrpc, and method fields", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 99,
      method: "tools/call",
      params: { name: "husk_click", arguments: { selector: "#x" } },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.id).toBe(99);
    expect(out.jsonrpc).toBe("2.0");
    expect(out.method).toBe("tools/call");
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/transform.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/src/transform.ts`:

```typescript
import type {
  JsonRpcMessage,
  JsonRpcSuccessResponse,
  JsonRpcRequest,
  McpToolsListResult,
  McpToolCallParams,
  McpTool,
} from "./types.js";
import { huskNameOf, upstreamNameOf } from "./tool-map.js";
import { HUSK_NATIVE_TOOLS } from "./husk-tools.js";

/** Detect a JSON-RPC success response carrying an MCP `tools/list` result. */
export function isToolsListResponse(
  msg: unknown
): msg is JsonRpcSuccessResponse & { result: McpToolsListResult } {
  if (!msg || typeof msg !== "object") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any;
  return (
    m.jsonrpc === "2.0" &&
    "result" in m &&
    m.result &&
    typeof m.result === "object" &&
    Array.isArray((m.result as { tools?: unknown }).tools)
  );
}

/** Detect a JSON-RPC request invoking the MCP `tools/call` method. */
export function isToolsCallRequest(
  msg: unknown
): msg is JsonRpcRequest & { params: McpToolCallParams } {
  if (!msg || typeof msg !== "object") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any;
  return (
    m.jsonrpc === "2.0" &&
    m.method === "tools/call" &&
    m.params &&
    typeof m.params.name === "string"
  );
}

/**
 * Rewrite a tools/list response so that:
 *   1. Each upstream tool's `name` is replaced with its `husk_*` equivalent.
 *   2. Each tool's `description` is prepended with "Husk — ".
 *   3. Husk-native tools (from husk-tools.ts) are appended to the list.
 */
export function rewriteToolsListResponse(
  msg: JsonRpcSuccessResponse & { result: McpToolsListResult }
): JsonRpcSuccessResponse {
  const upstreamTools = msg.result.tools.map((t) => rebrandTool(t));
  const tools: McpTool[] = [...upstreamTools, ...HUSK_NATIVE_TOOLS];
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...msg.result, tools },
  };
}

function rebrandTool(t: McpTool): McpTool {
  return {
    ...t,
    name: huskNameOf(t.name),
    description: t.description ? `Husk — ${t.description}` : `Husk — (no upstream description for ${t.name})`,
  };
}

/**
 * Rewrite a tools/call request so that the tool name reaches lightpanda
 * in its upstream form. If the agent supplied a husk_* name, translate
 * it. Otherwise pass through.
 *
 * Note: callers should detect Husk-native tool names (`isHuskNativeTool`)
 * BEFORE calling this — native tools must not be forwarded to lightpanda.
 */
export function rewriteToolsCallRequest(
  msg: JsonRpcRequest & { params: McpToolCallParams }
): JsonRpcRequest & { params: McpToolCallParams } {
  const upstreamName = upstreamNameOf(msg.params.name);
  return {
    ...msg,
    params: { ...msg.params, name: upstreamName },
  };
}

// Re-export for callers that want to know the union type at the call site.
export type { JsonRpcMessage };
```

- [ ] **Step 4: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/transform.test.ts 2>&1 | tail -15
```

Expected: PASS (11 tests in transform.test.ts).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/src/transform.ts mcp/tests/transform.test.ts
git commit -m "feat(mcp): tools/list + tools/call message transforms"
```

---

### Task 6: Stream-based proxy

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/proxy.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/proxy.test.ts`

The proxy is the I/O engine that wires the agent's stdio to lightpanda's stdio with our transformations applied. It accepts streams as parameters so unit tests can pass mock streams.

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/proxy.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { runProxy } from "../src/proxy.js";

interface Captured {
  upstreamStdinLines: string[];
  agentStdoutLines: string[];
}

async function runScenario(
  agentInputLines: string[],
  upstreamResponses: (line: string) => string | undefined,
  opts: { lightpandaVersion: string }
): Promise<Captured> {
  const agentIn = new PassThrough();
  const agentOut = new PassThrough();
  const upstreamIn = new PassThrough();
  const upstreamOut = new PassThrough();

  const captured: Captured = { upstreamStdinLines: [], agentStdoutLines: [] };

  upstreamIn.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) {
        captured.upstreamStdinLines.push(line);
        // Simulate upstream responding
        const reply = upstreamResponses(line);
        if (reply !== undefined) upstreamOut.write(reply + "\n");
      }
    }
  });
  agentOut.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) captured.agentStdoutLines.push(line);
    }
  });

  const proxyPromise = runProxy(agentIn, agentOut, upstreamIn, upstreamOut, opts);

  for (const line of agentInputLines) {
    agentIn.write(line + "\n");
  }
  // Allow microtasks + timers to flush
  await new Promise((r) => setTimeout(r, 50));
  agentIn.end();
  // Wait for proxy to settle
  await proxyPromise.catch(() => {}); // proxy resolves on EOF or close
  return captured;
}

describe("runProxy", () => {
  it("rewrites a tools/call request before forwarding to upstream", async () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "husk_goto", arguments: { url: "https://example.com" } },
    });
    const captured = await runScenario(
      [request],
      // Upstream sees the rewritten name
      (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "tools/call") {
          return JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } });
        }
        return undefined;
      },
      { lightpandaVersion: "0.3.0" }
    );
    expect(captured.upstreamStdinLines).toHaveLength(1);
    const upstreamMsg = JSON.parse(captured.upstreamStdinLines[0]);
    expect(upstreamMsg.params.name).toBe("goto"); // translated from husk_goto
  });

  it("rewrites a tools/list response before forwarding to agent", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const captured = await runScenario(
      [request],
      (_line) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            tools: [
              { name: "goto", description: "Navigate." },
              { name: "semantic_tree", description: "Return the page." },
            ],
          },
        }),
      { lightpandaVersion: "0.3.0" }
    );
    expect(captured.agentStdoutLines).toHaveLength(1);
    const out = JSON.parse(captured.agentStdoutLines[0]);
    const names = out.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).toContain("husk_version");
    expect(names).not.toContain("goto");
  });

  it("handles husk_version locally without forwarding to upstream", async () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "husk_version", arguments: {} },
    });
    const captured = await runScenario(
      [request],
      (_line) => undefined, // upstream should not be hit
      { lightpandaVersion: "0.3.0-test" }
    );
    expect(captured.upstreamStdinLines).toHaveLength(0); // not forwarded
    expect(captured.agentStdoutLines).toHaveLength(1);
    const out = JSON.parse(captured.agentStdoutLines[0]);
    expect(out.id).toBe(5);
    const payload = JSON.parse(out.result.content[0].text);
    expect(payload.husk).toBeDefined();
    expect(payload.lightpanda).toBe("0.3.0-test");
  });

  it("passes through unknown methods unchanged", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" });
    const captured = await runScenario(
      [request],
      (line) => {
        const m = JSON.parse(line);
        return JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { pong: true } });
      },
      { lightpandaVersion: "0.3.0" }
    );
    expect(captured.upstreamStdinLines).toHaveLength(1);
    expect(JSON.parse(captured.upstreamStdinLines[0]).method).toBe("ping");
    expect(captured.agentStdoutLines).toHaveLength(1);
    expect(JSON.parse(captured.agentStdoutLines[0]).result.pong).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/proxy.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/src/proxy.ts`:

```typescript
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  isToolsListResponse,
  isToolsCallRequest,
  rewriteToolsListResponse,
  rewriteToolsCallRequest,
} from "./transform.js";
import { isHuskNativeTool, callHuskNativeTool, type HuskNativeContext } from "./husk-tools.js";
import type { JsonRpcMessage, JsonRpcSuccessResponse } from "./types.js";

export interface ProxyOptions {
  /** Version string for the upstream lightpanda binary. Surfaced via husk_version. */
  lightpandaVersion: string;
  /** Optional logger for proxy-level events (errors, malformed input). Defaults to no-op. */
  log?: (line: string) => void;
}

/**
 * Run the Husk MCP proxy.
 *
 * Pipes JSON-RPC newline-delimited messages between an "agent" pair of
 * streams (the MCP client) and an "upstream" pair (the lightpanda mcp
 * subprocess), applying our transformations:
 *
 *   - tools/call requests with husk_* names → translated to upstream
 *   - tools/call requests with husk_version → handled locally
 *   - tools/list responses → rebranded with husk_* names + Husk-native tools appended
 *   - Everything else → pass-through
 *
 * Resolves when the agent input stream ends (EOF).
 */
export async function runProxy(
  agentIn: Readable,
  agentOut: Writable,
  upstreamIn: Writable,
  upstreamOut: Readable,
  opts: ProxyOptions
): Promise<void> {
  const log = opts.log ?? (() => {});
  const ctx: HuskNativeContext = { lightpandaVersion: opts.lightpandaVersion };

  // --- Agent → Upstream (or local) ---
  const agentRl = createInterface({ input: agentIn, crlfDelay: Infinity });
  const agentDone = new Promise<void>((resolve) => {
    agentRl.on("close", () => resolve());
  });

  agentRl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch (err) {
      log(`[husk-mcp] malformed agent message: ${(err as Error).message}`);
      return;
    }

    if (isToolsCallRequest(msg) && isHuskNativeTool(msg.params.name)) {
      // Husk-native tool: handle locally, never forward upstream.
      void callHuskNativeTool(msg.params.name, msg.params.arguments, ctx).then((result) => {
        const response: JsonRpcSuccessResponse = {
          jsonrpc: "2.0",
          id: msg.id,
          result,
        };
        agentOut.write(JSON.stringify(response) + "\n");
      });
      return;
    }

    if (isToolsCallRequest(msg)) {
      // Translate husk_* → upstream name, then forward.
      const rewritten = rewriteToolsCallRequest(msg);
      upstreamIn.write(JSON.stringify(rewritten) + "\n");
      return;
    }

    // Default: forward unchanged.
    upstreamIn.write(line + "\n");
  });

  // --- Upstream → Agent ---
  const upstreamRl = createInterface({ input: upstreamOut, crlfDelay: Infinity });
  upstreamRl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch (err) {
      log(`[husk-mcp] malformed upstream message: ${(err as Error).message}`);
      return;
    }

    if (isToolsListResponse(msg)) {
      const rewritten = rewriteToolsListResponse(msg);
      agentOut.write(JSON.stringify(rewritten) + "\n");
      return;
    }

    // Default: forward unchanged.
    agentOut.write(line + "\n");
  });

  await agentDone;
}
```

- [ ] **Step 4: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/proxy.test.ts 2>&1 | tail -15
```

Expected: PASS (4 tests).

- [ ] **Step 5: Full suite check**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test 2>&1 | tail -10
```

Expected: 32 tests pass total (4 + 7 + 6 + 11 + 4).

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/src/proxy.ts mcp/tests/proxy.test.ts
git commit -m "feat(mcp): stream-based stdio proxy with Husk transforms"
```

---

### Task 7: CLI entrypoint — wire it all together

**Files:**
- Modify (replace): `/Users/nirmalghinaiya/Desktop/husk/mcp/src/index.ts`

The M1 placeholder in `mcp/src/index.ts` just prints help/version. Replace it with the real wiring: locate lightpanda, spawn its `mcp` subcommand, run the proxy.

- [ ] **Step 1: Replace the placeholder index.ts**

Replace the contents of `/Users/nirmalghinaiya/Desktop/husk/mcp/src/index.ts`:

```typescript
#!/usr/bin/env node
import { spawn } from "node:child_process";
import { locateLightpanda } from "./binary.js";
import { runProxy } from "./proxy.js";

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

The Husk MCP server. Wraps lightpanda's stdio MCP behind Husk-branded
tools (husk_goto, husk_snapshot, husk_click, etc.) and adds the
husk_version native tool.

Usage:
  husk-mcp                Start the MCP server on stdio (default).
                          Use this in your Claude Desktop / Cursor config.
  husk-mcp serve          Same as above (explicit form).
  husk-mcp version        Print Husk MCP version.
  husk-mcp help           Print this help.

Configure in Claude Desktop's claude_desktop_config.json:
  {
    "mcpServers": {
      "husk": {
        "command": "node",
        "args": ["/absolute/path/to/husk/mcp/dist/index.js"]
      }
    }
  }

Or via npx after publish (M7):
  { "mcpServers": { "husk": { "command": "npx", "args": ["-y", "@husk/mcp"] } } }

Requires a prebuilt lightpanda binary discoverable via LIGHTPANDA_BIN
env var or "lightpanda" on PATH. See docs/mcp-setup.md.`);
    break;
  case "serve":
  default:
    await runServer();
    break;
}

async function runServer(): Promise<void> {
  let binary: string;
  try {
    binary = await locateLightpanda();
  } catch (err) {
    process.stderr.write(`[husk-mcp] ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Spawn lightpanda's mcp subcommand. The subprocess speaks JSON-RPC 2.0
  // newline-delimited on its stdin/stdout. We proxy between it and our
  // own stdin/stdout.
  const child = spawn(binary, ["mcp"], {
    stdio: ["pipe", "pipe", "inherit"], // stderr goes through to our stderr for debugging
  });

  // Best-effort discovery of upstream version. We pass a placeholder for
  // now; in a future version we could send a `husk_version`-like upstream
  // call to discover. For v0 we tag with binary basename + "(unknown)".
  const lightpandaVersion = `(prebuilt at ${binary})`;

  child.on("exit", (code, signal) => {
    process.stderr.write(`[husk-mcp] lightpanda exited (code=${code} signal=${signal})\n`);
    process.exit(code ?? 1);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  await runProxy(process.stdin, process.stdout, child.stdin!, child.stdout!, {
    lightpandaVersion,
    log: (line) => process.stderr.write(line + "\n"),
  });

  // If the proxy returns (agent stdin EOF), shut down lightpanda cleanly.
  child.kill("SIGTERM");
}
```

- [ ] **Step 2: Build**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm build 2>&1 | tail -5
```

Expected: no compilation errors.

- [ ] **Step 3: Smoke-test the version + help commands**

```sh
node /Users/nirmalghinaiya/Desktop/husk/mcp/dist/index.js version
echo "---"
node /Users/nirmalghinaiya/Desktop/husk/mcp/dist/index.js help | head -10
```

Expected first command: `husk-mcp v0.0.0`. Expected second: usage block.

- [ ] **Step 4: Smoke-test the proxy (only if lightpanda binary is available)**

```sh
# Verify lightpanda is discoverable
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  ls $LIGHTPANDA_BIN >/dev/null 2>&1 && echo "binary OK" || echo "binary missing — skip this step"

# Send a tools/list request and verify Husk-branded response
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  timeout 5 node /Users/nirmalghinaiya/Desktop/husk/mcp/dist/index.js serve 2>&1 | head -30
```

You should see a JSON response listing tools where the names are `husk_goto`, `husk_snapshot`, etc., plus `husk_version`. If your shell tools are limited or the binary isn't around, skip — Task 8's integration test covers this.

- [ ] **Step 5: Full test suite check**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test 2>&1 | tail -10
```

Expected: 32 tests still pass.

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/src/index.ts
git commit -m "feat(mcp): CLI entrypoint wires binary discovery + proxy + lightpanda subprocess"
```

---

### Task 8: Integration test, docs, and tag

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/integration/lightpanda-mcp-e2e.test.ts`
- Modify (replace): `/Users/nirmalghinaiya/Desktop/husk/docs/mcp-setup.md`

- [ ] **Step 1: Write the integration test (skipped if no lightpanda binary)**

Create `/Users/nirmalghinaiya/Desktop/husk/mcp/tests/integration/lightpanda-mcp-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { locateLightpanda } from "../../src/binary.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUSK_MCP_BIN = resolve(__dirname, "../../dist/index.js");

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

integrationOrSkip("husk-mcp end-to-end against real lightpanda", () => {
  it("tools/list returns Husk-branded tool names and includes husk_version", async () => {
    const child = spawn("node", [HUSK_MCP_BIN, "serve"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
    });
    // Print stderr for debugging if test fails
    child.stderr.on("data", (chunk: Buffer) => {
      // eslint-disable-next-line no-console
      console.error("[stderr]", chunk.toString().trim());
    });

    // Send tools/list
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");

    // Wait up to 10s for a response line
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      if (stdoutBuffer.includes("\n")) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    child.stdin.end();
    child.kill("SIGTERM");

    const firstLine = stdoutBuffer.split("\n").find((l) => l.trim());
    expect(firstLine).toBeTruthy();
    const response = JSON.parse(firstLine!);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result?.tools).toBeInstanceOf(Array);
    const names = response.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).toContain("husk_version");
    // No raw upstream names should leak through
    expect(names).not.toContain("goto");
    expect(names).not.toContain("semantic_tree");
  }, 30_000);
});
```

- [ ] **Step 2: Run integration test (passes or skips based on binary availability)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm test tests/integration/lightpanda-mcp-e2e.test.ts 2>&1 | tail -10
```

Expected: PASS (if lightpanda binary discoverable) or SKIPPED (otherwise).

- [ ] **Step 3: Replace docs/mcp-setup.md with the real install guide**

Replace `/Users/nirmalghinaiya/Desktop/husk/docs/mcp-setup.md` with:

````markdown
# Husk MCP Setup

The `@husk/mcp` package exposes Husk to Model Context Protocol clients
(Claude Desktop, Cursor, Continue, Windsurf, anything that speaks MCP).
This is the primary agent-facing surface for Husk in v0.

Under the hood, `husk-mcp` spawns the upstream lightpanda binary in its
own MCP mode and proxies between your MCP client and lightpanda — adding
Husk-branded tool names, prepending "Husk — " to descriptions, and
shipping the `husk_version` native tool. In M5+M6 the proxy gains
watchdog enforcement and stable-ID resolution. The MCP server config you
write today will not change as those layer in.

## Prerequisites

- Node 20 LTS (matches the rest of Husk)
- A prebuilt lightpanda binary discoverable via `LIGHTPANDA_BIN` env var
  or `lightpanda` on `PATH`. Download from
  https://github.com/lightpanda-io/browser/releases (asset names:
  `lightpanda-aarch64-macos`, `lightpanda-x86_64-macos`,
  `lightpanda-aarch64-linux`, `lightpanda-x86_64-linux`).

## Install Husk locally (until npm publish in M7)

```sh
git clone https://github.com/NGHINAI/Husk
cd Husk
pnpm install
make all
# Verify the MCP binary built
node ./mcp/dist/index.js version
```

## Configure your MCP client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) and add a `husk` server entry:

```json
{
  "mcpServers": {
    "husk": {
      "command": "node",
      "args": ["/absolute/path/to/Husk/mcp/dist/index.js"],
      "env": {
        "LIGHTPANDA_BIN": "/absolute/path/to/lightpanda"
      }
    }
  }
}
```

Replace `/absolute/path/to/Husk` with your clone's location and
`/absolute/path/to/lightpanda` with the binary you downloaded.

Restart Claude Desktop. You should see Husk tools available:
`husk_goto`, `husk_snapshot`, `husk_click`, `husk_fill`,
`husk_scroll`, `husk_wait_for_selector`, `husk_version`, and others.

### Cursor

Cursor uses the same `mcpServers` config shape. Edit your Cursor
settings and add the same entry.

### After M7 (npm publish)

When `@husk/mcp` is published to npm, the config simplifies to:

```json
{
  "mcpServers": {
    "husk": {
      "command": "npx",
      "args": ["-y", "@husk/mcp"],
      "env": { "LIGHTPANDA_BIN": "/absolute/path/to/lightpanda" }
    }
  }
}
```

## Verify the install

Once Claude Desktop / Cursor restarts, ask the agent to call
`husk_version`. The response should include the Husk version, the
lightpanda binary path, and the MCP protocol version (`2024-11-05`).

If you don't see Husk tools listed, check `~/Library/Logs/Claude/`
(macOS) for MCP startup errors. The most common issue is `LIGHTPANDA_BIN`
pointing at a non-executable path.

## What's in v0 vs what's coming

v0 (today):
- All 20 lightpanda tools exposed under Husk names
- "Husk — " prefix on every tool description
- `husk_version` native tool

v0.1 / M5 (the watchdog wedge):
- Per-session policy YAML loading via a `husk_set_policy` tool
- Pre-action sanity checks (element-exists / visible / enabled) intercepted in the proxy
- Watchdog rejection envelopes with structured `reason` + `candidates`

v0.2 / M6 polish:
- `husk_stable_id` tool that returns spec-§5.1 stable IDs
- `husk_diff` tool that returns mutation deltas
- Cookie / SSO / MFA helpers from the auth pillar
````

- [ ] **Step 4: Run the full M1+shim test suite**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && make test 2>&1 | tail -15
```

Expected: M1 tests (orchestrator 3 + sdk-ts 4 + sdk-py 4 = 11) still pass, plus our new mcp tests (32 = 4 + 7 + 6 + 11 + 4 unit + 1 integration if binary available). Total: 43–44.

- [ ] **Step 5: Tag the shim**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git tag -a v0.0.2-mcp-shim -m "Husk MCP shim complete — Husk-branded wrapper over lightpanda's MCP"
git tag --list | grep mcp
```

- [ ] **Step 6: Commit + summary print**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add mcp/tests/integration/lightpanda-mcp-e2e.test.ts docs/mcp-setup.md
git commit -m "feat(mcp): integration test + real install docs for Husk MCP"

echo "=== Shim commits on this branch ==="
git log --oneline main..HEAD
echo ""
echo "=== Tests ==="
make test 2>&1 | tail -10
```

---

## Definition of Done

- [ ] All 8 tasks committed on branch `mcp-shim`
- [ ] `make clean && pnpm install && make all` exits 0
- [ ] `pnpm test` in `mcp/` shows ≥ 32 unit tests passing
- [ ] Integration test (`tests/integration/lightpanda-mcp-e2e.test.ts`) passes when lightpanda binary is available, skips otherwise
- [ ] `node mcp/dist/index.js version` prints `husk-mcp v0.0.0`
- [ ] `node mcp/dist/index.js help` prints the usage block with example Claude Desktop config
- [ ] `node mcp/dist/index.js serve` (when fed `{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n` on stdin and `LIGHTPANDA_BIN` set) returns a response with `husk_*` tool names
- [ ] `docs/mcp-setup.md` contains the real install guide
- [ ] Tag `v0.0.2-mcp-shim` exists
- [ ] No code touched outside `mcp/`, `docs/mcp-setup.md` (this is a focused MCP shim milestone)

If any DoD checkbox fails, the milestone is not complete; address the gap before merging to main.

---

## What's NOT in this plan (explicitly deferred)

- **Watchdog enforcement in the proxy** — M5 + M6. The proxy is a pure rebrander right now; in M5 it grows policy-aware tool-call interception.
- **Stable-ID tools** (`husk_stable_id`, `husk_diff`) — M6. Requires the orchestrator's snapshot adapter to exist first (Plan #3 / M2 production).
- **npm publish of `@husk/mcp`** — M7 (launch prep).
- **Cookie / SSO / MFA tools** in MCP — v0.2 (auth pillar).
- **Replacing all 20 upstream tools' descriptions** with custom Husk-written text — out of scope; the "Husk — " prefix is the v0 branding move.
- **Refactoring the duplicated `binary.ts`** into `@husk/shared` — v0.1.

After this plan ships, the next plan is **back to Plan #3 (M2 production)** — the orchestrator-side adapter. Both `mcp` and `orchestrator` will exist as functional workspace packages by the end of M2 production; M3 wires them into the public HTTP API.
