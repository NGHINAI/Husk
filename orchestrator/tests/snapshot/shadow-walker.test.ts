import { describe, it, expect, vi } from "vitest";
import { walkWithShadow, enrichWithShadow } from "../../src/snapshot/shadow-walker.js";

describe("walkWithShadow", () => {
  it("returns node unchanged when it has no backendNodeId (synthetic)", async () => {
    const cdp = { send: vi.fn() };
    const node = { i: "x", r: "generic", n: "synthetic" };
    const out = await walkWithShadow(cdp as any, node);
    expect(out).toEqual(node);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it("returns node unchanged when DOM.describeNode reports no shadowRoots", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ node: { shadowRoots: [] } }) };
    const node = { i: "x", r: "button", n: "Plain", backendNodeId: 5, c: [] };
    const out = await walkWithShadow(cdp as any, node);
    expect(out).toEqual(node);
    // describeNode called, no getPartialAXTree call
    expect(cdp.send).toHaveBeenCalledTimes(1);
  });

  it("merges shadow root AX nodes into the host's children", async () => {
    const cdp = {
      send: vi.fn().mockImplementation(async (method: string, params: any) => {
        if (method === "DOM.describeNode" && params.backendNodeId === 1) {
          return { node: { shadowRoots: [{ backendNodeId: 99 }] } };
        }
        if (method === "Accessibility.getPartialAXTree" && params.backendNodeId === 99) {
          return {
            nodes: [
              { nodeId: "shadow-a", role: { value: "button" }, name: { value: "Shadow Btn A" } },
              { nodeId: "shadow-b", role: { value: "textbox" }, name: { value: "Shadow Input" } },
            ],
          };
        }
        return null;
      }),
    };
    const node = { i: "host", r: "generic", n: "Custom Element", backendNodeId: 1, c: [] };
    const out = await walkWithShadow(cdp as any, node);
    expect(out.c).toHaveLength(2);
    expect(out.c![0]).toMatchObject({ r: "button", n: "Shadow Btn A" });
    expect(out.c![1]).toMatchObject({ r: "textbox", n: "Shadow Input" });
    // ID is namespaced to avoid collisions with existing stable_ids
    expect(out.c![0].i).toMatch(/^shadow-/);
  });

  it("preserves existing children and appends shadow children after them", async () => {
    const cdp = {
      send: vi.fn().mockImplementation(async (method: string, params: any) => {
        if (method === "DOM.describeNode") return { node: { shadowRoots: [{ backendNodeId: 99 }] } };
        if (method === "Accessibility.getPartialAXTree") {
          return { nodes: [{ nodeId: "shadow-1", role: { value: "button" }, name: { value: "Shadow Btn" } }] };
        }
        return null;
      }),
    };
    const node = {
      i: "host", r: "generic", n: "Element", backendNodeId: 1,
      c: [{ i: "child1", r: "text", n: "Light DOM child" }],
    };
    const out = await walkWithShadow(cdp as any, node);
    expect(out.c).toHaveLength(2);
    expect(out.c![0].i).toBe("child1");  // existing children come first
    expect(out.c![1].n).toBe("Shadow Btn");
  });

  it("handles multiple shadow roots on one node", async () => {
    const cdp = {
      send: vi.fn().mockImplementation(async (method: string, params: any) => {
        if (method === "DOM.describeNode") {
          return { node: { shadowRoots: [{ backendNodeId: 11 }, { backendNodeId: 22 }] } };
        }
        if (method === "Accessibility.getPartialAXTree" && params.backendNodeId === 11) {
          return { nodes: [{ nodeId: "shadow-x", role: { value: "button" }, name: { value: "First" } }] };
        }
        if (method === "Accessibility.getPartialAXTree" && params.backendNodeId === 22) {
          return { nodes: [{ nodeId: "shadow-y", role: { value: "link" }, name: { value: "Second" } }] };
        }
        return null;
      }),
    };
    const node = { i: "host", r: "generic", n: "", backendNodeId: 5, c: [] };
    const out = await walkWithShadow(cdp as any, node);
    expect(out.c).toHaveLength(2);
    expect(out.c!.map((c) => c.n)).toEqual(["First", "Second"]);
  });

  it("CDP error returns the node unchanged (graceful degrade)", async () => {
    const cdp = { send: vi.fn().mockRejectedValue(new Error("UnknownMethod")) };
    const node = { i: "x", r: "button", n: "X", backendNodeId: 1, c: [] };
    const out = await walkWithShadow(cdp as any, node);
    expect(out).toEqual(node);
  });

  it("skips AX nodes missing role or name (best-effort)", async () => {
    const cdp = {
      send: vi.fn().mockImplementation(async (method: string, params: any) => {
        if (method === "DOM.describeNode") return { node: { shadowRoots: [{ backendNodeId: 99 }] } };
        if (method === "Accessibility.getPartialAXTree") {
          return { nodes: [
            { nodeId: "ok", role: { value: "button" }, name: { value: "Good" } },
            { nodeId: "broken" /* no role */ },
            { nodeId: "noname", role: { value: "button" } /* no name */ },
          ]};
        }
        return null;
      }),
    };
    const node = { i: "host", r: "generic", n: "", backendNodeId: 1, c: [] };
    const out = await walkWithShadow(cdp as any, node);
    // Only "ok" makes it through; the others get defaults
    expect(out.c).toHaveLength(3);
    expect(out.c!.map((c) => c.r)).toEqual(["button", "generic", "button"]);
    expect(out.c!.map((c) => c.n)).toEqual(["Good", "", ""]);
  });
});

describe("enrichWithShadow", () => {
  it("only probes likely shadow host roles (generic/Unknown/none)", async () => {
    const probedIds: number[] = [];
    const cdp = {
      send: vi.fn().mockImplementation(async (method: string, params: any) => {
        if (method === "DOM.describeNode") {
          probedIds.push(params.backendNodeId);
          return { node: { shadowRoots: [] } };
        }
        return null;
      }),
    };
    const root = {
      i: "root", r: "main", n: "", backendNodeId: 0, c: [
        { i: "a", r: "button", n: "btn", backendNodeId: 1 },  // NOT probed (button)
        { i: "b", r: "generic", n: "", backendNodeId: 2, c: [] },  // PROBED (generic + no kids)
        { i: "c", r: "generic", n: "", backendNodeId: 3, c: [{ i: "d", r: "text", n: "child" }] },  // NOT probed (has kids)
      ],
    };
    await enrichWithShadow(cdp as any, root);
    expect(probedIds).toEqual([2]);
  });
});
