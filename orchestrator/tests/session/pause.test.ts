import { describe, it, expect, vi } from "vitest";
import { Session } from "../../src/session/session.js";

/** Build a minimal CDP mock that returns a single-node AX tree and a box model. */
function makeCdp() {
  return {
    send: vi.fn(async (method: string) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              nodeId: "1",
              role: { type: "role", value: "RootWebArea" },
              name: { type: "computedString", value: "" },
              properties: [],
              childIds: [],
            },
          ],
        };
      }
      if (method === "DOM.getBoxModel") {
        return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
      }
      return null;
    }),
    close: async () => {},
  };
}

describe("Session pause/resume", () => {
  it("paused session rejects click with session_paused", async () => {
    const cdp = makeCdp();
    const s = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    s.pause({ token: "tok123", handoff_url: "http://127.0.0.1:7777/handoff/tok123" });
    const r = await s.click({ stable_id: "x" });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("session_paused");
    expect((r as any).token).toBe("tok123");
    expect((r as any).handoff_url).toContain("handoff/tok123");
  });

  it("snapshot still works while paused", async () => {
    const cdp = makeCdp();
    const s = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    s.pause({ token: "t", handoff_url: null });
    const snap = await s.snapshot();
    expect(snap.root).toBeDefined();
  });

  it("after resume(), actions work again", async () => {
    const nodes = [
      {
        nodeId: "1",
        role: { type: "role", value: "RootWebArea" },
        name: { type: "computedString", value: "Page" },
        properties: [],
        childIds: ["2"],
      },
      {
        nodeId: "2",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Go" },
        properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }],
        childIds: [],
        backendDOMNodeId: 42,
      },
    ];
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") return { nodes };
        if (method === "DOM.getBoxModel") return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
        return null;
      }),
      close: async () => {},
    };
    const s = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    // First snapshot to populate stable_ids
    const snap = await s.snapshot();
    const btnId = snap.root.c?.find((c) => c.r === "button")?.i;
    expect(btnId).toBeDefined();

    s.pause({ token: "t", handoff_url: null });
    let r = await s.click({ stable_id: btnId! });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("session_paused");

    s.resume();
    r = await s.click({ stable_id: btnId! });
    expect(r.ok).toBe(true);
  });

  it("type, scroll, press_key, upload all gate when paused", async () => {
    const cdp = makeCdp();
    const s = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    s.pause({ token: "t", handoff_url: null });

    const t = await s.type({ stable_id: "x" }, "hi");
    const sc = await s.scroll({ stable_id: null }, "down", 100);
    const p = await s.press_key("Enter");
    const u = await s.upload({ stable_id: "x" }, { file_path: "/tmp/test.txt" });

    expect((t as any).reason).toBe("session_paused");
    expect((sc as any).reason).toBe("session_paused");
    expect((p as any).reason).toBe("session_paused");
    expect((u as any).reason).toBe("session_paused");
  });

  it("isPaused() returns the pause info or null", () => {
    const cdp = makeCdp();
    const s = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    expect(s.isPaused()).toBeNull();
    s.pause({ token: "abc", handoff_url: "x" });
    expect(s.isPaused()).toEqual({ token: "abc", handoff_url: "x" });
    s.resume();
    expect(s.isPaused()).toBeNull();
  });
});
