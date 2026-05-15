import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/session/session.js";
import { VaultStore } from "../../src/vault/store.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startLoginFixture } from "./login-fixture-server.js";

const integrationOrSkip = await (async () => {
  try { await locateLightpanda(); return describe; } catch { return describe.skip; }
})();

integrationOrSkip("vault e2e — login round-trip", () => {
  it("cookies captured on close are restored on next Session.create({profile})", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "husk-vault-e2e-"));
    const vault = new VaultStore({ vaultDir });
    const fixture = await startLoginFixture();

    try {
      // First session: emulate a successful login by setting the cookie via CDP
      // (Husk's SDK doesn't have a form-submit primitive in M8a; M8b adds it).
      let s1: Session | undefined;
      try {
        s1 = await Session.create({
          readinessTimeoutMs: 15_000,
          vault,
          profile: "demo",
        });
        await s1.goto(fixture.url);
        // Set the session cookie via CDP — what /login POST would have done server-side.
        // @ts-expect-error reaching private fields for test setup
        await (s1 as unknown as { cdp: { send: (m: string, p: Record<string, unknown>, sid: string) => Promise<unknown> }; sessionId: string })
          .cdp.send("Network.setCookies", {
            cookies: [{
              name: "husk_demo_session",
              value: "valid",
              domain: "127.0.0.1",
              path: "/",
              expires: 4000000000,
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            }],
          // @ts-expect-error reaching private fields for test setup
          }, (s1 as unknown as { sessionId: string }).sessionId);
        await s1.goto(`${fixture.url}/protected`);
        const snap1 = await s1.snapshot();
        const hasWelcome = JSON.stringify(snap1).includes("Welcome back");
        expect(hasWelcome).toBe(true);
      } finally {
        await s1?.close();
      }

      // Vault should now have husk_demo_session for 127.0.0.1.
      const stored = vault.list("demo");
      const restored = stored.find((c) => c.name === "husk_demo_session" && c.value === "valid");
      expect(restored).toBeDefined();

      // Second session: NO manual cookie. Restored from vault should yield logged-in /protected.
      let s2: Session | undefined;
      try {
        s2 = await Session.create({
          readinessTimeoutMs: 15_000,
          vault,
          profile: "demo",
        });
        await s2.goto(`${fixture.url}/protected`);
        const snap2 = await s2.snapshot();
        expect(JSON.stringify(snap2).includes("Welcome back")).toBe(true);
      } finally {
        await s2?.close();
      }
    } finally {
      await fixture.close();
      vault.close();
      rmSync(vaultDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a session without profile gets a clean cookie jar (no restoration)", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "husk-vault-no-restore-"));
    const vault = new VaultStore({ vaultDir });
    const fixture = await startLoginFixture();

    try {
      // Seed the vault with a session cookie
      vault.put("demo", [{
        name: "husk_demo_session", value: "valid",
        domain: "127.0.0.1", path: "/",
        expires: 4000000000, size: 24,
        httpOnly: true, secure: false, session: false, sameSite: "Lax",
      }]);

      // Session WITHOUT profile must NOT see the cookie → expect Unauthorized
      let s: Session | undefined;
      try {
        s = await Session.create({ readinessTimeoutMs: 15_000, vault });
        await s.goto(`${fixture.url}/protected`);
        const snap = await s.snapshot();
        const snapStr = JSON.stringify(snap);
        // Lightpanda's AX tree may be sparse for non-200 pages, so we use a
        // negative assertion: the authenticated "Welcome back" heading must NOT
        // appear. That is the true invariant — no restored cookie = no access.
        expect(snapStr.includes("Welcome back")).toBe(false);
      } finally {
        await s?.close();
      }
    } finally {
      await fixture.close();
      vault.close();
      rmSync(vaultDir, { recursive: true, force: true });
    }
  }, 60_000);
});
