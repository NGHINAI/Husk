import { describe, expect, it } from "vitest";
import { VERSION, getVersion } from "../src/version.js";

describe("version", () => {
  it("exports a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  it("getVersion() returns the same value as VERSION", () => {
    expect(getVersion()).toBe(VERSION);
  });

  it("initial version is 0.0.0", () => {
    expect(VERSION).toBe("0.0.0");
  });
});
