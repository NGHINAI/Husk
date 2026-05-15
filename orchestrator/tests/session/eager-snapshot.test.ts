import { describe, expect, it, vi } from "vitest";
import { Session } from "../../src/session/session.js";

describe("eager snapshot in goto", () => {
  it("captures lastSnapshot inside goto() so subsequent snapshot() is a cache hit", async () => {
    let getAxTreeCalls = 0;
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          getAxTreeCalls++;
          return {
            nodes: [{
              nodeId: "1", role: { type: "role", value: "RootWebArea" },
              name: { type: "computedString", value: "Page" }, properties: [], childIds: [],
            }],
          };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
    });

    await session.goto("https://x.test/");
    expect(getAxTreeCalls).toBe(1);

    // snapshot() within freshness window returns the cached value — no new CDP call.
    const snap = await session.snapshot();
    expect(getAxTreeCalls).toBe(1);
    expect(snap.url).toBe("https://x.test/");
  });

  it("captures lastSnapshot AFTER navigation, with the new url", async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Page.navigate") return { frameId: "f1" };
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [{
              nodeId: "1", role: { type: "role", value: "RootWebArea" },
              name: { type: "computedString", value: "" }, properties: [], childIds: [],
            }],
          };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://new.test/");
    const snap = await session.snapshot();
    expect(snap.url).toBe("https://new.test/");
  });

  it("calling goto twice replaces lastSnapshot with the second page's snapshot", async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [{
              nodeId: "1", role: { type: "role", value: "RootWebArea" },
              name: { type: "computedString", value: "" }, properties: [], childIds: [],
            }],
          };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://a.test/");
    await session.goto("https://b.test/");
    const snap = await session.snapshot();
    expect(snap.url).toBe("https://b.test/");
  });

  it("does not throw goto if eager snapshot fails (best-effort)", async () => {
    let getAxTreeCalls = 0;
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          getAxTreeCalls++;
          if (getAxTreeCalls === 1) throw new Error("transient");
          return {
            nodes: [{
              nodeId: "1", role: { type: "role", value: "RootWebArea" },
              name: { type: "computedString", value: "" }, properties: [], childIds: [],
            }],
          };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    // Should not throw despite the first AX-tree call failing.
    await expect(session.goto("https://x.test/")).resolves.toBeUndefined();
    // Manual snapshot afterward should still work.
    const snap = await session.snapshot({ force: true });
    expect(snap.url).toBe("https://x.test/");
  });
});
