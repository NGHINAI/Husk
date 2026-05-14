import { describe, expect, it } from "vitest";
import {
  UPSTREAM_TO_HUSK,
  HUSK_TO_UPSTREAM,
  upstreamNameOf,
  huskNameOf,
} from "../src/tool-map.js";

describe("tool name mapping", () => {
  it("covers all 20 upstream tools known from the M2 spike", () => {
    const expected = [
      "goto",
      "navigate",
      "evaluate",
      "eval",
      "markdown",
      "links",
      "semantic_tree",
      "nodeDetails",
      "interactiveElements",
      "structuredData",
      "detectForms",
      "click",
      "fill",
      "scroll",
      "waitForSelector",
      "hover",
      "press",
      "selectOption",
      "setChecked",
      "findElement",
    ];
    for (const name of expected) {
      expect(UPSTREAM_TO_HUSK).toHaveProperty(name);
      expect(UPSTREAM_TO_HUSK[name]).toMatch(/^husk_/);
    }
    expect(Object.keys(UPSTREAM_TO_HUSK)).toHaveLength(20);
  });

  it("HUSK_TO_UPSTREAM is the exact inverse of UPSTREAM_TO_HUSK", () => {
    for (const [upstream, husk] of Object.entries(UPSTREAM_TO_HUSK)) {
      expect(HUSK_TO_UPSTREAM[husk]).toBe(upstream);
    }
    expect(Object.keys(HUSK_TO_UPSTREAM)).toHaveLength(Object.keys(UPSTREAM_TO_HUSK).length);
  });

  it("upstreamNameOf converts husk_* back to upstream", () => {
    expect(upstreamNameOf("husk_goto")).toBe("goto");
    expect(upstreamNameOf("husk_snapshot")).toBe("semantic_tree");
  });

  it("upstreamNameOf returns the input unchanged when name is not Husk-prefixed", () => {
    expect(upstreamNameOf("unknown_tool")).toBe("unknown_tool");
  });

  it("huskNameOf converts upstream to husk_*", () => {
    expect(huskNameOf("goto")).toBe("husk_goto");
    expect(huskNameOf("semantic_tree")).toBe("husk_snapshot");
  });

  it("huskNameOf returns the input unchanged when there is no mapping", () => {
    expect(huskNameOf("unknown_upstream_tool")).toBe("unknown_upstream_tool");
  });

  it("renames semantic_tree to husk_snapshot (the only non-prefix-only rename)", () => {
    expect(UPSTREAM_TO_HUSK["semantic_tree"]).toBe("husk_snapshot");
  });
});
