import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultStore } from "../../src/vault/store.js";
import type { Cookie } from "../../src/vault/types.js";

function cookie(name: string, value: string, domain = "example.com"): Cookie {
  return {
    name, value, domain, path: "/",
    expires: 4000000000, // year ~2096
    size: name.length + value.length,
    httpOnly: false, secure: true, session: false, sameSite: "Lax",
  };
}

describe("VaultStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-vault-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a per-profile .db file with 0600 mode on Linux/macOS", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("sid", "abc")]);
    const file = join(dir, "default.db");
    expect(existsSync(file)).toBe(true);
    const mode = statSync(file).mode & 0o777;
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
    store.close();
  });

  it("upserts cookies by (name, domain, path) primary key", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("sid", "v1"), cookie("sid", "v2")]);
    const got = store.list("default");
    expect(got.length).toBe(1);
    expect(got[0].value).toBe("v2");
    store.close();
  });

  it("returns empty array for unknown profile", () => {
    const store = new VaultStore({ vaultDir: dir });
    expect(store.list("never-created")).toEqual([]);
    store.close();
  });

  it("clear() removes all cookies for the profile", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("a", "1"), cookie("b", "2")]);
    store.clear("default");
    expect(store.list("default")).toEqual([]);
    store.close();
  });

  it("remove(profile, name, domain, path) deletes one cookie", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("a", "1"), cookie("b", "2")]);
    store.remove("default", { name: "a", domain: "example.com", path: "/" });
    const got = store.list("default");
    expect(got.length).toBe(1);
    expect(got[0].name).toBe("b");
    store.close();
  });

  it("listProfiles returns every profile that has had cookies written", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("a", "1")]);
    store.put("work", [cookie("b", "2", "work.test")]);
    expect(store.listProfiles().sort()).toEqual(["default", "work"]);
    store.close();
  });

  it("preserves sameSite Strict/Lax/None round-trip", () => {
    const store = new VaultStore({ vaultDir: dir });
    const strict: Cookie = { ...cookie("a", "1"), sameSite: "Strict" };
    const none: Cookie = { ...cookie("b", "2"), sameSite: "None" };
    store.put("default", [strict, none]);
    const got = store.list("default").sort((x, y) => x.name.localeCompare(y.name));
    expect(got[0].sameSite).toBe("Strict");
    expect(got[1].sameSite).toBe("None");
    store.close();
  });

  it("preserves session=true for expires=-1 cookies", () => {
    const store = new VaultStore({ vaultDir: dir });
    const sess: Cookie = { ...cookie("a", "1"), expires: -1, session: true };
    store.put("default", [sess]);
    const got = store.list("default");
    expect(got[0].session).toBe(true);
    expect(got[0].expires).toBe(-1);
    store.close();
  });

  it("ignores expired cookies on read (expires < now)", () => {
    const store = new VaultStore({ vaultDir: dir });
    const past: Cookie = { ...cookie("a", "1"), expires: 100, session: false };
    store.put("default", [past]);
    expect(store.list("default")).toEqual([]);
    store.close();
  });

  it("encrypts at rest when HUSK_VAULT_KEY env is set (round-trip)", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const store = new VaultStore({ vaultDir: dir, encryptionKey: key });
    store.put("default", [cookie("sid", "secret-value")]);
    store.close();

    const reopen = new VaultStore({ vaultDir: dir, encryptionKey: key });
    expect(reopen.list("default")[0].value).toBe("secret-value");
    reopen.close();
  });

  it("encrypted vault is unreadable with a different key", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "husk-vault2-"));
    try {
      const k1 = Buffer.alloc(32, 1).toString("base64");
      const k2 = Buffer.alloc(32, 2).toString("base64");
      const s1 = new VaultStore({ vaultDir: dir2, encryptionKey: k1 });
      s1.put("default", [cookie("sid", "secret")]);
      s1.close();
      const s2 = new VaultStore({ vaultDir: dir2, encryptionKey: k2 });
      expect(() => s2.list("default")).toThrow();
      s2.close();
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("close() is idempotent and safe to call multiple times", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
