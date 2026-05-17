import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { classifyRegion, runFind } from "../../src/session/find.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("classifyRegion", () => {
  it("top-left", () => expect(classifyRegion(0.1, 0.1)).toBe("top-left"));
  it("center", () => expect(classifyRegion(0.5, 0.5)).toBe("center"));
  it("bottom-right", () => expect(classifyRegion(0.9, 0.9)).toBe("bottom-right"));
  it("top-center on boundary", () => expect(classifyRegion(0.5, 0.2)).toBe("top-center"));
  it("center-left on boundary", () => expect(classifyRegion(0.2, 0.5)).toBe("center-left"));
});

describe("runFind reliability weighting", () => {
  let cache: SiteGraphCache;
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "husk-find-"));
    cache = new SiteGraphCache({ cacheDir });
  });

  afterEach(() => {
    cache.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("high-reliability candidate beats a slightly-higher raw-score candidate", async () => {
    // Two sign-in buttons — "h1" scores marginally higher raw but "h2" has
    // perfect reliability history. After weighting, h2 should win.
    const snapshot = {
      nodes: [
        { i: "h1", r: "button", n: "Sign In" },   // raw score will be top
        { i: "h2", r: "button", n: "Sign-in" },   // very close raw score
      ],
    };

    // Establish strong reliability for h2, none for h1.
    cache.recordSuccess("example.com", "h2");
    cache.recordSuccess("example.com", "h2");
    cache.recordSuccess("example.com", "h2");
    // h1 has failures only → reliability ≈ 0
    cache.recordFailure("example.com", "h1");
    cache.recordFailure("example.com", "h1");
    cache.recordFailure("example.com", "h1");

    const r = await runFind(
      { snapshot, cache: null, siteGraphCache: cache, domain: "example.com" },
      { intent: "sign in button" }
    );

    expect(r.ok).toBe(true);
    // h2 must be ranked first thanks to reliability weighting.
    expect(r.candidates[0].stable_id).toBe("h2");
  });
});
