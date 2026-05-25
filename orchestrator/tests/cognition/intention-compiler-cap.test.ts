/**
 * intention-compiler-cap.test.ts — T5 M21
 *
 * Tests that IntentionCompiler appends an info Evidence note when an intention
 * declares a `capability`, and does NOT append any such note when no capability
 * is declared.
 */
import { describe, it, expect, vi } from "vitest";
import { IntentionCompiler, type SessionAdapter } from "../../src/cognition/intention-compiler.js";
import { StateGraph } from "../../src/cognition/state-graph.js";
import type { Intention } from "../../src/cognition/intention-types.js";
import type { SiteState } from "../../src/cognition/types.js";

function makeAdapter(overrides: Partial<SessionAdapter> = {}): SessionAdapter {
  return {
    currentUrl: vi.fn(() => "https://test.com/home") as never,
    snapshot: vi.fn(async () => ({
      url: "https://test.com/home",
      root: {
        r: "main", n: "main", i: "r",
        c: [{ i: "b1", r: "button", n: "Go" }],
      },
    })) as never,
    click: vi.fn(async () => {}) as never,
    type: vi.fn(async () => {}) as never,
    pressKey: vi.fn(async () => {}) as never,
    scroll: vi.fn(async () => {}) as never,
    navigate: vi.fn(async () => {}) as never,
    recentNetwork: vi.fn(() => []) as never,
    ...overrides,
  };
}

function homeState(): SiteState {
  return {
    site: "test.com",
    state_id: "home",
    identify_by: { type: "url_pattern", regex: "/home" },
    affordances: [],
    observed_count: 1,
    confidence: 0.9,
    last_seen_at: 0,
  };
}

function makeIntention(overrides: Partial<Intention> = {}): Intention {
  return {
    site: "test.com",
    name: "test_intention",
    args_schema: {},
    steps: [],
    verify: [{ type: "url", pattern: "/home", description: "on home" }],
    failure_modes: [],
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe("IntentionCompiler — capability info Evidence (T5 M21)", () => {
  it("intention with capability declared → evidence includes info-severity note about capability", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });

    const intention = makeIntention({
      capability: { features: ["webrtc"] },
    });

    const outcome = await compiler.execute(makeAdapter(), intention, {});

    // Outcome must still succeed (verify passes).
    expect(outcome.ok).toBe(true);

    // There should be an info Evidence note about the capability.
    const capNote = outcome.evidence.find(
      (e) => e.severity === "info" && e.predicate.includes("capability"),
    );
    expect(capNote).toBeDefined();
    expect(capNote!.passed).toBe(true);
    expect(capNote!.source).toBe("predicate");
    expect(capNote!.severity).toBe("info");
  });

  it("intention without capability → no info note about capability in evidence", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });

    const intention = makeIntention(); // no capability field

    const outcome = await compiler.execute(makeAdapter(), intention, {});

    expect(outcome.ok).toBe(true);

    // Should have NO info Evidence about capability.
    const capNote = outcome.evidence.find(
      (e) => e.severity === "info" && e.predicate.includes("capability"),
    );
    expect(capNote).toBeUndefined();
  });
});
