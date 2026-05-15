import { describe, expect, it } from "vitest";
import { stableId, normalizeName } from "../../src/snapshot/stable-id.js";

describe("normalizeName", () => {
  it("lowercases input", () => {
    expect(normalizeName("Submit Application")).toBe("submit application");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeName("   hello   ")).toBe("hello");
  });

  it("collapses internal whitespace runs to single spaces", () => {
    expect(normalizeName("foo   bar\t\nbaz")).toBe("foo bar baz");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeName("   \t\n")).toBe("");
  });

  it("handles empty input", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("stableId", () => {
  it("returns a 22-character URL-safe base64 string with role prefix", () => {
    const id = stableId("button", "Submit", "/main/form/[0]");
    expect(id).toMatch(/^button:[A-Za-z0-9_-]{22}$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "Submit", "/main/form/[0]");
    expect(a).toBe(b);
  });

  it("changes when role changes", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("link", "Submit", "/main/form/[0]");
    expect(a).not.toBe(b);
  });

  it("changes when name changes (after normalization)", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "Cancel", "/main/form/[0]");
    expect(a).not.toBe(b);
  });

  it("does NOT change when name differs only in case/whitespace (normalization)", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "  SUBMIT  ", "/main/form/[0]");
    expect(a).toBe(b);
  });

  it("changes when xpath changes", () => {
    const a = stableId("button", "Submit", "/main/form/[0]");
    const b = stableId("button", "Submit", "/main/form/[1]");
    expect(a).not.toBe(b);
  });

  it("hash portion does not contain unsafe URL characters (no +, /, =)", () => {
    const id = stableId("button", "Submit", "/main/form/[0]");
    const hash = id.split(":")[1];
    expect(hash).not.toMatch(/[+/=]/);
  });
});
