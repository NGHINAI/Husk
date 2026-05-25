import { describe, it, expect, vi } from "vitest";
import { IntentionCompiler, type SessionAdapter } from "../../src/cognition/intention-compiler.js";
import { StateGraph } from "../../src/cognition/state-graph.js";
import type { Intention } from "../../src/cognition/intention-types.js";
import type { SiteState } from "../../src/cognition/types.js";

function makeAdapter(overrides: Partial<SessionAdapter> = {}): SessionAdapter {
  return {
    currentUrl: vi.fn(() => "https://test.com/home") as any,
    snapshot: vi.fn(async () => ({
      url: "https://test.com/home",
      root: {
        r: "main", n: "main", i: "r",
        c: [{ i: "b1", r: "button", n: "Go" }],
      },
    })) as any,
    click: vi.fn(async () => {}) as any,
    type: vi.fn(async () => {}) as any,
    pressKey: vi.fn(async () => {}) as any,
    scroll: vi.fn(async () => {}) as any,
    navigate: vi.fn(async () => {}) as any,
    recentNetwork: vi.fn(() => []) as any,
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

describe("IntentionCompiler", () => {
  it("executes a no-state-requirement intention successfully", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());

    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com",
      name: "click_go",
      args_schema: {},
      steps: [{ verb: "click", target: { button: "Go" } }],
      verify: [{ type: "url", pattern: "/home", description: "still on home" }],
      failure_modes: [],
      created_at: 0,
      updated_at: 0,
    };

    const adapter = makeAdapter();
    const outcome = await compiler.execute(adapter, intention, {});

    expect(outcome.ok).toBe(true);
    expect(outcome.intention).toBe("click_go");
    expect(outcome.evidence).toHaveLength(1);
    expect(outcome.evidence[0].passed).toBe(true);
    expect(adapter.click).toHaveBeenCalledOnce();
  });

  it("returns no_path_to_target when no path exists", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());
    graph.upsertState({ ...homeState(), state_id: "isolated", identify_by: { type: "url_pattern", regex: "/never" } });

    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com",
      name: "x",
      args_schema: {},
      requires_state: "isolated",
      steps: [],
      verify: [],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(makeAdapter(), intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("no_path_to_target");
  });

  it("returns verify_failed when a verify check fails", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{ type: "url", pattern: "/should-not-match", description: "fake" }],
      failure_modes: [], created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(makeAdapter(), intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("verify_failed");
    expect(outcome.evidence[0].passed).toBe(false);
  });

  it("classifies thrown errors via failure-taxonomy", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const adapter = makeAdapter({
      click: vi.fn(async () => { throw new Error("HTTP 429 too many requests"); }) as any,
    });
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [{ verb: "click", target: { button: "Go" } }],
      verify: [], failure_modes: [], created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("rate_limited");
  });

  it("matches failure_mode patterns even on apparent success", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [],
      failure_modes: [{
        reason: "rate_limited",
        match: { type: "network", url_pattern: "/api", status_min: 429, status_max: 429, description: "429" },
      }],
      created_at: 0, updated_at: 0,
    };
    const adapter = makeAdapter({
      recentNetwork: vi.fn(() => [{ method: "GET", url: "https://x/api", status: 429, ts: 1 }]) as any,
    });
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("rate_limited");
  });

  it("interpolates {{args.X}} in type values", async () => {
    const graph = new StateGraph("test.com", new Map(), []);
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const adapter = makeAdapter({
      snapshot: vi.fn(async () => ({
        url: "https://test.com/home",
        root: { i: "r", r: "main", n: "main", c: [{ i: "t1", r: "textbox", n: "Email" }] },
      })) as any,
    });
    const intention: Intention = {
      site: "test.com", name: "fill", args_schema: {},
      steps: [{ verb: "type", target: { textbox: "Email" }, value: "{{args.email}}" }],
      verify: [], failure_modes: [], created_at: 0, updated_at: 0,
    };
    await compiler.execute(adapter, intention, { email: "u@example.com" });
    expect(adapter.type).toHaveBeenCalledWith("t1", "u@example.com");
  });
});
