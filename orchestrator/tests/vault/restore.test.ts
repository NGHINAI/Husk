import { describe, expect, it, vi } from "vitest";
import { restoreCookies } from "../../src/vault/restore.js";
import type { Cookie } from "../../src/vault/types.js";

const c = (name: string): Cookie => ({
  name, value: "v", domain: "x.test", path: "/",
  expires: -1, size: 1, httpOnly: false, secure: false, session: true, sameSite: "Lax",
});

describe("restoreCookies", () => {
  it("calls Network.setCookies with the supplied cookies", async () => {
    const cdp = { send: vi.fn(async () => null) };
    await restoreCookies(cdp as any, "sess1", [c("a"), c("b")]);
    expect(cdp.send).toHaveBeenCalledWith(
      "Network.setCookies",
      { cookies: [c("a"), c("b")] },
      "sess1"
    );
  });

  it("is a no-op when given empty array", async () => {
    const cdp = { send: vi.fn(async () => null) };
    await restoreCookies(cdp as any, "sess1", []);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it("strips undefined optional fields before sending (CDP rejects unknown keys with undefined)", async () => {
    const cdp = { send: vi.fn(async () => null) };
    const withUndefined: Cookie = { ...c("a"), sameSite: undefined, url: undefined };
    await restoreCookies(cdp as any, "sess1", [withUndefined]);
    const sent = (cdp.send.mock.calls[0][1] as { cookies: object[] }).cookies[0] as Record<string, unknown>;
    expect("sameSite" in sent).toBe(false);
    expect("url" in sent).toBe(false);
  });
});
