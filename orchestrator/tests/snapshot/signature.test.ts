import { describe, it, expect } from "vitest";
import { computeSignature } from "../../src/snapshot/signature.js";

describe("computeSignature", () => {
  it("is stable across calls with identical input", () => {
    const a = computeSignature({
      root: { i: "r", r: "root", n: "", c: [{ i: "a", r: "button", n: "X" }] },
      url: "/",
      networkUrls: ["https://api.x/1"],
    });
    const b = computeSignature({
      root: { i: "r", r: "root", n: "", c: [{ i: "a", r: "button", n: "X" }] },
      url: "/",
      networkUrls: ["https://api.x/1"],
    });
    expect(a.dom_hash).toBe(b.dom_hash);
    expect(a.network_fingerprint).toBe(b.network_fingerprint);
    expect(a.url).toBe("/");
  });

  it("dom_hash changes when an AX node id changes", () => {
    const a = computeSignature({
      root: { i: "r", r: "root", n: "", c: [{ i: "a", r: "button", n: "X" }] },
      url: "/",
      networkUrls: [],
    });
    const b = computeSignature({
      root: { i: "r", r: "root", n: "", c: [{ i: "b", r: "button", n: "X" }] },
      url: "/",
      networkUrls: [],
    });
    expect(a.dom_hash).not.toBe(b.dom_hash);
  });

  it("network_fingerprint changes when network URLs change", () => {
    const a = computeSignature({ root: { i: "r", r: "root", n: "" }, url: "/", networkUrls: ["a"] });
    const b = computeSignature({ root: { i: "r", r: "root", n: "" }, url: "/", networkUrls: ["a", "b"] });
    expect(a.network_fingerprint).not.toBe(b.network_fingerprint);
  });

  it("network_fingerprint is order-independent (sorted internally)", () => {
    const a = computeSignature({ root: { i: "r", r: "root", n: "" }, url: "/", networkUrls: ["b", "a"] });
    const b = computeSignature({ root: { i: "r", r: "root", n: "" }, url: "/", networkUrls: ["a", "b"] });
    expect(a.network_fingerprint).toBe(b.network_fingerprint);
  });
});
