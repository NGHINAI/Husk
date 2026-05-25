/**
 * Tests for StateGraph — in-memory state machine + BFS path finder.
 * M18 Task 3.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StateGraph } from "../../src/cognition/state-graph.js";
import type { SiteState, Transition } from "../../src/cognition/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(state_id: string, urlRegex: string, affordances: string[] = [], confidence = 0.5): SiteState {
  return {
    site: "linkedin.com",
    state_id,
    identify_by: { type: "url_pattern", regex: urlRegex },
    affordances,
    observed_count: 1,
    confidence,
    last_seen_at: Date.now(),
  };
}

function makeTransition(from_state: string, to_state: string): Transition {
  return {
    site: "linkedin.com",
    from_state,
    to_state,
    action_sequence: [{ verb: "click", intent: `go to ${to_state}` }],
    success_count: 1,
    failure_count: 0,
    avg_duration_ms: 500,
    confidence: 0.85,
    last_used_at: Date.now(),
  };
}

function snap(url: string) {
  return {
    url,
    root: { i: "r", r: "RootWebArea", n: "", c: [] },
  };
}

// ---------------------------------------------------------------------------
// Fixture StateGraph used by most tests
// ---------------------------------------------------------------------------

function buildGraph(): StateGraph {
  const sg = new StateGraph("linkedin.com", new Map(), []);
  sg.upsertState(makeState("linkedin.com::login_form", "/login", ["submit_login"], 0.5));
  sg.upsertState(makeState("linkedin.com::home_feed", "/feed", ["search", "post_update"], 0.7));
  sg.upsertState(makeState("linkedin.com::profile_page", "/in/", ["send_message", "connect"], 0.6));
  sg.upsertTransition(makeTransition("linkedin.com::login_form", "linkedin.com::home_feed"));
  sg.upsertTransition(makeTransition("linkedin.com::home_feed", "linkedin.com::profile_page"));
  return sg;
}

// ---------------------------------------------------------------------------
// identifyCurrentState
// ---------------------------------------------------------------------------

describe("StateGraph.identifyCurrentState", () => {
  it("matches the right state by url_pattern predicate", () => {
    const sg = buildGraph();
    const m = sg.identifyCurrentState(snap("https://linkedin.com/feed"));
    expect(m).not.toBeNull();
    expect(m!.state.state_id).toBe("linkedin.com::home_feed");
  });

  it("returns null when no state predicate matches", () => {
    const sg = buildGraph();
    const m = sg.identifyCurrentState(snap("https://linkedin.com/jobs"));
    expect(m).toBeNull();
  });

  it("returns the highest-confidence state when multiple states match", () => {
    // Two states with overlapping url patterns — pick highest confidence
    const sg = new StateGraph("example.com", new Map(), []);
    sg.upsertState({
      site: "example.com",
      state_id: "example.com::low",
      identify_by: { type: "url_pattern", regex: "example\\.com" },
      affordances: [],
      observed_count: 1,
      confidence: 0.3,
      last_seen_at: Date.now(),
    });
    sg.upsertState({
      site: "example.com",
      state_id: "example.com::high",
      identify_by: { type: "url_pattern", regex: "example\\.com" },
      affordances: [],
      observed_count: 1,
      confidence: 0.9,
      last_seen_at: Date.now(),
    });
    sg.upsertState({
      site: "example.com",
      state_id: "example.com::mid",
      identify_by: { type: "url_pattern", regex: "example\\.com" },
      affordances: [],
      observed_count: 1,
      confidence: 0.6,
      last_seen_at: Date.now(),
    });

    const m = sg.identifyCurrentState(snap("https://example.com/page"));
    expect(m).not.toBeNull();
    expect(m!.state.state_id).toBe("example.com::high");
    expect(m!.confidence).toBe(0.9);
  });

  it("returns confidence from the matched state", () => {
    const sg = buildGraph();
    const m = sg.identifyCurrentState(snap("https://linkedin.com/login"));
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// findPath
// ---------------------------------------------------------------------------

describe("StateGraph.findPath", () => {
  it("returns empty array when from === to (already at target)", () => {
    const sg = buildGraph();
    expect(sg.findPath("linkedin.com::home_feed", "linkedin.com::home_feed")).toEqual([]);
  });

  it("returns 1-step path for a direct transition", () => {
    const sg = buildGraph();
    const path = sg.findPath("linkedin.com::login_form", "linkedin.com::home_feed");
    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0].from_state).toBe("linkedin.com::login_form");
    expect(path![0].to_state).toBe("linkedin.com::home_feed");
    expect(path![0].action_sequence[0].verb).toBe("click");
  });

  it("returns multi-step BFS path (login → feed → profile)", () => {
    const sg = buildGraph();
    const path = sg.findPath("linkedin.com::login_form", "linkedin.com::profile_page");
    expect(path).not.toBeNull();
    expect(path).toHaveLength(2);
    expect(path![0].from_state).toBe("linkedin.com::login_form");
    expect(path![0].to_state).toBe("linkedin.com::home_feed");
    expect(path![1].from_state).toBe("linkedin.com::home_feed");
    expect(path![1].to_state).toBe("linkedin.com::profile_page");
  });

  it("returns null when there is no path (unknown from_state)", () => {
    const sg = buildGraph();
    expect(sg.findPath("linkedin.com::nonexistent", "linkedin.com::home_feed")).toBeNull();
  });

  it("returns null when there is no path (unknown to_state)", () => {
    const sg = buildGraph();
    expect(sg.findPath("linkedin.com::home_feed", "linkedin.com::nonexistent")).toBeNull();
  });

  it("returns null when no transition chain connects the states", () => {
    const sg = buildGraph();
    // profile_page has no outgoing transitions → can't reach login_form from it
    expect(sg.findPath("linkedin.com::profile_page", "linkedin.com::login_form")).toBeNull();
  });

  it("BFS finds the shortest path (not a longer detour)", () => {
    // A→B (direct), A→C→B (longer). BFS must pick A→B.
    const sg = new StateGraph("test.com", new Map(), []);
    sg.upsertState(makeState("test.com::A", "/a"));
    sg.upsertState(makeState("test.com::B", "/b"));
    sg.upsertState(makeState("test.com::C", "/c"));
    sg.upsertTransition(makeTransition("test.com::A", "test.com::C"));
    sg.upsertTransition(makeTransition("test.com::C", "test.com::B"));
    sg.upsertTransition(makeTransition("test.com::A", "test.com::B")); // direct

    const path = sg.findPath("test.com::A", "test.com::B");
    expect(path).toHaveLength(1);
    expect(path![0].to_state).toBe("test.com::B");
  });
});

// ---------------------------------------------------------------------------
// affordancesIn
// ---------------------------------------------------------------------------

describe("StateGraph.affordancesIn", () => {
  it("returns the affordance list for a known state", () => {
    const sg = buildGraph();
    expect(sg.affordancesIn("linkedin.com::home_feed")).toEqual(["search", "post_update"]);
  });

  it("returns empty array for an unknown state", () => {
    const sg = buildGraph();
    expect(sg.affordancesIn("linkedin.com::does_not_exist")).toEqual([]);
  });

  it("returns empty array for a state with no affordances", () => {
    const sg = new StateGraph("empty.com", new Map(), []);
    sg.upsertState({
      site: "empty.com",
      state_id: "empty.com::bare",
      identify_by: { type: "url_pattern", regex: "/" },
      affordances: [],
      observed_count: 0,
      confidence: 0.5,
      last_seen_at: Date.now(),
    });
    expect(sg.affordancesIn("empty.com::bare")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// upsertState / upsertTransition — idempotency
// ---------------------------------------------------------------------------

describe("StateGraph.upsertState idempotency", () => {
  it("re-upserting a state with same id replaces, does not duplicate", () => {
    const sg = new StateGraph("x.com", new Map(), []);
    const s1 = makeState("x.com::page", "/page", ["read"], 0.5);
    sg.upsertState(s1);
    expect(sg.listStates()).toHaveLength(1);

    const s2: SiteState = { ...s1, affordances: ["read", "write"], confidence: 0.8 };
    sg.upsertState(s2);
    expect(sg.listStates()).toHaveLength(1);
    expect(sg.affordancesIn("x.com::page")).toEqual(["read", "write"]);
    expect(sg.listStates()[0].confidence).toBe(0.8);
  });
});

describe("StateGraph.upsertTransition idempotency", () => {
  it("re-upserting a transition with same from/to replaces, does not duplicate", () => {
    const sg = new StateGraph("x.com", new Map(), []);
    sg.upsertState(makeState("x.com::A", "/a"));
    sg.upsertState(makeState("x.com::B", "/b"));

    const t1 = makeTransition("x.com::A", "x.com::B");
    sg.upsertTransition(t1);
    expect(sg.listTransitions()).toHaveLength(1);

    const t2: Transition = { ...t1, confidence: 0.99, success_count: 50 };
    sg.upsertTransition(t2);
    expect(sg.listTransitions()).toHaveLength(1);
    expect(sg.listTransitions()[0].confidence).toBe(0.99);
    expect(sg.listTransitions()[0].success_count).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// toJSON / fromJSON roundtrip
// ---------------------------------------------------------------------------

describe("StateGraph.toJSON / fromJSON", () => {
  it("roundtrip preserves site, states and transitions", () => {
    const sg = buildGraph();
    const json = sg.toJSON();

    expect(json.site).toBe("linkedin.com");
    expect(json.states).toHaveLength(3);
    expect(json.transitions).toHaveLength(2);

    const restored = StateGraph.fromJSON(json);
    expect(restored.listStates()).toHaveLength(3);
    expect(restored.listTransitions()).toHaveLength(2);
  });

  it("restored graph finds paths correctly", () => {
    const sg = buildGraph();
    const restored = StateGraph.fromJSON(sg.toJSON());
    const path = restored.findPath("linkedin.com::login_form", "linkedin.com::home_feed");
    expect(path).toHaveLength(1);
    expect(path![0].action_sequence[0].verb).toBe("click");
  });

  it("restored graph identifies states correctly", () => {
    const sg = buildGraph();
    const restored = StateGraph.fromJSON(sg.toJSON());
    const m = restored.identifyCurrentState(snap("https://linkedin.com/in/johndoe"));
    expect(m?.state.state_id).toBe("linkedin.com::profile_page");
  });

  it("fromJSON preserves affordances", () => {
    const sg = buildGraph();
    const restored = StateGraph.fromJSON(sg.toJSON());
    expect(restored.affordancesIn("linkedin.com::home_feed")).toEqual(["search", "post_update"]);
  });
});

// ---------------------------------------------------------------------------
// Constructor — passes initial states and transitions
// ---------------------------------------------------------------------------

describe("StateGraph constructor", () => {
  it("accepts pre-populated states map and transitions array", () => {
    const states = new Map<string, SiteState>();
    states.set("t.com::a", makeState("t.com::a", "/a", ["act"]));
    const transitions: Transition[] = [makeTransition("t.com::a", "t.com::a")];
    // Self-loop for coverage
    const sg = new StateGraph("t.com", states, transitions);
    expect(sg.listStates()).toHaveLength(1);
    expect(sg.listTransitions()).toHaveLength(1);
    expect(sg.site).toBe("t.com");
  });
});
