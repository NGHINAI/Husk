import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VaultStore } from "../../src/vault/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const huskBin = join(__dirname, "..", "..", "dist", "index.js");

function runHusk(args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [huskBin, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("husk vault CLI", () => {
  it("husk vault list shows seeded profiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-vault-"));
    try {
      const s = new VaultStore({ vaultDir: dir });
      s.put("default", [{ name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
      s.put("work", [{ name: "b", value: "2", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
      s.close();
      const r = runHusk(["vault", "list"], { HUSK_VAULT_DIR: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/default/);
      expect(r.stdout).toMatch(/work/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk vault clear <profile> empties the profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-vault-"));
    try {
      const s = new VaultStore({ vaultDir: dir });
      s.put("default", [{ name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
      s.close();
      const r = runHusk(["vault", "clear", "default"], { HUSK_VAULT_DIR: dir });
      expect(r.status).toBe(0);
      const verify = new VaultStore({ vaultDir: dir });
      expect(verify.list("default")).toEqual([]);
      verify.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk vault clear without a profile exits non-zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-vault-"));
    try {
      const r = runHusk(["vault", "clear"], { HUSK_VAULT_DIR: dir });
      expect(r.status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
