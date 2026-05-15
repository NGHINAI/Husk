import { describe, expect, it } from "vitest";
import { transformAxTree } from "../../src/snapshot/adapter.js";
import type { AXNode } from "../../src/snapshot/types.js";

function ax(
  nodeId: string,
  role: string,
  name: string,
  childIds: string[] = [],
  properties: AXNode["properties"] = undefined
): AXNode {
  return {
    nodeId,
    ignored: false,
    role: { type: "internalRole", value: role },
    name: { type: "computedString", value: name },
    childIds,
    properties,
  };
}

function tree(...nodes: AXNode[]): AXNode[] {
  return nodes;
}

describe("transformAxTree", () => {
  it("emits a Snapshot with v=1 and the supplied URL", () => {
    const nodes = tree(ax("1", "RootWebArea", "Page"));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.v).toBe(1);
    expect(snap.url).toBe("https://example.com");
    expect(snap.count).toBe(1);
    expect(snap.root.r).toBe("RootWebArea");
  });

  it("assigns short-key fields per spec §5.2", () => {
    const nodes = tree(ax("1", "button", "Submit"));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root).toMatchObject({
      r: "button",
      n: "Submit",
    });
    expect(snap.root.i).toMatch(/^button:[A-Za-z0-9_-]{22}$/);
    expect(snap.root.s).toContain("e"); // enabled by default
  });

  it("skip-through prunes passthrough roles (generic, none, StaticText, InlineTextBox)", () => {
    const nodes = tree(
      ax("1", "main", "Main", ["2", "3"]),
      ax("2", "generic", "wrapper", ["4"]),
      ax("3", "StaticText", "loose text"),
      ax("4", "button", "Submit")
    );
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root.r).toBe("main");
    const children = snap.root.c ?? [];
    expect(children.length).toBe(1);
    expect(children[0].r).toBe("button");
    expect(snap.count).toBe(2); // main + button
  });

  it("computes the disabled state from the absence of `focusable` property", () => {
    const nodes = tree(ax("1", "button", "Disabled", [], []));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root.s).toContain("d");
    expect(snap.root.s).not.toContain("e");
  });

  it("sets enabled flag when `focusable` is true on a button", () => {
    const nodes = tree(ax("1", "button", "Submit", [], [
      { name: "focusable", value: { type: "booleanOrUndefined", value: true } },
    ]));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root.s).toContain("e");
    expect(snap.root.s).not.toContain("d");
  });

  it("sets checked flag for checkboxes when `checked` property is true", () => {
    const nodes = tree(ax("1", "checkbox", "Agree", [], [
      { name: "focusable", value: { type: "booleanOrUndefined", value: true } },
      { name: "checked", value: { type: "tristate", value: true } },
    ]));
    const snap = transformAxTree(nodes, "1", "https://example.com");
    expect(snap.root.s).toContain("c");
    expect(snap.root.s).toContain("e");
  });

  it("assigns identical stable_ids to identical (role, name, position) tuples", () => {
    const nodes = tree(ax("1", "RootWebArea", "", ["2"]), ax("2", "button", "Submit"));
    const a = transformAxTree(nodes, "1", "https://example.com");
    const b = transformAxTree(nodes, "1", "https://example.com");
    expect(a.root.c?.[0].i).toBe(b.root.c?.[0].i);
  });

  it("assigns different stable_ids to two same-role-same-name buttons at different positions", () => {
    const nodes = tree(
      ax("1", "RootWebArea", "", ["2", "3"]),
      ax("2", "button", "Submit"),
      ax("3", "button", "Submit")
    );
    const snap = transformAxTree(nodes, "1", "https://example.com");
    const [a, b] = snap.root.c ?? [];
    expect(a.i).not.toBe(b.i);
  });
});
