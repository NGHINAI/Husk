import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/session/session.js";
import { VaultStore } from "../../src/vault/store.js";
import { CredentialsStore } from "../../src/credentials/store.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startLoginFixture } from "./login-fixture-server.js";

const integrationOrSkip = await (async () => {
  try { await locateLightpanda(); return describe; } catch { return describe.skip; }
})();

integrationOrSkip("login real-e2e — Session.login drives the form", () => {
  it("logs in by submitting the form with stored credentials", async () => {
    const root = mkdtempSync(join(tmpdir(), "husk-login-e2e-"));
    const vault = new VaultStore({ vaultDir: join(root, "vault") });
    const creds = new CredentialsStore({ credentialsDir: join(root, "creds") });
    const fixture = await startLoginFixture();

    try {
      creds.set("default", { key: "fixture", username: "demo", password: "secret" });
      const stored = creds.get("default", "fixture")!;

      let session: Session | undefined;
      try {
        session = await Session.create({
          readinessTimeoutMs: 15_000,
          vault,
          profile: "default",
        });
        await session.goto(fixture.url);
        const r = await session.login({ username: stored.username, password: stored.password });
        expect(r.ok).toBe(true);
        if (r.ok) {
          // URL should have moved off /login (303 redirect followed to /protected)
          expect(r.url_after).not.toBe(r.url_before);
        }
      } finally {
        await session?.close();
      }
      const cookies = vault.list("default");
      expect(cookies.find((c) => c.name === "husk_demo_session")).toBeDefined();
    } finally {
      await fixture.close();
      vault.close();
      creds.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("login returns ok:false for wrong credentials", async () => {
    const root = mkdtempSync(join(tmpdir(), "husk-login-bad-"));
    const vault = new VaultStore({ vaultDir: join(root, "vault") });
    const fixture = await startLoginFixture();

    try {
      let session: Session | undefined;
      try {
        session = await Session.create({ readinessTimeoutMs: 15_000, vault });
        await session.goto(fixture.url);
        const r = await session.login({ username: "demo", password: "WRONG" });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          // Either login_did_not_advance (still on /login) or login_form_not_found
          // (server returned a 401 page with no form).
          expect(["login_did_not_advance", "login_form_not_found"]).toContain(r.reason);
        }
      } finally {
        await session?.close();
      }
    } finally {
      await fixture.close();
      vault.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
