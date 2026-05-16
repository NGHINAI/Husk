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

  it("session.click({stable_id}) returns ActionResult — successful path carries warnings", async () => {
    const h = new Husk({
      baseUrl: "http://x.test",
      fetch: makeMockFetch({
        create_session: () => ({ session_id: "s1" }),
        click: () => ({ ok: true, warnings: [] }),
      }) as unknown as typeof fetch,
    });
    const s = await h.createSession();
    const r: ActionResult = await s.click({ stable_id: "button:ok" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it("session.click({intent}) forwards intent in JSON-RPC params", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const h = new Husk({
      baseUrl: "http://x.test",
      fetch: makeMockFetch({
        create_session: () => ({ session_id: "s1" }),
        click: (p) => { calls.push({ method: "click", params: p }); return { ok: true, warnings: [] }; },
      }) as unknown as typeof fetch,
    });
    const s = await h.createSession();
    await s.click({ intent: "sign in button" });
    expect(calls[0].params).toMatchObject({ session_id: "s1", intent: "sign in button" });
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
    const r = await s.click({ stable_id: "button:ghost" });
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
    await s.type({ stable_id: "textbox:e" }, "hi");
    await s.scroll({ stable_id: null }, "down", 300);
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
