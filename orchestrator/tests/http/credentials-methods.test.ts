import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import { CredentialsStore } from "../../src/credentials/store.js";
import { VaultStore } from "../../src/vault/store.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(creds: CredentialsStore, vault: VaultStore, sessionLogin?: (input: any) => Promise<any>) {
  const sm = new SessionManager(async () => ({
    close: async () => {},
    login: sessionLogin ?? (async () => ({ ok: true, url_before: "a", url_after: "b" })),
  }) as unknown as Session);
  return { sessions: sm, version: "0.0.0", vault, credentials: creds };
}

describe("HTTP credentials methods", () => {
  let dir: string;
  let creds: CredentialsStore;
  let vault: VaultStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-creds-http-"));
    creds = new CredentialsStore({ credentialsDir: join(dir, "creds") });
    vault = new VaultStore({ vaultDir: join(dir, "vault") });
  });
  afterEach(() => {
    creds.close();
    vault.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("credentials_set stores a credential under profile + key", async () => {
    const ctx = makeCtx(creds, vault);
    await METHODS.credentials_set({ profile: "default", key: "github.com", username: "demo", password: "secret" }, ctx);
    const got = creds.get("default", "github.com");
    expect(got?.username).toBe("demo");
    expect(got?.password).toBe("secret");
  });

  it("credentials_set accepts optional totp_secret", async () => {
    const ctx = makeCtx(creds, vault);
    await METHODS.credentials_set({ profile: "default", key: "x", username: "u", password: "p", totp_secret: "ABCD1234" }, ctx);
    expect(creds.get("default", "x")?.totp_secret).toBe("ABCD1234");
  });

  it("credentials_list returns { key, username } pairs (no passwords)", async () => {
    creds.set("default", { key: "a", username: "ua", password: "pa" });
    creds.set("default", { key: "b", username: "ub", password: "pb" });
    const ctx = makeCtx(creds, vault);
    const r = (await METHODS.credentials_list({ profile: "default" }, ctx)) as { credentials: Array<{ key: string; username: string; password?: string }> };
    expect(r.credentials.length).toBe(2);
    for (const c of r.credentials) expect(c.password).toBeUndefined();
  });

  it("credentials_remove deletes by key", async () => {
    creds.set("default", { key: "a", username: "ua", password: "pa" });
    creds.set("default", { key: "b", username: "ub", password: "pb" });
    const ctx = makeCtx(creds, vault);
    await METHODS.credentials_remove({ profile: "default", key: "a" }, ctx);
    expect(creds.list("default").map((c) => c.key)).toEqual(["b"]);
  });

  it("credentials_list_profiles enumerates profile DB files", async () => {
    creds.set("default", { key: "a", username: "u", password: "p" });
    creds.set("work", { key: "b", username: "u", password: "p" });
    const ctx = makeCtx(creds, vault);
    const r = (await METHODS.credentials_list_profiles({}, ctx)) as { profiles: string[] };
    expect(r.profiles.sort()).toEqual(["default", "work"]);
  });

  it("login looks up credentials by profile+key and forwards to Session.login", async () => {
    creds.set("default", { key: "github.com", username: "demo", password: "secret" });
    const loginSpy = vi.fn(async () => ({ ok: true, url_before: "https://x", url_after: "https://x/dash" }));
    const sm = new SessionManager(async () => ({
      close: async () => {},
      login: loginSpy,
    }) as unknown as Session);
    const ctx = { sessions: sm, version: "0.0.0", vault, credentials: creds };
    const sid = await sm.create();
    const r = await METHODS.login({ session_id: sid, profile: "default", key: "github.com" }, ctx);
    expect((r as { ok: boolean }).ok).toBe(true);
    expect(loginSpy).toHaveBeenCalledWith({
      username: "demo", password: "secret", totp_secret: undefined,
    });
  });

  it("login returns ok:false with reason=credential_not_found when key absent", async () => {
    const ctx = makeCtx(creds, vault);
    const sid = await ctx.sessions.create();
    const r = (await METHODS.login({ session_id: sid, profile: "default", key: "missing.com" }, ctx)) as { ok: boolean; reason: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("credential_not_found");
  });
});
