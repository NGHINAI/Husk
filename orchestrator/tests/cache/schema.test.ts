import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema, SCHEMA_VERSION } from "../../src/cache/schema.js";

describe("applySchema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates the selectors table with all expected columns", () => {
    applySchema(db);
    const cols = db.prepare("PRAGMA table_info(selectors)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "stable_id",
        "current_css",
        "current_xpath",
        "role",
        "name_norm",
        "last_seen_at",
        "hit_count",
        "miss_count",
        "success_count",
        "failure_count",
      ].sort()
    );
  });

  it("creates the role+name_norm index", () => {
    applySchema(db);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as Array<{ name: string }>;
    const names = idx.map((i) => i.name);
    expect(names).toContain("idx_selectors_role_name");
  });

  it("creates a schema_meta table tracking the version", () => {
    applySchema(db);
    const version = (
      db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string }
    ).value;
    expect(version).toBe(String(SCHEMA_VERSION));
  });

  it("is idempotent — running twice does not throw or duplicate", () => {
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
    const count = (
      db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='selectors'").get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });

  it("stable_id is the primary key (rejects duplicate inserts)", () => {
    applySchema(db);
    const insert = db.prepare(
      "INSERT INTO selectors (stable_id, current_xpath, role, name_norm, last_seen_at) VALUES (?, ?, ?, ?, ?)"
    );
    insert.run("btn:abc", "/main/[0]", "button", "submit", Date.now());
    expect(() => insert.run("btn:abc", "/main/[0]", "button", "submit", Date.now())).toThrow();
  });
});
