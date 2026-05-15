import { describe, expect, it, vi } from "vitest";
import { Session } from "../../src/session/session.js";

function fakeAxTree() {
  return {
    nodes: [{
      nodeId: "1", role: { type: "role", value: "RootWebArea" },
      name: { type: "computedString", value: "" }, properties: [], childIds: [],
    }],
  };
}

describe("snapshot cache + freshness", () => {
  it("returns cached snapshot within 500ms by default — no new CDP call", async () => {
    let calls = 0;
    const cdp = {
      send: vi.fn(async (m: string) => { if (m === "Accessibility.getFullAXTree") { calls++; return fakeAxTree(); } return null; }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://a.test/");        // eager → calls=1
    const initial = calls;
    await session.snapshot();                       // cached → still calls=1
    await session.snapshot();                       // cached
    expect(calls).toBe(initial);
  });

  it("re-fetches after maxAgeMs elapses", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const cdp = {
      send: vi.fn(async (m: string) => { if (m === "Accessibility.getFullAXTree") { calls++; return fakeAxTree(); } return null; }),
      close: async () => {},
    };
    try {
      const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
      // Simulate goto eagerly populating lastSnapshot without real timers:
      // call snapshot with force:true to prime the cache, then record call count.
      const gotoPromise = session.goto("https://a.test/");
      // Advance past the goto settle delay (1500ms) so goto completes.
      await vi.runAllTimersAsync();
      await gotoPromise;
      const initial = calls;
      // Advance time past the default 500ms freshness window.
      vi.advanceTimersByTime(600);
      await session.snapshot();
      expect(calls).toBe(initial + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("force: true bypasses the cache", async () => {
    let calls = 0;
    const cdp = {
      send: vi.fn(async (m: string) => { if (m === "Accessibility.getFullAXTree") { calls++; return fakeAxTree(); } return null; }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://a.test/");
    const initial = calls;
    await session.snapshot({ force: true });
    expect(calls).toBe(initial + 1);
  });

  it("custom maxAgeMs = 0 forces always-refresh", async () => {
    let calls = 0;
    const cdp = {
      send: vi.fn(async (m: string) => { if (m === "Accessibility.getFullAXTree") { calls++; return fakeAxTree(); } return null; }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://a.test/");
    const initial = calls;
    await session.snapshot({ maxAgeMs: 0 });
    expect(calls).toBe(initial + 1);
  });
});
