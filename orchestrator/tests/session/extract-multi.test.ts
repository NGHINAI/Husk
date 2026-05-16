import { describe, it, expect, vi } from "vitest";
import { runExtract, buildCaptureExpr } from "../../src/session/extract.js";

describe("buildCaptureExpr", () => {
  it("escapes selector strings safely", () => {
    const expr = buildCaptureExpr({ title: "h1", price: ".price'with'quotes" });
    expect(expr).toContain('"h1"');
    expect(expr).toContain('"price"');
    expect(expr).toContain('"title"');
    // Should be valid JavaScript
    expect(() => new Function(`return ${expr}`)).not.toThrow();
  });

  it("produces a valid IIFE that returns an object", () => {
    const expr = buildCaptureExpr({ a: "h1", b: "h2" });
    // The expression should be a valid IIFE
    const result = (new Function(`return ${expr}`))();
    expect(typeof result).toBe("object");
    expect("a" in result).toBe(true);
    expect("b" in result).toBe(true);
  });
});

describe("runExtract — multi-selector mode", () => {
  it("returns map of selector → text, with null for missing selectors, one round-trip", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({
        result: { value: { title: "Hello", price: null, h2: "Subhead" } },
      }),
    };
    const r = await runExtract(cdp as any, "sess1", {
      selectors: { title: "h1", price: ".price", h2: "h2" },
    });
    expect(r).toEqual({ title: "Hello", price: null, h2: "Subhead" });
    expect(cdp.send).toHaveBeenCalledTimes(1);
  });

  it("survives per-selector errors via try/catch in IIFE", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({
        result: { value: { good: "text", broken: null } },
      }),
    };
    const r = await runExtract(cdp as any, "sess1", {
      selectors: { good: "h1", broken: "::invalid" },
    });
    expect((r as Record<string, string | null>).good).toBe("text");
    expect((r as Record<string, string | null>).broken).toBeNull();
  });

  it("single-selector mode (existing behavior) still works and returns string", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({ result: { value: "Hello" } }),
    };
    const r = await runExtract(cdp as any, "sess1", { css: "h1" });
    expect(r).toBe("Hello");
  });

  it("single-selector returns null when element missing", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({ result: { value: null } }),
    };
    const r = await runExtract(cdp as any, "sess1", { css: ".missing" });
    expect(r).toBeNull();
  });
});
