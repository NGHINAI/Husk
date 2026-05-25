/**
 * observation-link.test.ts — M21 Phase D Task 4.
 *
 * 3 tests using real :memory: SQLite via SiteGraphCache.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { CognitionStorage } from "../../src/cognition/storage.js";
import { linkOutcomeToObservation } from "../../src/cognition/observation-link.js";
import type { Outcome } from "../../src/cognition/intention-types.js";

describe("observation-link", () => {
  let dir: string;
  let cache: SiteGraphCache;
  let storage: CognitionStorage;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "husk-m21-"));
    cache = new SiteGraphCache({ cacheDir: dir });
    storage = new CognitionStorage(cache);
  });

  afterEach(() => {
    cache.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes evidence + intention_name into cognition_observations", () => {
    const outcome: Outcome = {
      ok: true,
      intention: "test_intention",
      args: {},
      state_before: "s1",
      state_after: "s2",
      evidence: [{ predicate: "x", passed: true, source: "url" }],
      duration_ms: 100,
      steps_observed: [],
    };
    linkOutcomeToObservation(storage, "test.com", "https://test.com/", outcome);
    const rows = storage.recentObservations("test.com", 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].intention_name).toBe("test_intention");
    expect(rows[0].evidence).toHaveLength(1);
    expect(rows[0].evidence?.[0].passed).toBe(true);
  });

  it("handles failure outcomes (no state_after)", () => {
    const outcome: Outcome = {
      ok: false,
      intention: "broken",
      args: {},
      state_before: "s1",
      evidence: [],
      duration_ms: 50,
      reason: "verify_failed",
      steps_observed: [],
    };
    linkOutcomeToObservation(storage, "test.com", "https://test.com/", outcome);
    const rows = storage.recentObservations("test.com", 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].intention_name).toBe("broken");
  });

  it("schema v5 includes intention_name + evidence_json columns", () => {
    const cols = (cache as unknown as { db: { prepare: (sql: string) => { all: () => Array<{ name: string }> } } })
      .db.prepare("PRAGMA table_info(cognition_observations)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("intention_name");
    expect(names).toContain("evidence_json");
  });
});
