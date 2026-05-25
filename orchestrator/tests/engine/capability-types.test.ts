import { describe, it, expect } from "vitest";
import { meetsJs, meetsLatency } from "../../src/engine/capability-types.js";

describe("capability-types helpers", () => {
  it("meetsJs: full >= basic >= none", () => {
    expect(meetsJs("full", "basic")).toBe(true);
    expect(meetsJs("basic", "basic")).toBe(true);
    expect(meetsJs("basic", "full")).toBe(false);
    expect(meetsJs("none", "basic")).toBe(false);
  });

  it("meetsLatency: fast satisfies medium and slow caps", () => {
    expect(meetsLatency("fast", "medium")).toBe(true);
    expect(meetsLatency("medium", "medium")).toBe(true);
    expect(meetsLatency("slow", "medium")).toBe(false);
    expect(meetsLatency("fast", "fast")).toBe(true);
  });
});
