import { describe, expect, it } from "vitest";
import { transformAxTree } from "../../src/snapshot/adapter.js";
import type { AXNode } from "../../src/snapshot/types.js";

function ax(nodeId: string, role: string, name: string, parentId?: string, backendDOMNodeId?: number, ignored = false): AXNode {
  return {
    nodeId,
    parentId,
    childIds: [],
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    properties: [],
    ignored,
    backendDOMNodeId,
  } as unknown as AXNode;
}

describe("Snapshot SelectorResolver", () => {
  it("maps every emitted stable_id to its backendDOMNodeId", () => {
    const root = ax("1", "RootWebArea", "Page", undefined, 100);
    const button = ax("2", "button", "Submit", "1", 200);
    root.childIds = ["2"];
    const snap = transformAxTree([root, button], "1", "https://x.test");

    expect(snap._resolver).toBeDefined();
    expect(snap._resolver!.get(snap.root.i)).toBe(100);
    expect(snap._resolver!.get(snap.root.c![0].i)).toBe(200);
  });

  it("omits resolver entries for nodes lacking backendDOMNodeId", () => {
    const root = ax("1", "RootWebArea", "Page");
    const snap = transformAxTree([root], "1", "https://x.test");
    expect(snap._resolver!.has(snap.root.i)).toBe(false);
  });

  it("survives walk-through nodes (ignored=true) without losing descendant mappings", () => {
    const root = ax("1", "RootWebArea", "Page", undefined, 100);
    const wrapper = ax("2", "generic", "", "1", undefined, true);
    const btn = ax("3", "button", "OK", "2", 300);
    root.childIds = ["2"];
    wrapper.childIds = ["3"];
    const snap = transformAxTree([root, wrapper, btn], "1", "https://x.test");
    expect(snap._resolver!.get(snap.root.c![0].i)).toBe(300);
  });
});
