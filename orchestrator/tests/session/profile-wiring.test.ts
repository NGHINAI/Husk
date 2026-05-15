import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultStore } from "../../src/vault/store.js";
import { Session } from "../../src/session/session.js";

describe("Session profile wiring", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-vault-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores cookies from vault on Session.create({profile})", async () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("work", [{
      name: "sid", value: "x", domain: "ex.test", path: "/",
      expires: -1, size: 1, httpOnly: false, secure: false, session: true,
    }]);

    const cdpCalls: Array<{ method: string }> = [];
    const cdp = { send: vi.fn(async (m: string) => { cdpCalls.push({ method: m }); return null; }) };

    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
      vault: store,
      profile: "work",
    });
    await sess.restoreFromVault();
    expect(cdpCalls.some((c) => c.method === "Network.setCookies")).toBe(true);
    store.close();
  });

  it("captures cookies to vault on Session.close()", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Network.getAllCookies") {
          return { cookies: [{
            name: "after", value: "1", domain: "ex.test", path: "/",
            expires: 4000000000, size: 1, httpOnly: false, secure: false, session: false,
          }] };
        }
        return null;
      }),
    };
    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
      vault: store,
      profile: "default",
    });
    await sess.close();
    expect(store.list("default").find((c) => c.name === "after")).toBeDefined();
    store.close();
  });

  it("does NOT touch vault when profile is undefined", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = { send: vi.fn(async () => null) };
    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
      vault: store,
      profile: undefined,
    });
    await sess.restoreFromVault();
    await sess.close();
    expect(store.listProfiles()).toEqual([]);
    store.close();
  });

  it("getProfile returns the bound profile name or null", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = { send: vi.fn(async () => null) };
    const a = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1", vault: store, profile: "work" });
    const b = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s2", vault: store });
    expect(a.getProfile()).toBe("work");
    expect(b.getProfile()).toBeNull();
    store.close();
  });

  it("Session.create options accept profile (compile-time)", () => {
    type Options = Parameters<typeof Session.create>[0];
    const _t: Options = { profile: "work" };
    void _t;
    expect(true).toBe(true);
  });
});
