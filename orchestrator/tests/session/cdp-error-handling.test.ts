import { describe, it, expect, vi } from "vitest";
import { Session } from "../../src/session/session.js";

/** AX tree with a textbox and a button, both with backendDOMNodeIds. */
function makeAxNodes() {
  return [
    {
      nodeId: "root",
      role: { type: "role", value: "RootWebArea" },
      name: { type: "computedString", value: "Page" },
      properties: [],
      childIds: ["n0", "n1"],
      parentId: undefined,
    },
    {
      nodeId: "n0",
      role: { type: "role", value: "textbox" },
      name: { type: "computedString", value: "OTP Code" },
      properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }],
      childIds: [],
      parentId: "root",
      backendDOMNodeId: 10,
    },
    {
      nodeId: "n1",
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Submit" },
      properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }],
      childIds: [],
      parentId: "root",
      backendDOMNodeId: 20,
    },
  ];
}

describe("CDP error handling — engine_unsupported rejections", () => {
  it("performType wraps UnknownMethod into engine_unsupported and does NOT crash the session", async () => {
    // CDP that fails Input.dispatchKeyEvent with UnknownMethod AND Runtime fallback also fails
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: makeAxNodes() };
        if (method === "DOM.getBoxModel") return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
        if (method === "DOM.focus") return null;
        if (method === "Input.dispatchKeyEvent" || method === "Input.insertText") {
          const err: any = new Error("UnknownMethod");
          err.code = -31998;
          throw err;
        }
        // Runtime fallback also unavailable (simulate unsupported engine)
        if (method === "DOM.resolveNode") {
          const err: any = new Error("DOM.resolveNode not available");
          throw err;
        }
        return null;
      }),
      close: async () => {},
    };

    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    // Get a valid stable_id from the snapshot
    const snap = await session.snapshot();
    const textboxId = snap.root.c?.find((c) => c.r === "textbox")?.i;
    expect(textboxId).toBeDefined();

    const r = await session.type({ stable_id: textboxId! }, "123456");
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("engine_unsupported");
    expect((r as any).verb).toBe("type");

    // Session is NOT dead — a second snapshot call should still succeed.
    const snap2 = await session.snapshot();
    expect(snap2.root).toBeDefined();
  });

  it("performClick wraps UnknownMethod into engine_unsupported", async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: makeAxNodes() };
        if (method === "DOM.getBoxModel") {
          // Throw UnknownMethod on getBoxModel (click calls it first)
          const err: any = new Error("UnknownMethod");
          err.code = -31998;
          throw err;
        }
        return null;
      }),
      close: async () => {},
    };

    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const snap = await session.snapshot();
    const btnId = snap.root.c?.find((c) => c.r === "button")?.i;
    expect(btnId).toBeDefined();

    // Rebuild cdp to fail only on mouse events (post-getBoxModel)
    const cdp2 = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: makeAxNodes() };
        if (method === "DOM.getBoxModel") return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
        if (method === "Input.dispatchMouseEvent") {
          const err: any = new Error("UnknownMethod");
          err.code = -31998;
          throw err;
        }
        return null;
      }),
      close: async () => {},
    };

    const session2 = Session.fromInjected({ engine: { close: async () => {} }, cdp: cdp2, sessionId: "s2" });
    const snap2 = await session2.snapshot();
    const btnId2 = snap2.root.c?.find((c) => c.r === "button")?.i;
    expect(btnId2).toBeDefined();

    const r = await session2.click({ stable_id: btnId2! });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("engine_unsupported");
    expect((r as any).verb).toBe("click");

    // Session still alive — snapshot still works.
    const snap3 = await session2.snapshot();
    expect(snap3.root).toBeDefined();
  });

  it("non-UnknownMethod CDP errors are re-thrown (not swallowed)", async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: makeAxNodes() };
        if (method === "DOM.getBoxModel") return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
        if (method === "DOM.focus") return null;
        if (method === "Input.dispatchKeyEvent") {
          // A different error — not UnknownMethod
          const err: any = new Error("SessionNotFound");
          err.code = -32000;
          throw err;
        }
        return null;
      }),
      close: async () => {},
    };

    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const snap = await session.snapshot();
    const textboxId = snap.root.c?.find((c) => c.r === "textbox")?.i;
    expect(textboxId).toBeDefined();

    await expect(session.type({ stable_id: textboxId! }, "hello")).rejects.toThrow("SessionNotFound");
  });
});
