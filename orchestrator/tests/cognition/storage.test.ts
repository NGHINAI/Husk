import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { CognitionStorage } from "../../src/cognition/storage.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CognitionStorage", () => {
  let cache: SiteGraphCache;
  let storage: CognitionStorage;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cog-storage-"));
    cache = new SiteGraphCache({ cacheDir: dir });
    storage = new CognitionStorage(cache);
  });
  afterEach(() => cache.close());

  it("upsertState + getState + listStates roundtrip", () => {
    storage.upsertState({
      site: "linkedin.com",
      state_id: "linkedin.com::home_feed",
      identify_by: { type: "url_pattern", regex: "/feed" } as any,
      affordances: ["search"],
      observed_count: 5,
      confidence: 0.85,
      last_seen_at: Date.now(),
    });
    const s = storage.getState("linkedin.com", "linkedin.com::home_feed");
    expect(s?.affordances).toEqual(["search"]);
    expect(s?.confidence).toBeCloseTo(0.85);
    expect(storage.listStates("linkedin.com")).toHaveLength(1);
  });

  it("upsertState is idempotent — re-upsert updates, doesn't duplicate", () => {
    const base = { site: "x", state_id: "x::a", identify_by: { type: "url_pattern" as const, regex: "/a" } as any, affordances: ["one"], observed_count: 1, confidence: 0.5, last_seen_at: Date.now() };
    storage.upsertState(base);
    storage.upsertState({ ...base, affordances: ["one", "two"], confidence: 0.7 });
    const s = storage.getState("x", "x::a");
    expect(s?.affordances).toEqual(["one", "two"]);
    expect(s?.confidence).toBeCloseTo(0.7);
    expect(storage.listStates("x")).toHaveLength(1);
  });

  it("getState returns null for unknown", () => {
    expect(storage.getState("ghost", "ghost::a")).toBeNull();
  });

  it("upsertTransition + getTransitions with optional from filter", () => {
    const base = (from: string, to: string) => ({ site: "x", from_state: from, to_state: to, action_sequence: [], success_count: 0, failure_count: 0, avg_duration_ms: 0, confidence: 0.5, last_used_at: Date.now() });
    storage.upsertTransition(base("a", "b"));
    storage.upsertTransition(base("a", "c"));
    storage.upsertTransition(base("b", "c"));
    expect(storage.getTransitions("x")).toHaveLength(3);
    expect(storage.getTransitions("x", "a")).toHaveLength(2);
    expect(storage.getTransitions("x", "b")).toHaveLength(1);
  });

  it("upsertTransition is idempotent on (site, from, to) key", () => {
    const t = { site: "x", from_state: "a", to_state: "b", action_sequence: [{ verb: "click" as const, intent: "x" }], success_count: 1, failure_count: 0, avg_duration_ms: 100, confidence: 0.5, last_used_at: Date.now() };
    storage.upsertTransition(t);
    storage.upsertTransition({ ...t, success_count: 5 });
    const ts = storage.getTransitions("x");
    expect(ts).toHaveLength(1);
    expect(ts[0].success_count).toBe(5);
  });

  it("recordObservation + recentObservations chronologically", () => {
    const t0 = Date.now();
    storage.recordObservation({ site: "x", ts: t0 - 1000, prev_state: null, current_state: "a", url: "/", snapshot_summary: "init", action_taken: null });
    storage.recordObservation({ site: "x", ts: t0,        prev_state: "a",  current_state: "b", url: "/x", snapshot_summary: "moved", action_taken: { verb: "navigate", url: "/x" } });
    const recent = storage.recentObservations("x", t0 - 2000);
    expect(recent).toHaveLength(2);
    expect(recent[0].current_state).toBe("a");
    expect(recent[1].current_state).toBe("b");
    expect(recent[1].action_taken).toEqual({ verb: "navigate", url: "/x" });
  });

  it("recentObservations honors since_ts cutoff", () => {
    const t = Date.now();
    storage.recordObservation({ site: "x", ts: t - 10_000, prev_state: null, current_state: "a", url: "/", snapshot_summary: "old", action_taken: null });
    storage.recordObservation({ site: "x", ts: t,          prev_state: null, current_state: "b", url: "/", snapshot_summary: "new", action_taken: null });
    expect(storage.recentObservations("x", t - 5000)).toHaveLength(1);  // only the new one
  });

  it("loadStateGraph hydrates a StateGraph with states + transitions", () => {
    storage.upsertState({ site: "x", state_id: "x::a", identify_by: { type: "url_pattern" as const, regex: "/a" } as any, affordances: ["x"], observed_count: 1, confidence: 0.5, last_seen_at: Date.now() });
    storage.upsertTransition({ site: "x", from_state: "x::a", to_state: "x::b", action_sequence: [], success_count: 0, failure_count: 0, avg_duration_ms: 0, confidence: 0.5, last_used_at: Date.now() });
    const g = storage.loadStateGraph("x");
    expect(g.affordancesIn("x::a")).toEqual(["x"]);
    expect(g.listTransitions()).toHaveLength(1);
  });

  it("loadStateGraph for unknown site returns an empty graph", () => {
    const g = storage.loadStateGraph("ghost");
    expect(g.listStates()).toEqual([]);
    expect(g.listTransitions()).toEqual([]);
  });

  it("acquireExplorationLock — first agent wins, second blocked", () => {
    expect(storage.acquireExplorationLock("linkedin.com", "agent_a", 60_000)).toBe(true);
    expect(storage.acquireExplorationLock("linkedin.com", "agent_b", 60_000)).toBe(false);
    expect(storage.isExplorationLocked("linkedin.com")?.holder_id).toBe("agent_a");
  });

  it("acquireExplorationLock — same holder can re-acquire (refresh)", () => {
    expect(storage.acquireExplorationLock("x", "a", 60_000)).toBe(true);
    expect(storage.acquireExplorationLock("x", "a", 120_000)).toBe(true);  // same holder, extends TTL
  });

  it("releaseExplorationLock allows another agent to acquire", () => {
    storage.acquireExplorationLock("x", "a");
    storage.releaseExplorationLock("x", "a");
    expect(storage.acquireExplorationLock("x", "b")).toBe(true);
  });

  it("releaseExplorationLock by non-holder is a no-op", () => {
    storage.acquireExplorationLock("x", "a");
    storage.releaseExplorationLock("x", "imposter");  // not the holder
    expect(storage.isExplorationLocked("x")?.holder_id).toBe("a");  // still held by a
  });

  it("lock expires after TTL — next acquireExplorationLock succeeds", async () => {
    storage.acquireExplorationLock("x", "a", 50);
    await new Promise((r) => setTimeout(r, 100));
    expect(storage.acquireExplorationLock("x", "b", 60_000)).toBe(true);
  });

  it("isExplorationLocked returns null when not locked", () => {
    expect(storage.isExplorationLocked("nobody")).toBeNull();
  });

  it("isExplorationLocked returns null when lock has expired", async () => {
    storage.acquireExplorationLock("x", "a", 30);
    await new Promise((r) => setTimeout(r, 80));
    expect(storage.isExplorationLocked("x")).toBeNull();
  });
});
