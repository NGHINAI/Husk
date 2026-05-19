import { describe, it, expect } from "vitest";
import { TabGroup } from "../../src/session/tab-group.js";

describe("TabGroup", () => {
  it("first session is root of its own group; no siblings", () => {
    const g = new TabGroup();
    g.register("s1", null);
    expect(g.siblings("s1")).toEqual([]);
  });

  it("child registered with parent lists parent as sibling, and vice versa", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    expect(g.siblings("s1")).toEqual(["s2"]);
    expect(g.siblings("s2")).toEqual(["s1"]);
  });

  it("three siblings each see the other two", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    g.register("s3", "s1");
    expect(g.siblings("s1").sort()).toEqual(["s2", "s3"]);
    expect(g.siblings("s2").sort()).toEqual(["s1", "s3"]);
    expect(g.siblings("s3").sort()).toEqual(["s1", "s2"]);
  });

  it("child of child still belongs to the same group (root parent)", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    g.register("s3", "s2");  // s3 is grandchild — still in s1's group
    expect(g.siblings("s3").sort()).toEqual(["s1", "s2"]);
  });

  it("closeGroup(root) returns all session ids and tears the group down", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    g.register("s3", "s1");
    const closed = g.closeGroup("s1");
    expect(closed.sort()).toEqual(["s1", "s2", "s3"]);
    // After cascade close, all rootOf entries cleared
    expect(g.siblings("s1")).toEqual([]);
    expect(g.siblings("s2")).toEqual([]);
  });

  it("closeGroup(child) only closes that child, root + other siblings remain", () => {
    const g = new TabGroup();
    g.register("s1", null);
    g.register("s2", "s1");
    g.register("s3", "s1");
    const closed = g.closeGroup("s2");
    expect(closed).toEqual(["s2"]);
    expect(g.siblings("s1")).toEqual(["s3"]);
    expect(g.siblings("s3")).toEqual(["s1"]);
    // s2 no longer registered
    expect(g.siblings("s2")).toEqual([]);
  });

  it("register with unknown parent throws", () => {
    const g = new TabGroup();
    expect(() => g.register("s2", "ghost")).toThrow(/unknown parent/);
  });

  it("siblings for unregistered session returns empty array (not crash)", () => {
    const g = new TabGroup();
    expect(g.siblings("never_registered")).toEqual([]);
  });

  it("closeGroup for unregistered session returns just that id (idempotent)", () => {
    const g = new TabGroup();
    expect(g.closeGroup("ghost")).toEqual(["ghost"]);
  });
});
