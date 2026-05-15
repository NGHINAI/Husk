import { describe, expect, it, vi } from "vitest";
import {
  dispatchClick,
  dispatchType,
  dispatchScroll,
  dispatchPress,
} from "../../src/session/actions.js";

function fakeCdp() {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    send: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "DOM.getBoxModel") {
        return { model: { content: [50, 80, 150, 80, 150, 120, 50, 120] } };
      }
      return null;
    }),
  };
}

describe("dispatchClick", () => {
  it("calls DOM.getBoxModel and dispatches mouse pressed+released at box center", async () => {
    const cdp = fakeCdp();
    await dispatchClick(cdp as any, "sess1", 42);
    expect(cdp.send).toHaveBeenCalledWith("DOM.getBoxModel", { backendNodeId: 42 }, "sess1");
    const pressed = cdp.calls.find((c) => c.method === "Input.dispatchMouseEvent" && c.params.type === "mousePressed");
    const released = cdp.calls.find((c) => c.method === "Input.dispatchMouseEvent" && c.params.type === "mouseReleased");
    expect(pressed).toBeDefined();
    expect(released).toBeDefined();
    expect(pressed!.params.x).toBe(100);
    expect(pressed!.params.y).toBe(100);
  });
});

describe("dispatchType", () => {
  it("focuses the element then dispatches one keypress per character", async () => {
    const cdp = fakeCdp();
    await dispatchType(cdp as any, "sess1", 42, "Hi");
    expect(cdp.calls[0]).toMatchObject({ method: "DOM.focus", params: { backendNodeId: 42 } });
    const keys = cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent" && c.params.type === "char");
    expect(keys.length).toBe(2);
    expect(keys[0].params.text).toBe("H");
    expect(keys[1].params.text).toBe("i");
  });
});

describe("dispatchScroll", () => {
  it("emits Input.dispatchMouseEvent type=mouseWheel with deltaY for direction=down", async () => {
    const cdp = fakeCdp();
    await dispatchScroll(cdp as any, "sess1", null, "down", 400);
    const wheel = cdp.calls.find((c) => c.method === "Input.dispatchMouseEvent");
    expect(wheel!.params.type).toBe("mouseWheel");
    expect(wheel!.params.deltaY).toBe(400);
  });
});

describe("dispatchPress", () => {
  it("dispatches keyDown + keyUp with the right CDP key code", async () => {
    const cdp = fakeCdp();
    await dispatchPress(cdp as any, "sess1", "Enter");
    const down = cdp.calls.find((c) => c.method === "Input.dispatchKeyEvent" && c.params.type === "keyDown");
    const up = cdp.calls.find((c) => c.method === "Input.dispatchKeyEvent" && c.params.type === "keyUp");
    expect(down!.params.key).toBe("Enter");
    expect(down!.params.code).toBe("Enter");
    expect(up).toBeDefined();
  });

  it("throws on unknown key", async () => {
    const cdp = fakeCdp();
    await expect(dispatchPress(cdp as any, "sess1", "Pizza")).rejects.toThrow(/Unknown key/);
  });
});

describe("dispatchScroll with stable_id (scrollIntoView)", () => {
  it("calls DOM.scrollIntoViewIfNeeded when backendNodeId provided", async () => {
    const cdp = fakeCdp();
    await dispatchScroll(cdp as any, "sess1", 99, "into_view", 0);
    expect(cdp.calls.some((c) =>
      c.method === "DOM.scrollIntoViewIfNeeded" && c.params.backendNodeId === 99
    )).toBe(true);
  });
});
