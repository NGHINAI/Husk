import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialsStore } from "../../src/credentials/store.js";

describe("CredentialsStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-creds-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a per-profile .db file with 0600 mode", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "github.com", username: "demo", password: "x" });
    const file = join(dir, "default.db");
    expect(existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    store.close();
  });

  it("upserts by key", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "github.com", username: "v1", password: "p1" });
    store.set("default", { key: "github.com", username: "v2", password: "p2" });
    const got = store.get("default", "github.com");
    expect(got?.username).toBe("v2");
    expect(got?.password).toBe("p2");
    store.close();
  });

  it("get returns null for unknown key", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    expect(store.get("default", "missing")).toBeNull();
    store.close();
  });

  it("get returns null for unknown profile", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    expect(store.get("never-created", "github.com")).toBeNull();
    store.close();
  });

  it("list returns all credentials for a profile (without passwords)", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "a", username: "ua", password: "pa" });
    store.set("default", { key: "b", username: "ub", password: "pb" });
    const got = store.list("default");
    expect(got.length).toBe(2);
    expect(got.map((c) => c.key).sort()).toEqual(["a", "b"]);
    for (const c of got) {
      expect("password" in c).toBe(false);
      expect("totp_secret" in c).toBe(false);
    }
    store.close();
  });

  it("remove deletes one credential", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "a", username: "ua", password: "1" });
    store.set("default", { key: "b", username: "ub", password: "2" });
    store.remove("default", "a");
    const remaining = store.list("default").map((c) => c.key);
    expect(remaining).toEqual(["b"]);
    store.close();
  });

  it("listProfiles enumerates profile DB files", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "a", username: "u", password: "p" });
    store.set("work", { key: "b", username: "u", password: "p" });
    expect(store.listProfiles().sort()).toEqual(["default", "work"]);
    store.close();
  });

  it("encrypts password + totp_secret at rest when HUSK_VAULT_KEY is set", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const s1 = new CredentialsStore({ credentialsDir: dir, encryptionKey: key });
    s1.set("default", { key: "github.com", username: "demo", password: "secret", totp_secret: "ABCD1234" });
    s1.close();

    const s2 = new CredentialsStore({ credentialsDir: dir, encryptionKey: key });
    const got = s2.get("default", "github.com");
    expect(got?.password).toBe("secret");
    expect(got?.totp_secret).toBe("ABCD1234");
    s2.close();
  });

  it("encrypted creds are unreadable with a different key", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "husk-creds2-"));
    try {
      const k1 = Buffer.alloc(32, 1).toString("base64");
      const k2 = Buffer.alloc(32, 2).toString("base64");
      const s1 = new CredentialsStore({ credentialsDir: dir2, encryptionKey: k1 });
      s1.set("default", { key: "x", username: "u", password: "secret" });
      s1.close();
      const s2 = new CredentialsStore({ credentialsDir: dir2, encryptionKey: k2 });
      expect(() => s2.get("default", "x")).toThrow();
      s2.close();
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("close is idempotent", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
