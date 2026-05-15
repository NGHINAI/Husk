import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { JsonRpcClient, JsonRpcTransportError, HuskApiError } from "../src/transport.js";

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

  it("throws HuskApiError on JSON-RPC error envelope, carrying code + message", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Session not found: x" } }), { status: 200 })
    ) as unknown as typeof fetch;
    const c = new JsonRpcClient({ baseUrl: "http://x.test" });
    await expect(c.call("goto", { session_id: "x", url: "http://y" })).rejects.toThrow(/Session not found/);
    try {
      await c.call("goto", { session_id: "x", url: "http://y" });
    } catch (e) {
      expect(e).toBeInstanceOf(HuskApiError);
      expect((e as HuskApiError).code).toBe(-32001);
    }
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
