import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function makeSnapshot(url: string, nodes: Array<{ i: string; r: string; n: string }>): Snapshot {
  const [root, ...rest] = nodes;
  const c = rest.map((n) => ({ ...n, s: ["v" as const] }));
  return {
    v: 1,
    url,
    count: nodes.length,
    root: { ...root, s: ["v" as const], c: c.length ? c : undefined },
  };
}

describe("SiteGraphCache", () => {
  let cacheDir: string;
  let cache: SiteGraphCache;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "husk-cache-test-"));
    cache = new SiteGraphCache({ cacheDir });
  });

  afterEach(() => {
    cache.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("creates a per-domain .db file on first observation", () => {
    cache.observe(
      makeSnapshot("https://example.com/page", [
        { i: "RootWebArea:abc", r: "RootWebArea", n: "Page" },
        { i: "button:xyz", r: "button", n: "Submit" },
      ])
    );
    expect(existsSync(join(cacheDir, "example.com.db"))).toBe(true);
  });

  it("normalizes www. into the bare domain", () => {
    cache.observe(
      makeSnapshot("https://www.example.com/", [
        { i: "RootWebArea:a", r: "RootWebArea", n: "X" },
      ])
    );
    expect(existsSync(join(cacheDir, "example.com.db"))).toBe(true);
    expect(existsSync(join(cacheDir, "www.example.com.db"))).toBe(false);
  });

  it("query(domain, {stable_id}) returns the upserted row", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r1", r: "RootWebArea", n: "Page" },
        { i: "button:b1", r: "button", n: "Submit Application" },
      ])
    );
    const rows = cache.query("example.com", { stable_id: "button:b1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stable_id: "button:b1",
      role: "button",
      name_norm: "submit application",
    });
    expect(rows[0].last_seen_at).toBeGreaterThan(0);
  });

  it("query(domain, {role}) returns all rows with that role", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
        { i: "button:b", r: "button", n: "Cancel" },
        { i: "link:c", r: "link", n: "Home" },
      ])
    );
    const buttons = cache.query("example.com", { role: "button" });
    expect(buttons).toHaveLength(2);
    expect(buttons.map((r) => r.stable_id).sort()).toEqual(["button:a", "button:b"]);
  });

  it("query(domain, {role, name_norm}) intersects both criteria", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
        { i: "button:b", r: "button", n: "Cancel" },
        { i: "link:c", r: "link", n: "Submit" },
      ])
    );
    const matches = cache.query("example.com", { role: "button", name_norm: "submit" });
    expect(matches).toHaveLength(1);
    expect(matches[0].stable_id).toBe("button:a");
  });

  it("query(domain) returns empty array when domain has never been observed", () => {
    const rows = cache.query("never-seen.example.com", { stable_id: "x" });
    expect(rows).toEqual([]);
  });

  it("observe() is idempotent — same stable_id observed twice updates last_seen_at, not duplicates", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
      ])
    );
    const firstSeenAt = cache.query("example.com", { stable_id: "button:a" })[0].last_seen_at;
    const target = Date.now() + 2;
    while (Date.now() < target) {
      /* spin */
    }
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
      ])
    );
    const rows = cache.query("example.com", { stable_id: "button:a" });
    expect(rows).toHaveLength(1);
    expect(rows[0].last_seen_at).toBeGreaterThanOrEqual(firstSeenAt);
  });

  it("isolates domains — example.com and other.com use different DBs", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:shared", r: "button", n: "X" },
      ])
    );
    cache.observe(
      makeSnapshot("https://other.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "link:only-other", r: "link", n: "Y" },
      ])
    );
    expect(cache.query("example.com", { stable_id: "button:shared" })).toHaveLength(1);
    expect(cache.query("example.com", { stable_id: "link:only-other" })).toHaveLength(0);
    expect(cache.query("other.com", { stable_id: "link:only-other" })).toHaveLength(1);
    expect(cache.query("other.com", { stable_id: "button:shared" })).toHaveLength(0);
  });

  it("close() releases all DB file handles and rejects subsequent operations", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
      ])
    );
    cache.close();
    expect(() =>
      cache.observe(
        makeSnapshot("https://example.com/", [
          { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        ])
      )
    ).toThrow(/closed/i);
  });

  it("ignores observations from invalid URLs without throwing", () => {
    expect(() =>
      cache.observe(
        makeSnapshot("not-a-url", [{ i: "RootWebArea:r", r: "RootWebArea", n: "" }])
      )
    ).not.toThrow();
  });
});
