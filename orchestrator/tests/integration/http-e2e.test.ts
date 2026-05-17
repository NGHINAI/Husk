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
      expect(gotoRes.result).toMatchObject({ ok: true });

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
