import { describe, it, expect, vi } from "vitest";
import { filterVisible } from "../../src/snapshot/visible.js";

describe("filterVisible", () => {
  it("drops nodes outside viewport bbox; keeps in-viewport nodes", async () => {
    const cdp = { send: vi.fn() };
    // Mock DOM.getBoxModel: in-view for backendNodeId 1, off-screen for 2
    cdp.send.mockImplementation(async (method: string, params: any) => {
      if (method === "DOM.getBoxModel") {
        if (params.backendNodeId === 1) return { model: { content: [10, 10, 100, 10, 100, 100, 10, 100] } };
        if (params.backendNodeId === 2) return { model: { content: [-300, -300, -100, -300, -100, -100, -300, -100] } };
        return null;
      }
      return null;
    });
    const root = {
      i: "r", r: "main", n: "", c: [
        { i: "a", r: "button", n: "Visible", backendNodeId: 1 },
        { i: "b", r: "button", n: "OffScreen", backendNodeId: 2 },
      ],
    };
    const out = await filterVisible(cdp as any, root, { width: 1280, height: 800 });
    expect(out.c).toHaveLength(1);
    expect(out.c![0].i).toBe("a");
  });

  it("retains ancestor when descendant is visible (even if ancestor itself has no bbox)", async () => {
    const cdp = { send: vi.fn() };
    cdp.send.mockImplementation(async (method: string, params: any) => {
      if (method === "DOM.getBoxModel") {
        if (params.backendNodeId === 10) return null; // ancestor: no bbox
        if (params.backendNodeId === 20) return { model: { content: [50, 50, 200, 50, 200, 200, 50, 200] } }; // visible child
      }
      return null;
    });
    const root = {
      i: "r", r: "main", n: "",
      c: [{ i: "wrap", r: "group", n: "", backendNodeId: 10, c: [
        { i: "btn", r: "button", n: "Click me", backendNodeId: 20 },
      ]}],
    };
    const out = await filterVisible(cdp as any, root, { width: 1280, height: 800 });
    expect(out.c).toHaveLength(1);
    expect(out.c![0].c).toHaveLength(1);
    expect(out.c![0].c![0].i).toBe("btn");
  });

  it("drops a node when neither it nor any descendant is visible", async () => {
    const cdp = { send: vi.fn() };
    cdp.send.mockImplementation(async (method: string, params: any) => {
      if (method === "DOM.getBoxModel") return null; // nothing visible
      return null;
    });
    const root = {
      i: "r", r: "main", n: "",
      c: [{ i: "ghost", r: "group", n: "", backendNodeId: 99, c: [
        { i: "x", r: "button", n: "Hidden", backendNodeId: 100 },
      ]}],
    };
    const out = await filterVisible(cdp as any, root, { width: 1280, height: 800 });
    expect(out.c).toEqual([]);
  });

  it("keeps nodes without backendNodeId by default (no bbox lookup possible)", async () => {
    const cdp = { send: vi.fn().mockResolvedValue(null) };
    const root = {
      i: "r", r: "main", n: "",
      c: [{ i: "synthetic", r: "generic", n: "synthetic node", c: [] }],
    };
    const out = await filterVisible(cdp as any, root, { width: 1280, height: 800 });
    expect(out.c).toHaveLength(1);  // kept because no backendNodeId → cannot prove off-screen
  });
});
