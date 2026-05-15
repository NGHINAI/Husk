import { describe, expect, it, vi } from "vitest";
import { Husk } from "../src/index.js";

function makeMockFetch(routes: Record<string, (params: Record<string, unknown>) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const handler = routes[body.method];
    if (!handler) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `No: ${body.method}` } }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body.params) }),
      { status: 200 }
    );
  });
}

describe("Husk vault API", () => {
  it("createSession forwards profile param", async () => {
    let captured: unknown;
    const fetchMock = makeMockFetch({
      create_session: (p) => { captured = p; return { session_id: "s1" }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.createSession({ profile: "work" });
    expect(captured).toEqual({ profile: "work" });
  });

  it("createSession() with no arg sends empty params (no profile)", async () => {
    let captured: unknown;
    const fetchMock = makeMockFetch({
      create_session: (p) => { captured = p; return { session_id: "s1" }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.createSession();
    expect(captured).toEqual({});
  });

  it("h.vault.listProfiles calls vault_list_profiles and returns profiles", async () => {
    const fetchMock = makeMockFetch({
      vault_list_profiles: () => ({ profiles: ["default", "work"] }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const got = await h.vault.listProfiles();
    expect(got).toEqual(["default", "work"]);
  });

  it("h.vault.listCookies(profile) calls vault_list_cookies", async () => {
    const fetchMock = makeMockFetch({
      vault_list_cookies: (p) => {
        expect(p).toEqual({ profile: "work" });
        return { cookies: [{ name: "sid", value: "x", domain: "ex.test", path: "/", expires: -1, size: 3, httpOnly: false, secure: false, session: true }] };
      },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const got = await h.vault.listCookies("work");
    expect(got[0].name).toBe("sid");
  });

  it("h.vault.clear(profile) calls vault_clear", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fetchMock = makeMockFetch({
      vault_clear: (p) => { calls.push({ method: "vault_clear", params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.vault.clear("work");
    expect(calls[0].params).toEqual({ profile: "work" });
  });
});
