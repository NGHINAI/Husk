import { describe, it, expect } from "vitest";
import type { AxTreeNode, AxState } from "../../src/cognition/predicate.js";

describe("AxTreeNode.s shape", () => {
  it("compiles with optional s field of AxState[]", () => {
    const node: AxTreeNode = {
      i: "n1",
      r: "button",
      n: "Send",
      s: [{ name: "disabled", value: { type: "boolean", value: true } }],
    };
    expect(node.s?.[0].name).toBe("disabled");
  });

  it("AxState is independently importable", () => {
    const s: AxState = { name: "checked", value: { value: true } };
    expect(s.name).toBe("checked");
  });
});
