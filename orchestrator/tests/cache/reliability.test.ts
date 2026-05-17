import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("SiteGraphCache reliability", () => {
  let cache: SiteGraphCache;
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "husk-cache-"));
    cache = new SiteGraphCache({ cacheDir });
  });

  afterEach(() => {
    cache.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("reliability returns 0.5 for unseen stable_id (neutral prior)", () => {
    expect(cache.reliability("example.com", "unknown")).toBeCloseTo(0.5);
  });

  it("recordSuccess increases reliability toward 1.0", () => {
    cache.recordSuccess("example.com", "btn1");
    cache.recordSuccess("example.com", "btn1");
    expect(cache.reliability("example.com", "btn1")).toBe(1.0);
  });

  it("recordFailure decreases reliability toward 0.0", () => {
    cache.recordSuccess("example.com", "btn1");
    cache.recordFailure("example.com", "btn1");
    cache.recordFailure("example.com", "btn1");
    expect(cache.reliability("example.com", "btn1")).toBeCloseTo(1 / 3);
  });

  it("counts are scoped per-domain (no leak across domains)", () => {
    cache.recordSuccess("a.com", "btn");
    cache.recordSuccess("a.com", "btn");
    cache.recordFailure("b.com", "btn");
    expect(cache.reliability("a.com", "btn")).toBe(1.0);
    expect(cache.reliability("b.com", "btn")).toBe(0);
  });
});
