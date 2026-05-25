/**
 * Tests for ExplorationHarness (M18 Task 6).
 *
 * Uses real CognitionStorage backed by a temp-dir SQLite — NOT a mock.
 * This gives stronger coverage of the full read/write contract.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { CognitionStorage } from "../../src/cognition/storage.js";
import {
  ExplorationHarness,
  escapeRegex,
  normalizeUrl,
  mostDistinctiveAxNodes,
} from "../../src/cognition/exploration.js";
import type { SnapshotForPredicate, AxTreeNode } from "../../src/cognition/predicate.js";
import type { ActionStep } from "../../src/cognition/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCache(): { cache: SiteGraphCache; storage: CognitionStorage } {
  const dir = mkdtempSync(join(tmpdir(), "husk-expl-"));
  const cache = new SiteGraphCache({ cacheDir: dir });
  const storage = new CognitionStorage(cache);
  return { cache, storage };
}

/** Minimal snapshot with a given URL and optional AX root. */
function snap(
  url: string,
  root?: AxTreeNode,
): SnapshotForPredicate {
  return {
    url,
    root: root ?? { i: "root", r: "WebArea", n: "Page", c: [] },
  };
}

/** A simple AX tree with some distinctive nodes. */
function richRoot(): AxTreeNode {
  return {
    i: "root",
    r: "WebArea",
    n: "Page",
    c: [
      {
        i: "h1",
        r: "heading",
        n: "Welcome back",
        c: [],
      },
      {
        i: "btn1",
        r: "button",
        n: "Sign in",
        c: [],
      },
      {
        i: "div1",
        r: "generic",
        n: "some content",
        c: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test 1: First observation creates a new state
// ---------------------------------------------------------------------------

describe("ExplorationHarness", () => {
  let cache: SiteGraphCache;
  let storage: CognitionStorage;

  beforeEach(() => {
    ({ cache, storage } = makeCache());
  });

  afterEach(() => {
    cache.close();
  });

  it("first observation creates a new state with observed_count = 1", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    harness.observe(snap("https://site.com/login", richRoot()));

    const states = storage.listStates("site.com");
    expect(states).toHaveLength(1);
    expect(states[0].observed_count).toBe(1);
    expect(states[0].site).toBe("site.com");
  });

  // ---------------------------------------------------------------------------
  // Test 2: Re-observation of the same URL+AX markers increments observed_count
  // ---------------------------------------------------------------------------

  it("re-observation of the same page increments observed_count to 2 (no duplicate state)", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    const loginSnap = snap("https://site.com/login", richRoot());
    harness.observe(loginSnap);
    harness.observe(loginSnap); // same snapshot again

    const states = storage.listStates("site.com");
    expect(states).toHaveLength(1); // no duplicate
    expect(states[0].observed_count).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Observation after an action records a transition
  // ---------------------------------------------------------------------------

  it("observation after an action records a transition from prev → new state", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    const loginSnap = snap("https://site.com/login", richRoot());
    const feedSnap = snap("https://site.com/feed", {
      i: "root",
      r: "WebArea",
      n: "Feed page",
      c: [
        { i: "h1", r: "heading", n: "Your feed", c: [] },
        { i: "btn", r: "button", n: "Post something", c: [] },
      ],
    });
    const action: ActionStep = { verb: "click", intent: "Sign in" };

    harness.observe(loginSnap);
    harness.observe(feedSnap, action);

    const transitions = storage.getTransitions("site.com");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].action_sequence[0]).toEqual(action);
    expect(transitions[0].success_count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Re-observing the same transition increments success_count and confidence
  // ---------------------------------------------------------------------------

  it("re-observing the same transition increments success_count and bumps confidence", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    const loginSnap = snap("https://site.com/login", richRoot());
    const feedSnap = snap("https://site.com/feed", {
      i: "root",
      r: "WebArea",
      n: "Feed page",
      c: [
        { i: "h1", r: "heading", n: "Your feed", c: [] },
        { i: "btn", r: "button", n: "Post something", c: [] },
      ],
    });
    const action: ActionStep = { verb: "click", intent: "Sign in" };

    // First pass: login → feed
    harness.observe(loginSnap);
    harness.observe(feedSnap, action);

    // Second pass: login → feed again (simulating another session)
    const harness2 = new ExplorationHarness({
      site: "site.com",
      session_id: "s2",
      storage,
    });
    harness2.observe(loginSnap);
    harness2.observe(feedSnap, action);

    const transitions = storage.getTransitions("site.com");
    expect(transitions).toHaveLength(1); // still one transition
    expect(transitions[0].success_count).toBe(2);
    // confidence starts at 0.5, applySuccess adds 0.05 → 0.55
    expect(transitions[0].confidence).toBeCloseTo(0.55, 5);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Each observation appends a row to the observations log
  // ---------------------------------------------------------------------------

  it("each observation appends a row to the observations log", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    harness.observe(snap("https://site.com/login", richRoot()));
    harness.observe(snap("https://site.com/feed", {
      i: "root", r: "WebArea", n: "Feed", c: [
        { i: "h1", r: "heading", n: "Your feed", c: [] },
      ],
    }), { verb: "click", intent: "Sign in" });

    const obs = storage.recentObservations("site.com", 0);
    expect(obs).toHaveLength(2);
    expect(obs[0].prev_state).toBeNull(); // first has no prev
    expect(obs[1].prev_state).not.toBeNull(); // second has prev
    expect(obs[1].action_taken).toEqual({ verb: "click", intent: "Sign in" });
  });

  // ---------------------------------------------------------------------------
  // Test 6: Helper unit tests — normalizeUrl and escapeRegex
  // ---------------------------------------------------------------------------

  describe("normalizeUrl", () => {
    it("strips fragment", () => {
      expect(normalizeUrl("https://example.com/path#section")).toBe(
        "https://example.com/path",
      );
    });

    it("lowercases host", () => {
      expect(normalizeUrl("https://EXAMPLE.COM/path")).toBe(
        "https://example.com/path",
      );
    });

    it("removes trailing slash from non-root path", () => {
      expect(normalizeUrl("https://example.com/path/")).toBe(
        "https://example.com/path",
      );
    });

    it("keeps root slash", () => {
      expect(normalizeUrl("https://example.com/")).toBe(
        "https://example.com/",
      );
    });

    it("preserves query params", () => {
      expect(normalizeUrl("https://example.com/search?q=hello")).toBe(
        "https://example.com/search?q=hello",
      );
    });
  });

  describe("escapeRegex", () => {
    it("escapes dots", () => {
      expect(escapeRegex("a.b")).toBe("a\\.b");
    });

    it("escapes slashes and special chars", () => {
      const raw = "https://example.com/path?q=1";
      const escaped = escapeRegex(raw);
      // The escaped string, when used as a regex, should match exactly the input
      expect(new RegExp(escaped).test(raw)).toBe(true);
    });

    it("does not match unintended patterns without escaping", () => {
      const escaped = escapeRegex("a.b.c");
      // "axbxc" should NOT match the escaped version
      expect(new RegExp(escaped).test("axbxc")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 7: mostDistinctiveAxNodes picks heading/button over generic divs
  // ---------------------------------------------------------------------------

  describe("mostDistinctiveAxNodes", () => {
    it("picks heading and button nodes over generic nodes", () => {
      const root: AxTreeNode = {
        i: "root",
        r: "WebArea",
        n: "Page",
        c: [
          { i: "div1", r: "generic", n: "content", c: [] },
          { i: "h1", r: "heading", n: "Welcome", c: [] },
          { i: "btn", r: "button", n: "Submit", c: [] },
        ],
      };
      const nodes = mostDistinctiveAxNodes(root, 2);
      const roles = nodes.map((n) => n.r.toLowerCase());
      expect(roles).not.toContain("generic");
      expect(roles.some((r) => r === "heading" || r === "button")).toBe(true);
    });

    it("returns empty array for null root", () => {
      expect(mostDistinctiveAxNodes(null, 2)).toEqual([]);
    });

    it("returns empty array for undefined root", () => {
      expect(mostDistinctiveAxNodes(undefined, 2)).toEqual([]);
    });

    it("returns empty array when no distinctive nodes exist", () => {
      const root: AxTreeNode = {
        i: "root",
        r: "WebArea",
        n: "Page",
        c: [
          { i: "div1", r: "generic", n: "content", c: [] },
        ],
      };
      expect(mostDistinctiveAxNodes(root, 2)).toEqual([]);
    });

    it("respects k limit", () => {
      const root: AxTreeNode = {
        i: "root",
        r: "WebArea",
        n: "Page",
        c: [
          { i: "h1", r: "heading", n: "Title A", c: [] },
          { i: "h2", r: "heading", n: "Title B", c: [] },
          { i: "btn", r: "button", n: "Go", c: [] },
        ],
      };
      const nodes = mostDistinctiveAxNodes(root, 1);
      expect(nodes).toHaveLength(1);
    });

    it("ignores nodes with empty names", () => {
      const root: AxTreeNode = {
        i: "root",
        r: "WebArea",
        n: "Page",
        c: [
          { i: "btn1", r: "button", n: "", c: [] }, // empty name — excluded
          { i: "btn2", r: "button", n: "Submit", c: [] },
        ],
      };
      const nodes = mostDistinctiveAxNodes(root, 2);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].n).toBe("Submit");
    });
  });

  // ---------------------------------------------------------------------------
  // Test 8: Two different URLs produce two different states (no cross-contamination)
  // ---------------------------------------------------------------------------

  it("two different URLs produce two different states", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    harness.observe(snap("https://site.com/login", richRoot()));
    harness.observe(
      snap("https://site.com/signup", {
        i: "root",
        r: "WebArea",
        n: "Signup page",
        c: [
          { i: "h1", r: "heading", n: "Create account", c: [] },
          { i: "btn", r: "button", n: "Register", c: [] },
        ],
      }),
    );

    const states = storage.listStates("site.com");
    expect(states).toHaveLength(2);
    const urls = states.map((s) =>
      JSON.stringify(s.identify_by),
    );
    // State predicates should differ (different URL patterns)
    expect(urls[0]).not.toBe(urls[1]);
  });

  // ---------------------------------------------------------------------------
  // Test 9: `now` override works — observed_at uses the fake clock
  // ---------------------------------------------------------------------------

  it("now() override is used for timestamps — observed_at reflects fake clock", () => {
    let fakeTime = 1_000_000;
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
      now: () => fakeTime,
    });

    harness.observe(snap("https://site.com/login", richRoot()));

    const obs = storage.recentObservations("site.com", 0);
    expect(obs[0].ts).toBe(1_000_000);

    // Advance fake clock
    fakeTime = 2_000_000;
    harness.observe(snap("https://site.com/login", richRoot()));

    const obs2 = storage.recentObservations("site.com", 0);
    expect(obs2[1].ts).toBe(2_000_000);

    // last_seen_at on the state should be updated to the latest ts
    const states = storage.listStates("site.com");
    expect(states[0].last_seen_at).toBe(2_000_000);
  });

  // ---------------------------------------------------------------------------
  // Test 10: finish() doesn't throw and doesn't corrupt state
  // ---------------------------------------------------------------------------

  it("finish() does not throw and does not corrupt state", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    harness.observe(snap("https://site.com/login", richRoot()));
    expect(() => harness.finish()).not.toThrow();

    // State is still intact after finish
    const states = storage.listStates("site.com");
    expect(states).toHaveLength(1);
    expect(states[0].observed_count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Edge case: identifyCurrentState handles empty graph gracefully
  // ---------------------------------------------------------------------------

  it("works correctly when graph is initially empty (no known states)", () => {
    const harness = new ExplorationHarness({
      site: "empty-site.com",
      session_id: "s1",
      storage,
    });

    // Should not throw even though graph has no states
    expect(() =>
      harness.observe(snap("https://empty-site.com/page")),
    ).not.toThrow();

    expect(storage.listStates("empty-site.com")).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Edge case: first observe has no lastAction — no transition recorded
  // ---------------------------------------------------------------------------

  it("first observe (no lastAction) does not create a transition", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    harness.observe(snap("https://site.com/login", richRoot()));

    expect(storage.getTransitions("site.com")).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Edge case: observation without action between two states — no transition
  // ---------------------------------------------------------------------------

  it("observe without lastAction between two different states records no transition", () => {
    const harness = new ExplorationHarness({
      site: "site.com",
      session_id: "s1",
      storage,
    });

    harness.observe(snap("https://site.com/login", richRoot()));
    harness.observe(
      snap("https://site.com/feed", {
        i: "root",
        r: "WebArea",
        n: "Feed",
        c: [{ i: "h1", r: "heading", n: "Your feed", c: [] }],
      }),
      // no action provided
    );

    // No transition because lastAction was not provided
    expect(storage.getTransitions("site.com")).toHaveLength(0);
  });
});
