import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jaroWinkler, findCandidates } from "../../src/watchdog/candidates.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function snap(url: string, nodes: Array<{ i: string; r: string; n: string }>): Snapshot {
  const [root, ...rest] = nodes;
  return {
    v: 1,
    url,
    count: nodes.length,
    root: { ...root, s: ["v"], c: rest.map((n) => ({ ...n, s: ["v" as const] })) },
  };
}

describe("jaroWinkler", () => {
  it("returns 1.0 for identical strings", () => {
    expect(jaroWinkler("submit", "submit")).toBeCloseTo(1.0, 5);
  });
  it("returns 0 for fully disjoint strings", () => {
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });
  it("boosts shared prefix (Winkler component)", () => {
    expect(jaroWinkler("submit application", "submit")).toBeGreaterThan(0.85);
  });
  it("scores 'submit' vs 'submit quote' higher than 'submit' vs 'cancel'", () => {
    expect(jaroWinkler("submit", "submit quote")).toBeGreaterThan(jaroWinkler("submit", "cancel"));
  });
});

describe("findCandidates", () => {
  let cacheDir: string;
  let cache: SiteGraphCache;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "husk-candidates-"));
    cache = new SiteGraphCache({ cacheDir });
    cache.observe(
      snap("https://store.test/", [
        { i: "RootWebArea:r1", r: "RootWebArea", n: "Store" },
        { i: "button:s1", r: "button", n: "Submit Application" },
        { i: "button:s2", r: "button", n: "Submit Quote" },
        { i: "button:s3", r: "button", n: "Cancel" },
        { i: "link:l1", r: "link", n: "Submit feedback" },
      ])
    );
  });

  afterEach(() => {
    cache.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns top-3 by score, role-filtered when verb has a role family", () => {
    const got = findCandidates(cache, "store.test", "click", "Submit");
    expect(got.length).toBe(3);
    expect(got[0].role).toBe("button");
    expect(got[0].name.toLowerCase()).toContain("submit");
    expect(got[0].score).toBeGreaterThan(got[2].score);
  });

  it("returns an empty array when the cache has nothing for the domain", () => {
    expect(findCandidates(cache, "unknown.test", "click", "Submit")).toEqual([]);
  });
});
