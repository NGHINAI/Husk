import { describe, it, expect, vi } from "vitest";
import { Session } from "../../src/session/session.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function rootOnlyNode(id = "1") {
  return {
    nodeId: id,
    role: { type: "role", value: "RootWebArea" },
    name: { type: "computedString", value: "" },
    properties: [],
    childIds: [],
  };
}

function buttonNode(id: string, backendId = 42) {
  return {
    nodeId: id,
    role: { type: "role", value: "button" },
    name: { type: "computedString", value: "Go" },
    properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }],
    childIds: [],
    backendDOMNodeId: backendId,
  };
}

function textboxNode(id: string, backendId = 43) {
  return {
    nodeId: id,
    role: { type: "role", value: "textbox" },
    name: { type: "computedString", value: "Field" },
    properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }],
    childIds: [],
    backendDOMNodeId: backendId,
  };
}

/** Build a CDP mock that returns AX trees and a box model, counting AX calls. */
function makeCdp(nodes: object[]) {
  let axCalls = 0;
  const send = vi.fn(async (method: string) => {
    if (method === "Accessibility.getFullAXTree") {
      axCalls++;
      return { nodes };
    }
    if (method === "DOM.getBoxModel") {
      return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
    }
    return null;
  });
  return { send, close: async () => {}, get axCalls() { return axCalls; } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("post-action snapshot inline", () => {
  it("click result includes a snapshot field by default", async () => {
    const nodes = [
      { nodeId: "1", role: { type: "role", value: "RootWebArea" }, name: { type: "computedString", value: "Page" }, properties: [], childIds: ["2"] },
      buttonNode("2"),
    ];
    const cdp = makeCdp(nodes);
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");
    const snap = await session.snapshot();
    const btnId = snap.root.c?.find((c) => c.r === "button")?.i;
    expect(btnId).toBeDefined();

    const result = await session.click({ stable_id: btnId! });
    expect(result.ok).toBe(true);
    expect((result as { snapshot?: unknown }).snapshot).toBeDefined();
  });

  it("click({include_snapshot:false}) omits the snapshot field", async () => {
    const nodes = [
      { nodeId: "1", role: { type: "role", value: "RootWebArea" }, name: { type: "computedString", value: "Page" }, properties: [], childIds: ["2"] },
      buttonNode("2"),
    ];
    const cdp = makeCdp(nodes);
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");
    const snap = await session.snapshot();
    const btnId = snap.root.c?.find((c) => c.r === "button")?.i;
    expect(btnId).toBeDefined();

    // Count AX tree calls before the click to verify snapshot is NOT called extra
    const axBefore = cdp.send.mock.calls.filter((c) => c[0] === "Accessibility.getFullAXTree").length;

    const result = await session.click({ stable_id: btnId!, include_snapshot: false });
    expect((result as { snapshot?: unknown }).snapshot).toBeUndefined();

    // With include_snapshot:false there should be exactly 1 extra AX call (the
    // force:true snapshot inside performClick) but no additional cache-read call.
    const axAfter = cdp.send.mock.calls.filter((c) => c[0] === "Accessibility.getFullAXTree").length;
    // The post-action force:true snapshot inside performClick should be 1 extra call.
    // No additional snapshot() call should happen (efficiency contract).
    expect(axAfter - axBefore).toBe(1);
  });

  it("type result includes snapshot by default", async () => {
    const nodes = [
      { nodeId: "1", role: { type: "role", value: "RootWebArea" }, name: { type: "computedString", value: "Login" }, properties: [], childIds: ["2"] },
      textboxNode("2"),
    ];
    const cdp = makeCdp(nodes);
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");
    const snap = await session.snapshot();
    const tbId = snap.root.c?.find((c) => c.r === "textbox")?.i;
    expect(tbId).toBeDefined();

    const result = await session.type({ stable_id: tbId! }, "hello");
    expect(result.ok).toBe(true);
    expect((result as any).snapshot).toBeDefined();
  });

  it("scroll result includes snapshot by default", async () => {
    const cdp = makeCdp([rootOnlyNode()]);
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");

    const result = await session.scroll({ stable_id: null }, "down", 100);
    expect(result.ok).toBe(true);
    expect((result as any).snapshot).toBeDefined();
  });

  it("press_key result includes snapshot by default", async () => {
    const cdp = makeCdp([rootOnlyNode()]);
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");

    const result = await session.press_key("Enter");
    expect(result.ok).toBe(true);
    expect((result as any).snapshot).toBeDefined();
  });

  it("rejection result (element_not_found) also includes snapshot", async () => {
    const cdp = makeCdp([rootOnlyNode()]);
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");

    // Click a nonexistent stable_id → triggers element_not_found rejection
    const result = await session.click({ stable_id: "button:totally-fake" });
    expect(result.ok).toBe(false);
    // Rejection envelopes still carry snapshot (post-rejection state)
    expect((result as any).snapshot).toBeDefined();
  });

  it("rejection result via watchdog evaluatePre also includes snapshot", async () => {
    // A disabled button triggers a watchdog rejection before dispatch
    const nodes = [
      { nodeId: "1", role: { type: "role", value: "RootWebArea" }, name: { type: "computedString", value: "Page" }, properties: [], childIds: ["2"] },
      {
        nodeId: "2",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Disabled" },
        // disabled = true
        properties: [
          { name: "disabled", value: { type: "booleanOrUndefined", value: true } },
        ],
        childIds: [],
        backendDOMNodeId: 44,
      },
    ];
    const cdp = makeCdp(nodes);
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");
    const snap = await session.snapshot();
    const btnId = snap.root.c?.find((c) => c.r === "button")?.i;
    expect(btnId).toBeDefined();

    const result = await session.click({ stable_id: btnId! });
    expect(result.ok).toBe(false);
    expect((result as any).snapshot).toBeDefined();
  });
});
