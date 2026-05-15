import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import { VaultStore } from "../../src/vault/store.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(vault: VaultStore) {
  let captured: { profile?: string } | undefined;
  const sm = new SessionManager(async (opts) => {
    captured = opts;
    return { close: async () => {} } as Session;
  });
  return { ctx: { sessions: sm, version: "0.0.0", vault }, getProfileArg: () => captured };
}

describe("HTTP vault methods", () => {
  let dir: string;
  let vault: VaultStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-vault-http-"));
    vault = new VaultStore({ vaultDir: dir });
  });
  afterEach(() => {
    vault.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("create_session accepts optional profile and forwards it to the factory", async () => {
    const { ctx, getProfileArg } = makeCtx(vault);
    await METHODS.create_session({ profile: "work" } as unknown as Record<string, unknown>, ctx);
    expect(getProfileArg()?.profile).toBe("work");
  });

  it("create_session without profile forwards undefined", async () => {
    const { ctx, getProfileArg } = makeCtx(vault);
    await METHODS.create_session({}, ctx);
    expect(getProfileArg()?.profile).toBeUndefined();
  });

  it("vault_list_profiles returns every profile in the vault", async () => {
    vault.put("default", [{ name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
    vault.put("work", [{ name: "b", value: "2", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
    const { ctx } = makeCtx(vault);
    const r = (await METHODS.vault_list_profiles({}, ctx)) as { profiles: string[] };
    expect(r.profiles.sort()).toEqual(["default", "work"]);
  });

  it("vault_list_cookies returns cookies for a profile", async () => {
    vault.put("default", [{ name: "sid", value: "abc", domain: "x.test", path: "/", expires: -1, size: 3, httpOnly: false, secure: false, session: true }]);
    const { ctx } = makeCtx(vault);
    const r = (await METHODS.vault_list_cookies({ profile: "default" }, ctx)) as { cookies: Array<{ name: string }> };
    expect(r.cookies.length).toBe(1);
    expect(r.cookies[0].name).toBe("sid");
  });

  it("vault_clear empties a profile", async () => {
    vault.put("default", [{ name: "sid", value: "abc", domain: "x.test", path: "/", expires: -1, size: 3, httpOnly: false, secure: false, session: true }]);
    const { ctx } = makeCtx(vault);
    await METHODS.vault_clear({ profile: "default" }, ctx);
    expect(vault.list("default")).toEqual([]);
  });

  it("vault_remove_cookie deletes by name+domain+path", async () => {
    vault.put("default", [
      { name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true },
      { name: "b", value: "2", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true },
    ]);
    const { ctx } = makeCtx(vault);
    await METHODS.vault_remove_cookie({ profile: "default", name: "a", domain: "x.test", path: "/" }, ctx);
    const remaining = vault.list("default").map((c) => c.name);
    expect(remaining).toEqual(["b"]);
  });
});
