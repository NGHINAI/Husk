import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CredentialsStore } from "../../src/credentials/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const huskBin = join(__dirname, "..", "..", "dist", "index.js");

function runHusk(args: string[], stdin: string, env: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [huskBin, ...args], { env: { ...process.env, ...env }, encoding: "utf8", input: stdin });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("husk login CLI", () => {
  it("husk login --profile P --key K stores a credential from stdin", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-"));
    try {
      const r = runHusk(
        ["login", "--profile", "default", "--key", "github.com"],
        "demo\nsecret\n\n",
        { HUSK_CREDENTIALS_DIR: dir }
      );
      expect(r.status).toBe(0);

      const store = new CredentialsStore({ credentialsDir: dir });
      const got = store.get("default", "github.com");
      expect(got?.username).toBe("demo");
      expect(got?.password).toBe("secret");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk login captures totp_secret when supplied", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-totp-"));
    try {
      const r = runHusk(
        ["login", "--profile", "default", "--key", "x.com"],
        "user\npass\nABCD1234\n",
        { HUSK_CREDENTIALS_DIR: dir }
      );
      expect(r.status).toBe(0);
      const store = new CredentialsStore({ credentialsDir: dir });
      expect(store.get("default", "x.com")?.totp_secret).toBe("ABCD1234");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk login --list shows stored credentials for a profile (without passwords)", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-list-"));
    try {
      const store = new CredentialsStore({ credentialsDir: dir });
      store.set("default", { key: "a", username: "ua", password: "p" });
      store.set("default", { key: "b", username: "ub", password: "p" });
      store.close();
      const r = runHusk(["login", "--list", "--profile", "default"], "", { HUSK_CREDENTIALS_DIR: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/a\s+ua/);
      expect(r.stdout).toMatch(/b\s+ub/);
      expect(r.stdout).not.toMatch(/password/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk login --remove --profile P --key K deletes a credential", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-rm-"));
    try {
      const store = new CredentialsStore({ credentialsDir: dir });
      store.set("default", { key: "x", username: "u", password: "p" });
      store.close();
      const r = runHusk(["login", "--remove", "--profile", "default", "--key", "x"], "", { HUSK_CREDENTIALS_DIR: dir });
      expect(r.status).toBe(0);
      const check = new CredentialsStore({ credentialsDir: dir });
      expect(check.get("default", "x")).toBeNull();
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
