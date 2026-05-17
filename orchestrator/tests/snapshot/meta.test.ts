import { describe, it, expect, vi } from "vitest";
import { extractMeta } from "../../src/snapshot/meta.js";

describe("extractMeta", () => {
  it("extracts title, canonical, og, jsonld from CDP eval result", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({
        result: {
          value: {
            title: "Page Title",
            canonical: "https://example.com/canonical",
            og: { title: "OG Title", image: "https://example.com/img.png" },
            jsonld: [{ "@type": "Product", name: "Widget", offers: { price: "19.99" } }],
          },
        },
      }),
    };
    const m = await extractMeta(cdp as any, "sess1");
    expect(m.title).toBe("Page Title");
    expect(m.canonical).toBe("https://example.com/canonical");
    expect(m.og.title).toBe("OG Title");
    expect(m.og.image).toBe("https://example.com/img.png");
    expect(m.jsonld).toHaveLength(1);
    expect(m.jsonld[0]).toMatchObject({ "@type": "Product", name: "Widget" });
  });

  it("returns safe defaults when CDP returns nothing", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ result: {} }) };
    const m = await extractMeta(cdp as any, "sess1");
    expect(m).toEqual({ title: null, canonical: null, og: {}, jsonld: [] });
  });

  it("returns safe defaults when CDP throws", async () => {
    const cdp = { send: vi.fn().mockRejectedValue(new Error("Runtime.evaluate failed")) };
    const m = await extractMeta(cdp as any, "sess1");
    expect(m).toEqual({ title: null, canonical: null, og: {}, jsonld: [] });
  });
});
