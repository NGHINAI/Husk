import { describe, expect, it } from "vitest";
import { transformAxTree } from "../../src/snapshot/adapter.js";
import type { AXNode } from "../../src/snapshot/types.js";

function ax(id: string, role: string, name: string, children: string[] = []): AXNode {
  return {
    nodeId: id,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    properties: [],
    childIds: children,
  } as unknown as AXNode;
}

describe("snapshot transformAxTree — terse mode", () => {
  it("'full' (default) preserves navigation/banner/contentinfo/complementary nodes", () => {
    const nodes = [
      ax("1", "RootWebArea", "Page", ["2", "3", "4", "5", "6"]),
      ax("2", "navigation", "Top nav"),
      ax("3", "banner", "Site banner"),
      ax("4", "main", "Content", ["7"]),
      ax("5", "complementary", "Sidebar"),
      ax("6", "contentinfo", "Footer"),
      ax("7", "paragraph", "Hello"),
    ];
    const snap = transformAxTree(nodes, "1", "https://x/");
    const roles = (snap.root.c ?? []).map((c) => c.r);
    expect(roles).toContain("navigation");
    expect(roles).toContain("banner");
    expect(roles).toContain("contentinfo");
    expect(roles).toContain("complementary");
  });

  it("'terse' drops navigation/banner/contentinfo/complementary entirely (and their subtrees)", () => {
    const nodes = [
      ax("1", "RootWebArea", "Page", ["2", "3", "4", "5", "6"]),
      ax("2", "navigation", "Top nav", ["8"]),
      ax("3", "banner", "Banner"),
      ax("4", "main", "Content", ["7"]),
      ax("5", "complementary", "Sidebar", ["9"]),
      ax("6", "contentinfo", "Footer"),
      ax("7", "paragraph", "Description"),
      ax("8", "link", "Pricing"),
      ax("9", "link", "Settings"),
    ];
    const snap = transformAxTree(nodes, "1", "https://x/", { mode: "terse" });
    const json = JSON.stringify(snap);
    expect(json).not.toContain("Pricing");
    expect(json).not.toContain("Settings");
    expect(json).not.toContain("Top nav");
    expect(json).not.toContain("Banner");
    expect(json).not.toContain("Footer");
    expect(json).not.toContain("Sidebar");
    expect(json).toContain("Description");
  });

  it("terse mode count reflects the dropped subtrees", () => {
    const nodes = [
      ax("1", "RootWebArea", "Page", ["2", "3"]),
      ax("2", "navigation", "Nav", ["4", "5"]),
      ax("3", "paragraph", "Body"),
      ax("4", "link", "A"),
      ax("5", "link", "B"),
    ];
    const fullSnap = transformAxTree(nodes, "1", "https://x/");
    const terseSnap = transformAxTree(nodes, "1", "https://x/", { mode: "terse" });
    expect(terseSnap.count).toBeLessThan(fullSnap.count);
  });

  it("terse mode preserves Snapshot v / url / root shape", () => {
    const nodes = [ax("1", "RootWebArea", "Page", ["2"]), ax("2", "navigation", "Nav")];
    const terseSnap = transformAxTree(nodes, "1", "https://x/", { mode: "terse" });
    expect(terseSnap.v).toBe(1);
    expect(terseSnap.url).toBe("https://x/");
    expect(terseSnap.root.r).toBe("RootWebArea");
  });
});
