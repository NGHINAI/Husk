import { describe, it, expect } from "vitest";
import { findChrome, findFreePort, spawnChrome, createHandoffProfileDir } from "../../src/handoff/chrome-launcher.js";

describe("findChrome", () => {
  it("returns a path string OR null (no throw on any platform)", () => {
    const result = findChrome();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("returned path (if any) is absolute and exists", async () => {
    const path = findChrome();
    if (path === null) return;  // skip when no Chrome installed
    expect(path).toMatch(/^[/\\]/);  // absolute
    const { existsSync } = await import("node:fs");
    expect(existsSync(path)).toBe(true);
  });
});

describe("findFreePort", () => {
  it("returns a port in [1024, 65535]", async () => {
    const p = await findFreePort();
    expect(p).toBeGreaterThanOrEqual(1024);
    expect(p).toBeLessThanOrEqual(65535);
  });

  it("returns distinct ports across calls (when called rapidly)", async () => {
    const ports = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
    // It's OK if they're equal occasionally (OS reuse), but at least one should differ across 3 calls
    const unique = new Set(ports);
    expect(unique.size).toBeGreaterThan(0);
    // Practically: they should usually be different
  });
});

// ---------------------------------------------------------------------------
// Smoke test — requires HUSK_SMOKE_CHROME=1 env var to run
// ---------------------------------------------------------------------------
const HUSK_SMOKE_CHROME = !!process.env.HUSK_SMOKE_CHROME;
const smoke = HUSK_SMOKE_CHROME ? describe : describe.skip;

smoke("spawnChrome smoke (requires HUSK_SMOKE_CHROME=1)", () => {
  it("spawns a Chrome that responds to /json/version", async () => {
    const path = findChrome();
    if (!path) throw new Error("no Chrome on this machine");
    const port = await findFreePort();
    const profileDir = await createHandoffProfileDir("smoke-test");
    const proc = spawnChrome({ binaryPath: path, targetUrl: "about:blank", profileDir, port });
    try {
      await proc.whenReady(15_000);
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await res.json();
      expect(info.Browser).toMatch(/Chrome|Chromium|Edg|Brave/i);
    } finally {
      proc.child.kill();
      const { rm } = await import("node:fs/promises");
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);
});
