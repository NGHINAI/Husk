import { describe, it, expect, vi } from "vitest";
import { spawnChromeEngine } from "../../src/engine/chrome-engine.js";

describe("spawnChromeEngine", () => {
  it("throws when no Chrome found on the machine", async () => {
    // Stub findChrome to return null
    const mockedModule = await import("../../src/handoff/chrome-launcher.js");
    vi.spyOn(mockedModule, "findChrome").mockReturnValueOnce(null);
    await expect(spawnChromeEngine("test-session")).rejects.toThrow(/chrome/i);
  });

  it("returns a handle with cdp, port, profileDir, kill, release (shape parity with lightpanda)", async () => {
    // Smoke test — requires HUSK_SMOKE_CHROME=1 + real Chrome
    if (!process.env.HUSK_SMOKE_CHROME) return;
    const handle = await spawnChromeEngine("smoke-test");
    expect(handle.cdp).toBeDefined();
    expect(typeof handle.port).toBe("number");
    expect(typeof handle.profileDir).toBe("string");
    expect(typeof handle.kill).toBe("function");
    expect(typeof handle.release).toBe("function");
    await handle.release();
  }, 30_000);

  it("release() kills the process AND deletes the profile dir", async () => {
    if (!process.env.HUSK_SMOKE_CHROME) return;
    const { existsSync } = await import("node:fs");
    const handle = await spawnChromeEngine("smoke-release");
    const profileDir = handle.profileDir;
    expect(existsSync(profileDir)).toBe(true);
    await handle.release();
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(profileDir)).toBe(false);
  }, 30_000);

  it("kill() terminates the process but leaves the profile dir for inspection", async () => {
    if (!process.env.HUSK_SMOKE_CHROME) return;
    const { existsSync } = await import("node:fs");
    const handle = await spawnChromeEngine("smoke-kill");
    const profileDir = handle.profileDir;
    await handle.kill();
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(profileDir)).toBe(true);
    // Cleanup manually
    const { rm } = await import("node:fs/promises");
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }, 30_000);

  it("headless: false respects opts (smoke; visual confirmation only)", async () => {
    if (!process.env.HUSK_SMOKE_CHROME) return;
    const handle = await spawnChromeEngine("smoke-headed", { headless: false });
    // Just verify it spawned and can be released
    expect(handle.cdp).toBeDefined();
    await handle.release();
  }, 30_000);
});
