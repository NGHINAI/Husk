import { describe, expect, it, vi } from "vitest";
import { captureCookies } from "../../src/vault/capture.js";

describe("captureCookies", () => {
  it("calls Network.getAllCookies and returns the cookies array", async () => {
    const cookies = [
      { name: "sid", value: "abc", domain: "x.test", path: "/", expires: -1, size: 6, httpOnly: false, secure: false, session: true, sameSite: "Lax" },
    ];
    const cdp = { send: vi.fn(async () => ({ cookies })) };
    const got = await captureCookies(cdp as any, "sess1");
    expect(cdp.send).toHaveBeenCalledWith("Network.getAllCookies", {}, "sess1");
    expect(got).toEqual(cookies);
  });

  it("returns empty array when CDP returns no cookies field", async () => {
    const cdp = { send: vi.fn(async () => ({})) };
    const got = await captureCookies(cdp as any, "sess1");
    expect(got).toEqual([]);
  });

  it("propagates CDP errors", async () => {
    const cdp = { send: vi.fn(async () => { throw new Error("CDP boom"); }) };
    await expect(captureCookies(cdp as any, "sess1")).rejects.toThrow(/CDP boom/);
  });
});
