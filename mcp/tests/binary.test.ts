import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { locateLightpanda, LightpandaNotFoundError } from "../src/binary.js";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("locateLightpanda (mcp)", () => {
  let tmpDir: string;
  let fakeBin: string;
  const originalEnv = process.env.LIGHTPANDA_BIN;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "husk-mcp-bin-test-"));
    fakeBin = join(tmpDir, "lightpanda");
    writeFileSync(fakeBin, "#!/bin/sh\necho fake\n");
    chmodSync(fakeBin, 0o755);
  });

  afterEach(() => {
    process.env.LIGHTPANDA_BIN = originalEnv;
    process.env.PATH = originalPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns LIGHTPANDA_BIN when set and executable", async () => {
    process.env.LIGHTPANDA_BIN = fakeBin;
    process.env.PATH = "";
    expect(await locateLightpanda()).toBe(fakeBin);
  });

  it("falls back to PATH when LIGHTPANDA_BIN unset", async () => {
    delete process.env.LIGHTPANDA_BIN;
    process.env.PATH = tmpDir;
    expect(await locateLightpanda()).toBe(fakeBin);
  });

  it("throws LightpandaNotFoundError when neither found", async () => {
    delete process.env.LIGHTPANDA_BIN;
    process.env.PATH = mkdtempSync(join(tmpdir(), "husk-mcp-empty-"));
    await expect(locateLightpanda()).rejects.toBeInstanceOf(LightpandaNotFoundError);
  });

  it("throws if LIGHTPANDA_BIN points to a nonexistent path", async () => {
    process.env.LIGHTPANDA_BIN = join(tmpDir, "does-not-exist");
    process.env.PATH = "";
    await expect(locateLightpanda()).rejects.toBeInstanceOf(LightpandaNotFoundError);
  });
});
