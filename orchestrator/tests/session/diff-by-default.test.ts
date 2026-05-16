import { describe, expect, it, vi } from "vitest";
import { Session } from "../../src/session/session.js";

function axNode(id: string, role: string, name: string, children: string[] = [], interactive = false) {
  return {
    nodeId: id,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    // Provide focusable:true for interactive nodes so the adapter sets "e" (enabled).
    properties: interactive ? [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }] : [],
    childIds: children,
    // Provide a backendDOMNodeId so the resolver can map the stable_id → DOM node.
    backendDOMNodeId: interactive ? 42 : undefined,
  };
}

describe("diff-by-default in action results", () => {
  it("click() includes diff against the pre-action snapshot", async () => {
    let snapshotN = 0;
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          snapshotN++;
          if (snapshotN <= 1) {
            // Initial snapshot (goto eager snapshot): button only
            return {
              nodes: [
                { ...axNode("1", "RootWebArea", "Page", ["2"]) },
                { ...axNode("2", "button", "Go", [], true) },
              ],
            };
          }
          // Post-action (force:true from click()): button + alert
          return {
            nodes: [
              { ...axNode("1", "RootWebArea", "Page", ["2", "3"]) },
              { ...axNode("2", "button", "Go", [], true) },
              { ...axNode("3", "alert", "Submitted") },
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
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");
    const snap = await session.snapshot();
    const buttonId = snap.root.c?.find((c) => c.r === "button")?.i;
    expect(buttonId).toBeDefined();

    // Force a stale-cache miss so the post-action snapshot is fresh.
    const result = await session.click({ stable_id: buttonId! });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.diff).toBeDefined();
    expect(result.diff?.added?.some((n) => n.r === "alert")).toBe(true);
  });

  it("watchdog rejection does NOT include diff", async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [{ nodeId: "1", role: { type: "role", value: "RootWebArea" }, name: { type: "computedString", value: "" }, properties: [], childIds: [] }],
          };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");
    const result = await session.click({ stable_id: "button:totally-fake" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("element_not_found");
      // Rejection envelopes do NOT have a `diff` field.
      expect("diff" in result).toBe(false);
    }
  });

  it("type() returns diff on success", async () => {
    // The same pattern — type into a textbox, snapshot grows.
    let snapshotN = 0;
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          snapshotN++;
          if (snapshotN <= 1) {
            return {
              nodes: [
                { ...axNode("1", "RootWebArea", "Login", ["2"]) },
                { ...axNode("2", "textbox", "Username", [], true) },
              ],
            };
          }
          return {
            nodes: [
              { ...axNode("1", "RootWebArea", "Login", ["2", "3"]) },
              { ...axNode("2", "textbox", "Username", [], true) },
              { ...axNode("3", "alert", "Field updated") },
            ],
          };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.goto("https://x.test/");
    const snap = await session.snapshot();
    const tb = snap.root.c?.find((c) => c.r === "textbox");
    expect(tb).toBeDefined();
    const result = await session.type({ stable_id: tb!.i }, "hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diff).toBeDefined();
    }
  });
});
