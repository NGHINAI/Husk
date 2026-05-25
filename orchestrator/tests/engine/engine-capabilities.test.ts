import { describe, it, expect } from "vitest";
import { LIGHTPANDA_CAPS, CHROME_CAPS, ALL_ENGINES, findEngine } from "../../src/engine/engine-capabilities.js";

describe("engine-capabilities registry", () => {
  it("lightpanda is basic JS, fast latency, low cost", () => {
    expect(LIGHTPANDA_CAPS.js).toBe("basic");
    expect(LIGHTPANDA_CAPS.latency).toBe("fast");
    expect(LIGHTPANDA_CAPS.cost).toBeLessThan(CHROME_CAPS.cost);
  });

  it("chrome is full JS, medium latency, higher cost", () => {
    expect(CHROME_CAPS.js).toBe("full");
    expect(CHROME_CAPS.features).toContain("webrtc");
    expect(CHROME_CAPS.features).toContain("service_worker");
  });

  it("ALL_ENGINES contains both lightpanda and chrome", () => {
    const names = ALL_ENGINES.map((e) => e.engine);
    expect(names).toContain("lightpanda");
    expect(names).toContain("chrome");
  });

  it("findEngine returns the right entry or null", () => {
    expect(findEngine("chrome")?.engine).toBe("chrome");
    expect(findEngine("nope")).toBeNull();
  });
});
