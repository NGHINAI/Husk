import { describe, expect, it } from "vitest";
import { Husk, SDK_VERSION } from "../src/index.js";

describe("@husk/sdk smoke", () => {
  it("exports a Husk class", () => {
    expect(Husk).toBeDefined();
    expect(typeof Husk).toBe("function");
  });

  it("Husk constructor accepts a baseUrl option", () => {
    const h = new Husk({ baseUrl: "http://localhost:7777" });
    expect(h.baseUrl).toBe("http://localhost:7777");
  });

  it("Husk constructor defaults baseUrl when omitted", () => {
    const h = new Husk();
    expect(h.baseUrl).toBe("http://localhost:7777");
  });

  it("exports SDK_VERSION matching semver", () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
