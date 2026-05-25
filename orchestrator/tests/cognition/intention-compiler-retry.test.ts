import { describe, it, expect, vi } from "vitest";
import { IntentionCompiler, type SessionAdapter } from "../../src/cognition/intention-compiler.js";
import { StateGraph } from "../../src/cognition/state-graph.js";
import type { Intention } from "../../src/cognition/intention-types.js";

function makeAdapter(snaps: any[]): SessionAdapter {
  let i = 0;
  const next = () => snaps[Math.min(i++, snaps.length - 1)];
  return {
    currentUrl: vi.fn(() => "https://test.com/" + (snaps[Math.min(i, snaps.length - 1)]?.urlPath ?? "x")) as any,
    snapshot: vi.fn(async () => next()) as any,
    click: vi.fn(async () => {}) as any,
    type: vi.fn(async () => {}) as any,
    pressKey: vi.fn(async () => {}) as any,
    scroll: vi.fn(async () => {}) as any,
    navigate: vi.fn(async () => {}) as any,
    recentNetwork: vi.fn(() => []) as any,
  };
}

const homeState = () => ({
  site: "test.com",
  state_id: "home",
  identify_by: { type: "url_pattern", regex: "/" },
  affordances: [],
  observed_count: 1,
  confidence: 0.9,
  last_seen_at: 0,
});

describe("IntentionCompiler retry integration", () => {
  it("uses polling when any verify check has retry", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });

    // First four snapshots show "Loading" (consumed by initial state + step 3 + two polls),
    // fifth shows "Done" so polling ends with attempts >= 2.
    const snaps = [
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Loading"}] } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Loading"}] } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Loading"}] } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Loading"}] } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Done"}] } },
    ];
    const adapter = makeAdapter(snaps);

    const intention: Intention = {
      site: "test.com", name: "wait_done", args_schema: {},
      steps: [],
      verify: [
        { type: "text_present", pattern: "Done", description: "shows done",
          retry: { timeout_ms: 500, interval_ms: 5 } },
      ],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };

    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(true);
    expect(outcome.evidence[0].passed).toBe(true);
    expect(outcome.evidence[0].attempts).toBeGreaterThanOrEqual(2);
  });

  it("single-shot when no check has retry (preserves Phase B behavior)", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const snaps = [{ url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"" } }];
    const adapter = makeAdapter(snaps);
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{ type: "url", pattern: "/", description: "still on root" }],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };
    await compiler.execute(adapter, intention, {});
    // snapshot called: once before execution (step 1) + once for verify-ctx = 2 expected (not polling)
    expect((adapter.snapshot as any).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("returns verify_failed after timeout when condition never reached", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const snaps = [{ url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"" } }];
    const adapter = makeAdapter(snaps);
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{
        type: "text_present", pattern: "ImpossibleString", description: "never appears",
        retry: { timeout_ms: 30, interval_ms: 5 },
      }],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("verify_failed");
    expect(outcome.evidence[0].attempts).toBeGreaterThan(1);
  });

  it("failure_mode with retry polls before classifying", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    // Snapshots show the bot-challenge text appearing after a delay
    const snaps = [
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"" } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"t",r:"heading",n:"Unusual activity"}] } },
    ];
    const adapter = makeAdapter(snaps);
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{ type: "url", pattern: "/", description: "any" }],
      failure_modes: [{
        reason: "bot_challenge",
        match: { type: "text_present", pattern: "Unusual activity", description: "bot challenge",
                 retry: { timeout_ms: 100, interval_ms: 5 } },
      }],
      created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("bot_challenge");
  });
});
