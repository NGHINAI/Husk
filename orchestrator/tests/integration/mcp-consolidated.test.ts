/**
 * Integration test: MCP consolidated 8-tool surface e2e.
 *
 * Exercises the Phase F consolidated surface (T6 of M23) against a real
 * MCP subprocess + real lightpanda engine. Mirrors the spawn-and-communicate
 * pattern from mcp/tests/integration/mcp-e2e.test.ts.
 *
 * Test cases:
 *   1. Tool discovery — tools/list returns exactly 8 tools with canonical names.
 *   2. End-to-end flow — session create → goto → inspect(full) → intend(press_key) → close.
 *   3. husk_subscribe smoke — returns subscription_id + stream_url; no crash.
 *
 * Skipped when LIGHTPANDA_BIN is unset or either dist entry is missing.
 */

import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
// MCP entry lives two levels up from orchestrator/tests/integration/
const mcpEntry = join(__dirname, "..", "..", "..", "mcp", "dist", "index.js");
const orchestratorEntry = join(__dirname, "..", "..", "dist", "index.js");
const lightpandaBin = process.env.LIGHTPANDA_BIN;

// ---------------------------------------------------------------------------
// Skip guard — only run when lightpanda binary + both dist entries are present
// ---------------------------------------------------------------------------

const integrationOrSkip =
  lightpandaBin && existsSync(mcpEntry) && existsSync(orchestratorEntry)
    ? describe
    : describe.skip;

// ---------------------------------------------------------------------------
// Canonical tool list (v0.1 Phase F)
// ---------------------------------------------------------------------------

const CANONICAL_TOOLS = [
  "husk_ask_human",
  "husk_extract",
  "husk_handoff",
  "husk_inspect",
  "husk_intend",
  "husk_session",
  "husk_set_policy",
  "husk_subscribe",
];

// ---------------------------------------------------------------------------
// Fixture server — simple two-page HTML app
// ---------------------------------------------------------------------------

const PAGE_A_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Page A</title></head>
<body>
  <main>
    <h1>Page A</h1>
    <a href="/page-b" id="go-link">Go to B</a>
  </main>
</body>
</html>`;

const PAGE_B_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Page B</title></head>
<body>
  <main>
    <h1>Page B</h1>
  </main>
</body>
</html>`;

interface FixtureServer {
  port: number;
  close(): Promise<void>;
}

async function startFixture(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/page-b" || req.url?.startsWith("/page-b?")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE_B_HTML);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE_A_HTML);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// MCP subprocess helpers
// ---------------------------------------------------------------------------

function jsonRpcRequest(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

async function readUntilId(
  proc: ChildProcess,
  id: number,
  timeoutMs = 60_000,
): Promise<{ result?: unknown; error?: { message: string } }> {
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        proc.stdout?.off("data", onData);
        reject(new Error(`Timeout waiting for MCP response id=${id}`));
      }
    }, 500);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: unknown;
            error?: { message: string };
          };
          if (msg.id === id) {
            clearInterval(timer);
            proc.stdout?.off("data", onData);
            resolve({ result: msg.result, error: msg.error });
            return;
          }
        } catch {
          /* non-JSON diagnostic lines from MCP — ignore */
        }
      }
    };
    proc.stdout?.on("data", onData);
  });
}

function spawnMcp(): ChildProcess {
  return spawn("node", [mcpEntry], {
    env: {
      ...process.env,
      LIGHTPANDA_BIN: lightpandaBin,
      HUSK_ORCHESTRATOR: orchestratorEntry,
    },
    stdio: "pipe",
  });
}

/** Parse the text content from a tools/call MCP result. */
function parseToolResult(result: unknown): unknown {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

integrationOrSkip("MCP consolidated 8-tool surface e2e (Phase F)", () => {
  // ── Test 1: Tool discovery ─────────────────────────────────────────────────

  it(
    "Test 1 — tools/list returns exactly 8 tools with canonical names",
    async () => {
      const proc = spawnMcp();
      // Suppress noisy MCP stderr (orchestrator startup logs)
      proc.stderr?.resume();

      try {
        // Handshake
        proc.stdin?.write(jsonRpcRequest(1, "initialize"));
        const init = await readUntilId(proc, 1);
        expect(
          (init.result as { serverInfo?: { name?: string } }).serverInfo?.name,
        ).toBe("husk-mcp");

        // Tool discovery
        proc.stdin?.write(jsonRpcRequest(2, "tools/list"));
        const list = await readUntilId(proc, 2);

        const tools = (
          list.result as { tools: Array<{ name: string }> }
        ).tools;

        // Exactly 8 tools
        expect(tools).toHaveLength(8);

        // Names match canonical list exactly (sorted)
        const names = tools.map((t) => t.name).sort();
        expect(names).toEqual(CANONICAL_TOOLS);

        // No deprecated tools remain
        const deprecated = [
          "husk_create_session",
          "husk_close_session",
          "husk_goto",
          "husk_login",
          "husk_click",
          "husk_type",
          "husk_scroll",
          "husk_press_key",
          "husk_wait_for",
          "husk_upload",
          "husk_snapshot",
          "husk_snapshot_diff",
          "husk_resume",
          "husk_version",
          "husk_find",
          "husk_batch_visit",
          "husk_credentials_set",
          "husk_vault_list_profiles",
          "husk_vault_clear",
        ];
        for (const dep of deprecated) {
          expect(names).not.toContain(dep);
        }
      } finally {
        proc.kill("SIGTERM");
        await new Promise((r) => proc.once("exit", () => r(null)));
      }
    },
    90_000,
  );

  // ── Test 2: End-to-end flow via consolidated tools ─────────────────────────

  it(
    "Test 2 — end-to-end flow: session create → goto → inspect(full) → intend(press_key) → close",
    async () => {
      const fixture = await startFixture();
      const proc = spawnMcp();
      proc.stderr?.resume();

      try {
        // Initialize
        proc.stdin?.write(jsonRpcRequest(1, "initialize"));
        await readUntilId(proc, 1);

        // husk_session(action=create)
        proc.stdin?.write(
          jsonRpcRequest(2, "tools/call", {
            name: "husk_session",
            arguments: { action: "create" },
          }),
        );
        const createRes = await readUntilId(proc, 2);
        expect(createRes.error).toBeUndefined();
        const createData = parseToolResult(createRes.result) as {
          session_id: string;
        };
        const sessionId = createData.session_id;
        expect(typeof sessionId).toBe("string");
        expect(sessionId.length).toBeGreaterThan(0);

        // husk_session(action=goto, url=fixture/page-a)
        proc.stdin?.write(
          jsonRpcRequest(3, "tools/call", {
            name: "husk_session",
            arguments: {
              action: "goto",
              session_id: sessionId,
              url: `http://127.0.0.1:${fixture.port}/page-a`,
              include_snapshot: false,
            },
          }),
        );
        const gotoRes = await readUntilId(proc, 3);
        expect(gotoRes.error).toBeUndefined();
        const gotoData = parseToolResult(gotoRes.result) as { ok: boolean };
        expect(gotoData.ok).toBe(true);

        // husk_inspect(mode=full) — snapshot envelope must be present
        proc.stdin?.write(
          jsonRpcRequest(4, "tools/call", {
            name: "husk_inspect",
            arguments: { session_id: sessionId, mode: "full" },
          }),
        );
        const inspectRes = await readUntilId(proc, 4);
        expect(inspectRes.error).toBeUndefined();
        const snapData = parseToolResult(inspectRes.result) as {
          v: number;
          count: number;
        };
        // v=1 is the spec §5.2 snapshot version; count > 0 means AX nodes returned
        expect(snapData.v).toBe(1);
        expect(snapData.count).toBeGreaterThan(0);

        // husk_intend(verb=press_key, key=Tab) — may succeed or return ok:false;
        // what matters is it doesn't crash and returns a valid MCP content block.
        proc.stdin?.write(
          jsonRpcRequest(5, "tools/call", {
            name: "husk_intend",
            arguments: { session_id: sessionId, verb: "press_key", key: "Tab" },
          }),
        );
        const intendRes = await readUntilId(proc, 5);
        // Either ok or a structured rejection is fine — we just want a content block
        expect(intendRes.result).toBeDefined();
        const intendContent = (
          intendRes.result as { content: Array<{ type: string; text: string }> }
        ).content;
        expect(intendContent[0].type).toBe("text");
        // The text must be valid JSON
        expect(() => JSON.parse(intendContent[0].text)).not.toThrow();

        // husk_session(action=close)
        proc.stdin?.write(
          jsonRpcRequest(6, "tools/call", {
            name: "husk_session",
            arguments: { action: "close", session_id: sessionId },
          }),
        );
        const closeRes = await readUntilId(proc, 6);
        expect(closeRes.error).toBeUndefined();
        const closeData = parseToolResult(closeRes.result) as { ok: boolean };
        expect(closeData.ok).toBe(true);
      } finally {
        proc.kill("SIGTERM");
        await new Promise((r) => proc.once("exit", () => r(null)));
        await fixture.close();
      }
    },
    90_000,
  );

  // ── Test 3: husk_subscribe smoke ──────────────────────────────────────────

  it(
    "Test 3 — husk_subscribe returns subscription_id + stream_url",
    async () => {
      const proc = spawnMcp();
      proc.stderr?.resume();

      try {
        // Initialize
        proc.stdin?.write(jsonRpcRequest(1, "initialize"));
        await readUntilId(proc, 1);

        // husk_subscribe(event_type=state_change, session_id=*)
        proc.stdin?.write(
          jsonRpcRequest(2, "tools/call", {
            name: "husk_subscribe",
            arguments: { event_type: "state_change", session_id: "*" },
          }),
        );
        const subRes = await readUntilId(proc, 2);
        expect(subRes.error).toBeUndefined();

        const subData = parseToolResult(subRes.result) as {
          subscription_id: string;
          stream_url: string;
        };

        // Must have a subscription_id string
        expect(typeof subData.subscription_id).toBe("string");
        expect(subData.subscription_id.length).toBeGreaterThan(0);

        // Must have a stream_url pointing to the SSE endpoint
        expect(typeof subData.stream_url).toBe("string");
        expect(subData.stream_url).toContain("subscription_id=");
        expect(subData.stream_url).toContain("/stream/cognition");
      } finally {
        proc.kill("SIGTERM");
        await new Promise((r) => proc.once("exit", () => r(null)));
      }
    },
    90_000,
  );
});
