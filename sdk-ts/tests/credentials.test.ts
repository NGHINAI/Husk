import { describe, expect, it, vi } from "vitest";
import { Husk } from "../src/index.js";

function makeMockFetch(routes: Record<string, (params: Record<string, unknown>) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const handler = routes[body.method];
    if (!handler) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `No: ${body.method}` } }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body.params) }), { status: 200 });
  });
}

describe("Husk credentials + login", () => {
  it("credentials.set calls credentials_set", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fetchMock = makeMockFetch({
      credentials_set: (p) => { calls.push({ method: "credentials_set", params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.credentials.set("default", { key: "github.com", username: "demo", password: "secret" });
    expect(calls[0].params).toEqual({ profile: "default", key: "github.com", username: "demo", password: "secret", totp_secret: undefined });
  });

  it("credentials.set forwards totp_secret when provided", async () => {
    const calls: Array<{ params: unknown }> = [];
    const fetchMock = makeMockFetch({
      credentials_set: (p) => { calls.push({ params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.credentials.set("default", { key: "x", username: "u", password: "p", totp_secret: "ABCD1234" });
    expect((calls[0].params as { totp_secret?: string }).totp_secret).toBe("ABCD1234");
  });

  it("credentials.list returns [{key, username}] entries", async () => {
    const fetchMock = makeMockFetch({
      credentials_list: () => ({ credentials: [{ key: "a", username: "ua" }, { key: "b", username: "ub" }] }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const got = await h.credentials.list("default");
    expect(got.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("credentials.remove calls credentials_remove", async () => {
    const calls: Array<{ params: unknown }> = [];
    const fetchMock = makeMockFetch({
      credentials_remove: (p) => { calls.push({ params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.credentials.remove("default", "github.com");
    expect(calls[0].params).toEqual({ profile: "default", key: "github.com" });
  });

  it("session.login(profile, key) calls login RPC and returns the result", async () => {
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "s1" }),
      login: () => ({ ok: true, url_before: "https://x/login", url_after: "https://x/dash" }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    const r = await s.login({ profile: "default", key: "github.com" });
    expect(r.ok).toBe(true);
  });

  it("session.login forwards rejection (credential_not_found) verbatim", async () => {
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "s1" }),
      login: () => ({ ok: false, reason: "credential_not_found", key: "missing" }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    const r = await s.login({ profile: "default", key: "missing" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("credential_not_found");
  });
});
