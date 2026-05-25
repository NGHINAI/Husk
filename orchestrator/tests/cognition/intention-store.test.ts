import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { IntentionStore } from "../../src/cognition/intention-store.js";
import type { Intention } from "../../src/cognition/intention-types.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

describe("cognition_intentions schema", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates cognition_intentions table at schema v4", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "husk-m19-"));
    const cache = new SiteGraphCache({ cacheDir: dir });
    const db = cache.db;
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cognition_intentions'").get();
    expect(row).toBeTruthy();
    const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(userVersion.user_version).toBeGreaterThanOrEqual(4);
    cache.close();
  });
});

describe("IntentionStore", () => {
  let dir: string;
  let cache: SiteGraphCache;
  let store: IntentionStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "husk-m19-"));
    cache = new SiteGraphCache({ cacheDir: dir });
    store = new IntentionStore(cache.db);
  });

  afterEach(() => {
    cache.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const mk = (name: string): Intention => ({
    site: "test.com",
    name,
    args_schema: { type: "object" },
    requires_state: "home",
    steps: [{ verb: "click", target: { button: "Go" } }],
    verify: [],
    failure_modes: [],
    created_at: 1000,
    updated_at: 1000,
  });

  it("upsert + get round-trips", () => {
    const i = mk("intent_a");
    store.upsert(i);
    const got = store.get("test.com", "intent_a");
    expect(got).not.toBeNull();
    expect(got!.steps).toEqual(i.steps);
  });

  it("upsert is idempotent (overwrites)", () => {
    store.upsert(mk("intent_a"));
    const updated = { ...mk("intent_a"), description: "updated", updated_at: 2000 };
    store.upsert(updated);
    expect(store.get("test.com", "intent_a")!.description).toBe("updated");
  });

  it("get returns null for missing", () => {
    expect(store.get("test.com", "missing")).toBeNull();
  });

  it("list returns alphabetically", () => {
    store.upsert(mk("zebra"));
    store.upsert(mk("alpha"));
    const names = store.list("test.com").map((i) => i.name);
    expect(names).toEqual(["alpha", "zebra"]);
  });

  it("list scoped to site", () => {
    store.upsert({ ...mk("a"), site: "site1.com" });
    store.upsert({ ...mk("b"), site: "site2.com" });
    expect(store.list("site1.com")).toHaveLength(1);
    expect(store.list("site2.com")).toHaveLength(1);
  });

  it("remove deletes and reports", () => {
    store.upsert(mk("rm"));
    expect(store.remove("test.com", "rm")).toBe(true);
    expect(store.remove("test.com", "rm")).toBe(false);
    expect(store.get("test.com", "rm")).toBeNull();
  });
});
