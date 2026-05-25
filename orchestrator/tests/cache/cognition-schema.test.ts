import { describe, it, expect } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cognition SQLite schema", () => {
  it("all 4 new cognition tables exist after schema init", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cognition-"));
    const cache = new SiteGraphCache({ cacheDir: dir });
    const db = (cache as unknown as { db: { prepare(s: string): { all(): Array<{ name: string }> } } }).db;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all().map((r) => r.name);
    expect(tables).toContain("cognition_states");
    expect(tables).toContain("cognition_transitions");
    expect(tables).toContain("cognition_observations");
    expect(tables).toContain("cognition_exploration_locks");
    cache.close();
  });

  it("schema version is bumped to 3 (or current version + 1)", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cognition-"));
    const cache = new SiteGraphCache({ cacheDir: dir });
    const db = (cache as unknown as { db: { prepare(s: string): { get(): { user_version: number } } } }).db;
    const v = db.prepare("PRAGMA user_version").get();
    expect(v.user_version).toBeGreaterThanOrEqual(3);
    cache.close();
  });

  it("indexes exist (site-prefixed for fast lookups)", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cognition-"));
    const cache = new SiteGraphCache({ cacheDir: dir });
    const db = (cache as unknown as { db: { prepare(s: string): { all(): Array<{ name: string }> } } }).db;
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all().map((r) => r.name);
    expect(indexes).toContain("idx_cognition_states_site");
    expect(indexes).toContain("idx_cognition_transitions_site");
    expect(indexes).toContain("idx_cognition_transitions_from");
    expect(indexes).toContain("idx_cognition_observations_site_ts");
    cache.close();
  });

  it("schema init is idempotent — closing and reopening same cacheDir does not throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cognition-"));
    const cache1 = new SiteGraphCache({ cacheDir: dir });
    cache1.close();
    // Reopen — must not throw even though tables already exist
    expect(() => {
      const cache2 = new SiteGraphCache({ cacheDir: dir });
      cache2.close();
    }).not.toThrow();
  });
});
