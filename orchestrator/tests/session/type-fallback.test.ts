import { describe, it, expect, vi } from "vitest";
import { Session } from "../../src/session/session.js";

/** AX tree with a textbox (simulates a tel/OTP input). */
function makeAxNodes(role = "textbox") {
  return [
    {
      nodeId: "root",
      role: { type: "role", value: "RootWebArea" },
      name: { type: "computedString", value: "2FA Page" },
      properties: [],
      childIds: ["n0"],
      parentId: undefined,
    },
    {
      nodeId: "n0",
      role: { type: "role", value: role },
      name: { type: "computedString", value: "Enter OTP" },
      properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }],
      childIds: [],
      parentId: "root",
      backendDOMNodeId: 99,
    },
  ];
}

describe("husk_type JS fallback (Runtime.callFunctionOn)", () => {
  it("falls back to Runtime.callFunctionOn when CDP Input.dispatchKeyEvent fails with UnknownMethod", async () => {
    const cdpCalls: string[] = [];

    const cdp = {
      send: vi.fn(async (method: string) => {
        cdpCalls.push(method);
        if (method === "Accessibility.getFullAXTree") return { nodes: makeAxNodes() };
        if (method === "DOM.getBoxModel") return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
        if (method === "DOM.focus") return null;
        // Simulate lightpanda refusing Input.dispatchKeyEvent on tel inputs
        if (method === "Input.dispatchKeyEvent") {
          const err: any = new Error("UnknownMethod");
          err.code = -31998;
          throw err;
        }
        // JS fallback path: resolveNode → callFunctionOn
        if (method === "DOM.resolveNode") {
          return { object: { objectId: "obj-42" } };
        }
        if (method === "Runtime.callFunctionOn") {
          return { result: { value: true } };
        }
        return null;
      }),
      close: async () => {},
    };

    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const snap = await session.snapshot();
    const textboxId = snap.root.c?.find((c) => c.r === "textbox")?.i;
    expect(textboxId).toBeDefined();

    const r = await session.type({ stable_id: textboxId! }, "123456");

    // The fallback should have succeeded
    expect(r.ok).toBe(true);

    // Verify CDP fallback methods were called
    expect(cdpCalls).toContain("DOM.resolveNode");
    expect(cdpCalls).toContain("Runtime.callFunctionOn");
  });

  it("returns engine_unsupported when both CDP Input and JS fallback fail", async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: makeAxNodes() };
        if (method === "DOM.getBoxModel") return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
        if (method === "DOM.focus") return null;
        if (method === "Input.dispatchKeyEvent") {
          const err: any = new Error("UnknownMethod");
          err.code = -31998;
          throw err;
        }
        // JS fallback path: resolveNode returns null objectId
        if (method === "DOM.resolveNode") {
          return { object: {} }; // no objectId
        }
        return null;
      }),
      close: async () => {},
    };

    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const snap = await session.snapshot();
    const textboxId = snap.root.c?.find((c) => c.r === "textbox")?.i;
    expect(textboxId).toBeDefined();

    const r = await session.type({ stable_id: textboxId! }, "otp-code");
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("engine_unsupported");

    // Session is still alive — snapshot works
    const snap2 = await session.snapshot();
    expect(snap2.root).toBeDefined();
  });

  it("JS fallback dispatches input and change events (Runtime.callFunctionOn args carry the text)", async () => {
    let capturedArgs: unknown = null;

    const cdp = {
      send: vi.fn(async (method: string, params: unknown) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: makeAxNodes() };
        if (method === "DOM.getBoxModel") return { model: { content: [10, 10, 50, 10, 50, 30, 10, 30] } };
        if (method === "DOM.focus") return null;
        if (method === "Input.dispatchKeyEvent") {
          const err: any = new Error("UnknownMethod");
          err.code = -31998;
          throw err;
        }
        if (method === "DOM.resolveNode") {
          return { object: { objectId: "obj-99" } };
        }
        if (method === "Runtime.callFunctionOn") {
          capturedArgs = (params as any).arguments;
          return { result: { value: true } };
        }
        return null;
      }),
      close: async () => {},
    };

    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const snap = await session.snapshot();
    const textboxId = snap.root.c?.find((c) => c.r === "textbox")?.i;

    await session.type({ stable_id: textboxId! }, "987654");

    // Verify the text value was passed as the argument to callFunctionOn
    expect(capturedArgs).toBeDefined();
    const args = capturedArgs as Array<{ value: unknown }>;
    expect(args[0]?.value).toBe("987654");
  });
});
