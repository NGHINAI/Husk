/**
 * intention-compiler-events.test.ts — M22 Phase E Task 3.
 *
 * Verifies that IntentionCompiler emits state_change events via CognitionBus
 * when a bus is provided in CompilerOptions, and remains silent (no throw)
 * when no bus is provided.
 */

import { describe, it, expect, vi } from "vitest";
import { IntentionCompiler, type SessionAdapter } from "../../src/cognition/intention-compiler.js";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";
import { StateGraph } from "../../src/cognition/state-graph.js";
import type { Intention } from "../../src/cognition/intention-types.js";
import type { SiteState } from "../../src/cognition/types.js";
import type { CognitionEvent } from "../../src/cognition/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function siteState(state_id: string, urlPattern: string): SiteState {
  return {
    site: "test.com",
    state_id,
    identify_by: { type: "url_pattern", regex: urlPattern },
    affordances: [],
    observed_count: 1,
    confidence: 0.9,
    last_seen_at: 0,
  };
}

function captureEvents(bus: CognitionBus): CognitionEvent[] {
  const captured: CognitionEvent[] = [];
  bus.subscribe("state_change", {}, (ev) => captured.push(ev));
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntentionCompiler — state_change emission (T3 M22)", () => {

  // Test 1: emits state_change for each successful transition in path traversal.
  it("emits state_change for each successful transition when bus is set", async () => {
    // Set up: home → page1 → page2 via two transitions.
    // The adapter rotates through snapshots so the compiler's post-transition
    // verification sees the correct to_state URL.

    const states = new Map<string, SiteState>([
      ["home",  siteState("home",  "/home")],
      ["page1", siteState("page1", "/page1")],
      ["page2", siteState("page2", "/page2")],
    ]);
    const transitions = [
      {
        site: "test.com",
        from_state: "home",
        to_state: "page1",
        action_sequence: [{ verb: "navigate" as const, url: "https://test.com/page1" }],
        success_count: 1,
        failure_count: 0,
        avg_duration_ms: 100,
        confidence: 0.9,
        last_used_at: 0,
      },
      {
        site: "test.com",
        from_state: "page1",
        to_state: "page2",
        action_sequence: [{ verb: "navigate" as const, url: "https://test.com/page2" }],
        success_count: 1,
        failure_count: 0,
        avg_duration_ms: 100,
        confidence: 0.9,
        last_used_at: 0,
      },
    ];
    const graph = new StateGraph("test.com", states, transitions);

    const bus = new CognitionBus();
    const emitted = captureEvents(bus);

    // Snapshots: initial (home), post-transition-1 (page1), post-transition-2 (page2),
    // then a final snap for intention.steps processing, then one more for verify.
    const snapHome  = { url: "https://test.com/home",  root: { i: "r", r: "main", n: "main" } };
    const snapPage1 = { url: "https://test.com/page1", root: { i: "r", r: "main", n: "main" } };
    const snapPage2 = { url: "https://test.com/page2", root: { i: "r", r: "main", n: "main" } };

    let snapIdx = 0;
    const snaps = [snapHome, snapPage1, snapPage2, snapPage2, snapPage2];
    const urlsFor = ["https://test.com/home", "https://test.com/page1", "https://test.com/page2", "https://test.com/page2", "https://test.com/page2"];

    const adapter = makeAdapter({
      snapshot: vi.fn(async () => snaps[Math.min(snapIdx, snaps.length - 1)]) as never,
      currentUrl: vi.fn(() => urlsFor[Math.min(snapIdx++, urlsFor.length - 1)]) as never,
    });

    const compiler = new IntentionCompiler({ graph, site: "test.com", bus });

    const intention: Intention = {
      site: "test.com",
      name: "go_to_page2",
      args_schema: {},
      requires_state: "page2",
      steps: [],
      verify: [{ type: "url", pattern: "/page2", description: "on page2" }],
      failure_modes: [],
      created_at: 0,
      updated_at: 0,
    };

    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(true);

    // Should have emitted at least one state_change event for the transitions.
    expect(emitted.length).toBeGreaterThanOrEqual(1);

    // Each emitted event must be a state_change with the correct shape.
    for (const ev of emitted) {
      expect(ev.type).toBe("state_change");
      expect(ev.session_id).toBeDefined();
      expect(ev.site).toBe("test.com");
      expect(ev.id).toMatch(/^[0-9a-f-]{36}$/); // UUID
    }

    // Transition 1: home → page1 should appear.
    const t1 = emitted.find((e) => e.payload.to_state === "page1");
    expect(t1).toBeDefined();
    expect(t1!.payload.from_state).toBe("home");

    // Transition 2: page1 → page2 should appear.
    const t2 = emitted.find((e) => e.payload.to_state === "page2");
    expect(t2).toBeDefined();
  });

  // Test 2: emits final state_change at end of execute() if state changed.
  it("emits state_change at end of execute() when state_before !== state_after", async () => {
    // One state only (home). The intention itself doesn't require a state, but
    // we set up the graph to identify "home" at start and a different URL at end
    // to simulate a state change during intention.steps execution.

    // Setup: start on "home" (/home), after steps end up on "detail" (/detail).
    const states = new Map<string, SiteState>([
      ["home",   siteState("home",   "/home")],
      ["detail", siteState("detail", "/detail")],
    ]);
    const graph = new StateGraph("test.com", states, []);

    const bus = new CognitionBus();
    const emitted = captureEvents(bus);

    // Snapshot sequence: initial=home, post-steps=detail (used by verify + finalState).
    const snapHome   = { url: "https://test.com/home",   root: { i: "r", r: "main", n: "main" } };
    const snapDetail = { url: "https://test.com/detail", root: { i: "r", r: "main", n: "main" } };

    let call = 0;
    const adapter = makeAdapter({
      snapshot: vi.fn(async () => {
        const s = call === 0 ? snapHome : snapDetail;
        call++;
        return s;
      }) as never,
      currentUrl: vi.fn(() =>
        call <= 1 ? "https://test.com/home" : "https://test.com/detail"
      ) as never,
    });

    const compiler = new IntentionCompiler({ graph, site: "test.com", bus });

    const intention: Intention = {
      site: "test.com",
      name: "navigate_to_detail",
      args_schema: {},
      steps: [{ verb: "navigate", url: "https://test.com/detail" }],
      verify: [{ type: "url", pattern: "/detail", description: "on detail" }],
      failure_modes: [],
      created_at: 0,
      updated_at: 0,
    };

    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(true);
    expect(outcome.state_before).toBe("home");
    expect(outcome.state_after).toBe("detail");

    // Must have emitted a final state_change (home → detail).
    const finalEv = emitted.find(
      (e) => e.payload.from_state === "home" && e.payload.to_state === "detail",
    );
    expect(finalEv).toBeDefined();
    expect(finalEv!.type).toBe("state_change");
    expect(finalEv!.session_id).toBeDefined();
  });

  // Test 3: no throw and no emission when bus is NOT set.
  it("does NOT throw and does NOT emit when bus is undefined (backward compat)", async () => {
    const states = new Map<string, SiteState>([
      ["home", siteState("home", "/home")],
    ]);
    const graph = new StateGraph("test.com", states, []);

    // No bus in CompilerOptions — should behave exactly as Phase D.
    const compiler = new IntentionCompiler({ graph, site: "test.com" });

    const adapter = makeAdapter();
    const intention: Intention = {
      site: "test.com",
      name: "simple",
      args_schema: {},
      steps: [],
      verify: [{ type: "url", pattern: "/home", description: "on home" }],
      failure_modes: [],
      created_at: 0,
      updated_at: 0,
    };

    // Must not throw.
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(true);
  });
});
