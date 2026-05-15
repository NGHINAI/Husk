import { describe, expect, it, vi } from "vitest";
import { restoreCookies } from "../../src/vault/restore.js";
import type { Cookie } from "../../src/vault/types.js";

/** Session cookie (default). */
const c = (name: string): Cookie => ({
  name, value: "v", domain: "x.test", path: "/",
  expires: -1, size: 1, httpOnly: false, secure: false, session: true, sameSite: "Lax",
});

/** Persistent cookie with a future expires. */
const persistent = (name: string, expires: number): Cookie => ({
  name, value: "v", domain: "x.test", path: "/",
  expires, size: 1, httpOnly: false, secure: false, session: false, sameSite: "Lax",
});

describe("restoreCookies", () => {
  it("calls Network.setCookies with sanitised cookies (size/session stripped)", async () => {
    const cdp = { send: vi.fn(async () => null) };
    await restoreCookies(cdp as any, "sess1", [c("a"), c("b")]);
    expect(cdp.send).toHaveBeenCalledOnce();
    const sent = (cdp.send.mock.calls[0][1] as { cookies: Array<Record<string, unknown>> }).cookies;
    for (const out of sent) {
      // size and session are output-only on Network.Cookie; must NOT appear in setCookies input
      expect("size" in out).toBe(false);
      expect("session" in out).toBe(false);
    }
  });

  it("is a no-op when given empty array", async () => {
    const cdp = { send: vi.fn(async () => null) };
    await restoreCookies(cdp as any, "sess1", []);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it("strips undefined optional fields before sending", async () => {
    const cdp = { send: vi.fn(async () => null) };
    const withUndefined: Cookie = { ...c("a"), sameSite: undefined, url: undefined };
    await restoreCookies(cdp as any, "sess1", [withUndefined]);
    const sent = (cdp.send.mock.calls[0][1] as { cookies: object[] }).cookies[0] as Record<string, unknown>;
    expect("sameSite" in sent).toBe(false);
    expect("url" in sent).toBe(false);
  });

  it("OMITS `expires` for session cookies (captured with expires=-1)", async () => {
    // Regression test for the bug found in M8b live testing: passing
    // expires=-1 to CDP setCookies makes lightpanda treat the cookie as
    // already-expired (epoch second -1 = 1969). Session cookies must omit
    // the expires field entirely so CDP creates a proper session cookie.
    const cdp = { send: vi.fn(async () => null) };
    await restoreCookies(cdp as any, "sess1", [c("session_cookie")]);
    const sent = (cdp.send.mock.calls[0][1] as { cookies: Array<Record<string, unknown>> }).cookies[0];
    expect("expires" in sent).toBe(false);
    // Required fields still present
    expect(sent.name).toBe("session_cookie");
    expect(sent.value).toBe("v");
    expect(sent.domain).toBe("x.test");
    expect(sent.path).toBe("/");
  });

  it("INCLUDES `expires` for persistent cookies with future timestamps", async () => {
    const cdp = { send: vi.fn(async () => null) };
    const future = 4000000000;
    await restoreCookies(cdp as any, "sess1", [persistent("persistent", future)]);
    const sent = (cdp.send.mock.calls[0][1] as { cookies: Array<Record<string, unknown>> }).cookies[0];
    expect(sent.expires).toBe(future);
  });

  it("treats `session: false` with `expires <= 0` as a session cookie (defensive)", async () => {
    // If a cookie was captured with session=false but expires non-positive
    // (degenerate state from a buggy upstream), don't pass through a poison
    // value — omit expires.
    const cdp = { send: vi.fn(async () => null) };
    const degenerate: Cookie = { ...persistent("x", 0), session: false, expires: 0 };
    await restoreCookies(cdp as any, "sess1", [degenerate]);
    const sent = (cdp.send.mock.calls[0][1] as { cookies: Array<Record<string, unknown>> }).cookies[0];
    expect("expires" in sent).toBe(false);
  });
});
