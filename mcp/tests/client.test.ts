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
