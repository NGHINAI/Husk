import { describe, expect, it } from "vitest";
import { resolveProfilePath, isValidProfileName } from "../../src/vault/profile-path.js";
import { join } from "node:path";

describe("isValidProfileName", () => {
  it("accepts alphanumerics, dashes, underscores, dots", () => {
    expect(isValidProfileName("default")).toBe(true);
    expect(isValidProfileName("work-account-1")).toBe(true);
    expect(isValidProfileName("gmail.personal")).toBe(true);
    expect(isValidProfileName("a_b_c")).toBe(true);
  });

  it("rejects names with path traversal", () => {
    expect(isValidProfileName("../etc/passwd")).toBe(false);
    expect(isValidProfileName("..")).toBe(false);
    expect(isValidProfileName("foo/bar")).toBe(false);
    expect(isValidProfileName("foo\\bar")).toBe(false);
  });

  it("rejects empty and over-long names", () => {
    expect(isValidProfileName("")).toBe(false);
    expect(isValidProfileName("a".repeat(65))).toBe(false);
  });
});

describe("resolveProfilePath", () => {
  it("returns vaultDir + '/' + profile + '.db'", () => {
    expect(resolveProfilePath("/v", "default")).toBe(join("/v", "default.db"));
  });

  it("throws on invalid profile name", () => {
    expect(() => resolveProfilePath("/v", "../etc")).toThrow(/profile name/i);
  });
});
