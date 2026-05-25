import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultStore } from "../../src/vault/store.js";
import { Session } from "../../src/session/session.js";

describe("Session auto-save on close and handoff", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-autosave-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("Test 1: Session.close() with profile + cookies → vault has the cookies after close", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Network.getAllCookies") {
          return {
            cookies: [
              {
                name: "test_cookie",
                value: "test_value",
                domain: "ex.test",
                path: "/",
                expires: 4000000000,
                size: 10,
                httpOnly: false,
                secure: false,
                session: false,
              },
            ],
          };
        }
        return null;
      }),
    };

    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
      vault: store,
      profile: "test_profile",
    });

    // Close the session — auto-save should capture cookies to vault
    await sess.close();

    // Verify vault has the captured cookies
    const vaultCookies = store.list("test_profile");
    expect(vaultCookies.find((c) => c.name === "test_cookie")).toBeDefined();
    expect(vaultCookies.find((c) => c.name === "test_cookie")?.value).toBe(
      "test_value"
    );
    store.close();
  });

  it("Test 2: Session.close() without profile → no save, no error", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Network.getAllCookies") {
          return {
            cookies: [
              {
                name: "should_not_save",
                value: "value",
                domain: "ex.test",
                path: "/",
                expires: 4000000000,
                size: 5,
                httpOnly: false,
                secure: false,
                session: false,
              },
            ],
          };
        }
        return null;
      }),
    };

    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s2",
      vault: store,
      // profile is undefined
    });

    // Close without a profile — should not error
    await sess.close();

    // Verify vault is empty
    expect(store.listProfiles()).toEqual([]);
    store.close();
  });

  it("Test 3: Session.close() with captureToVault erroring → close still succeeds", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Network.getAllCookies") {
          throw new Error("CDP error retrieving cookies");
        }
        return null;
      }),
    };

    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s3",
      vault: store,
      profile: "test_profile",
    });

    // Close should succeed even though captureToVault throws
    expect(async () => {
      await sess.close();
    }).not.toThrow();

    store.close();
  });

  it("Test 4: After seamless handoff with cookies imported → vault has imported cookies", async () => {
    const store = new VaultStore({ vaultDir: dir });

    // Create a mock session that tracks importCookies calls and returns them on getAllCookies
    const importedCookies: Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      expires: number;
      size: number;
      httpOnly?: boolean;
      secure?: boolean;
      session?: boolean;
    }> = [];
    const cdp = {
      send: vi.fn(async (method: string, params?: unknown) => {
        if (method === "Network.setCookies") {
          // When cookies are set, add them to our tracking array
          const setCookiesParams = params as {
            cookies: Array<{
              name: string;
              value: string;
              domain?: string;
              path?: string;
              expires?: number;
            }>;
          };
          for (const c of setCookiesParams.cookies || []) {
            importedCookies.push({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              expires: c.expires ?? 4000000000,
              size: (c.name.length + (c.value?.length || 0) + 13),
              httpOnly: false,
              secure: false,
              session: false,
            });
          }
          return null;
        }
        if (method === "Network.getAllCookies") {
          return { cookies: importedCookies };
        }
        return null;
      }),
    };

    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s4",
      vault: store,
      profile: "handoff_profile",
    });

    // Simulate importing cookies during handoff
    const cookiesToImport = [
      {
        name: "linkedin_sid",
        value: "abc123",
        domain: "linkedin.com",
        path: "/",
        httpOnly: true,
        secure: true,
      },
    ];
    await sess.importCookies(cookiesToImport);

    // Manually trigger auto-save (simulating post-handoff capture)
    await sess.captureToVault();

    // Verify vault has the imported cookies
    const vaultCookies = store.list("handoff_profile");
    expect(vaultCookies.find((c) => c.name === "linkedin_sid")).toBeDefined();
    expect(vaultCookies.find((c) => c.name === "linkedin_sid")?.value).toBe(
      "abc123"
    );

    store.close();
  });
});
