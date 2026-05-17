import { describe, expect, it } from "vitest";
import { dispatch } from "../../src/http/jsonrpc.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";
import type { MethodContext } from "../../src/http/methods.js";

function fakeSessionMgr(): SessionManager {
  return new SessionManager(async () => ({
    goto: async () => ({ ok: true as const }),
    snapshot: async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } }),
    snapshotDiff: async () => null,
    close: async () => {},
  } as unknown as Session));
}

function ctx(): MethodContext {
  return { sessions: fakeSessionMgr(), version: "0.0.0-test", vault: { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any, credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any };
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
    expect(goto_res.result).toMatchObject({ ok: true });
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
