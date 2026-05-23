/**
 * M17 engine routing integration smoke test.
 *
 * Gates:
 *  - HUSK_INT=1        — integration tests enabled (requires built dist + lightpanda)
 *  - HUSK_SMOKE_CHROME=1 — also require Chrome to be available on this machine
 *
 * Run:
 *   HUSK_INT=1 HUSK_SMOKE_CHROME=1 pnpm --filter husk-orchestrator test tests/integration/m17-engine-routing.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { findChrome } from "../../src/handoff/chrome-launcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUSK_BIN = resolve(__dirname, "../../dist/index.js");

const HUSK_INT = !!process.env.HUSK_INT;
const HUSK_SMOKE_CHROME = !!process.env.HUSK_SMOKE_CHROME;
const CHROME_AVAILABLE = HUSK_SMOKE_CHROME && findChrome() !== null;

const d = HUSK_INT && CHROME_AVAILABLE ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForUp(url: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "health" }),
      });
      const j = (await r.json()) as { result?: unknown };
      if (j.result) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`husk server not ready after ${timeoutMs}ms`);
}

async function rpc(port: number, method: string, params: unknown = {}): Promise<unknown> {
  const url = `http://127.0.0.1:${port}/v1/jsonrpc`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.random(), method, params }),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`RPC ${method} error: ${JSON.stringify(j.error)}`);
  return j.result;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d(
  "M17 engine routing e2e (requires HUSK_INT=1 + HUSK_SMOKE_CHROME=1 + Chrome installed)",
  () => {
    let child: ChildProcess;
    let port: number;

    beforeAll(async () => {
      port = 17800 + Math.floor(Math.random() * 200);
      child = spawn(
        "node",
        [HUSK_BIN, "start", "--port", String(port), "--log-level", "silent"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      await waitForUp(`http://127.0.0.1:${port}/v1/jsonrpc`);
    }, 60_000);

    afterAll(async () => {
      if (child) {
        child.kill("SIGTERM");
        await new Promise((r) => child.once("exit", r));
      }
    });

    it("engine: 'chrome' creates a session that uses Chrome from the start", async () => {
      const session = (await rpc(port, "create_session", { engine: "chrome" })) as {
        session_id: string;
      };
      expect(session.session_id).toBeTruthy();

      const gotoResult = (await rpc(port, "goto", {
        session_id: session.session_id,
        url: "https://example.com/",
      })) as { ok: boolean; snapshot?: { engine?: string } };

      expect(gotoResult.ok).toBe(true);
      expect(gotoResult.snapshot?.engine).toBe("chrome");

      // No fallback fields — chrome was chosen from the start
      expect((gotoResult as Record<string, unknown>).fellback_from).toBeUndefined();

      await rpc(port, "close_session", { session_id: session.session_id });
    }, 60_000);

    it("engine: 'lightpanda' forces lightpanda, no fallback", async () => {
      const session = (await rpc(port, "create_session", { engine: "lightpanda" })) as {
        session_id: string;
      };
      const gotoResult = (await rpc(port, "goto", {
        session_id: session.session_id,
        url: "https://example.com/",
      })) as { ok: boolean; snapshot?: { engine?: string } };

      expect(gotoResult.ok).toBe(true);
      expect(gotoResult.snapshot?.engine).toBe("lightpanda");
      // Explicit lightpanda never falls back
      expect((gotoResult as Record<string, unknown>).fellback_from).toBeUndefined();

      await rpc(port, "close_session", { session_id: session.session_id });
    }, 60_000);

    it("engine: 'auto' on a simple site stays on lightpanda (no fallback)", async () => {
      const session = (await rpc(port, "create_session", { engine: "auto" })) as {
        session_id: string;
      };
      const gotoResult = (await rpc(port, "goto", {
        session_id: session.session_id,
        url: "https://example.com/",
      })) as { ok: boolean; snapshot?: { engine?: string } };

      expect(gotoResult.ok).toBe(true);
      // example.com is server-rendered — lightpanda handles it fine
      expect(gotoResult.snapshot?.engine).toBe("lightpanda");
      expect((gotoResult as Record<string, unknown>).fellback_from).toBeUndefined();

      await rpc(port, "close_session", { session_id: session.session_id });
    }, 60_000);

    // NOTE: A "fallback actually fires" test would require a site that reliably
    // produces an empty AX tree on lightpanda. That's deferred to a controlled
    // fixture test — the unit tests in T6 already cover the fallback decision
    // logic. This suite primarily verifies the wiring is live end-to-end.
  },
);
