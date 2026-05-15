import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../../src/snapshot/poller.js";
import type { Snapshot, SnapshotNode } from "../../src/snapshot/types.js";

function snap(root: SnapshotNode, url = "https://example.com"): Snapshot {
  return { v: 1, url, count: countNodes(root), root };
}

function countNodes(n: SnapshotNode): number {
  return 1 + (n.c ?? []).reduce((s, c) => s + countNodes(c), 0);
}

function node(id: string, role = "button", name = "x", children: SnapshotNode[] = []): SnapshotNode {
  return { i: id, r: role, n: name, s: ["e", "v"], c: children.length ? children : undefined };
}

describe("diffSnapshots", () => {
  it("returns empty diff for identical snapshots", () => {
    const s = snap(node("a:1", "main", "M", [node("b:2"), node("b:3")]));
    const diff = diffSnapshots(s, s);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("detects an added node", () => {
    const before = snap(node("a:1", "main", "M", [node("b:2")]));
    const after = snap(node("a:1", "main", "M", [node("b:2"), node("b:3")]));
    const diff = diffSnapshots(before, after);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].i).toBe("b:3");
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("detects a removed node by stable_id", () => {
    const before = snap(node("a:1", "main", "M", [node("b:2"), node("b:3")]));
    const after = snap(node("a:1", "main", "M", [node("b:2")]));
    const diff = diffSnapshots(before, after);
    expect(diff.removed).toEqual(["b:3"]);
  });

  it("detects a changed node when state flags differ", () => {
    const before = snap(node("a:1", "main", "M", [{ i: "b:2", r: "button", n: "Submit", s: ["e", "v"] }]));
    const after = snap(node("a:1", "main", "M", [{ i: "b:2", r: "button", n: "Submit", s: ["d", "v"] }]));
    const diff = diffSnapshots(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].id).toBe("b:2");
    expect(diff.changed[0].before.s).toEqual(["e", "v"]);
    expect(diff.changed[0].after.s).toEqual(["d", "v"]);
  });

  it("detects a name change as a removal+addition (because stable_id changes)", () => {
    const before = snap(node("a:1", "main", "M", [{ i: "b:2", r: "button", n: "Old", s: ["e"] }]));
    const after = snap(node("a:1", "main", "M", [{ i: "b:3", r: "button", n: "New", s: ["e"] }]));
    const diff = diffSnapshots(before, after);
    expect(diff.removed).toContain("b:2");
    expect(diff.added.map((n) => n.i)).toContain("b:3");
    expect(diff.changed).toEqual([]);
  });
});
