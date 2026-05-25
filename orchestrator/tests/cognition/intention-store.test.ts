import { describe, it, expect, afterEach } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
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
