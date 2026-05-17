import { describe, it, expect } from "vitest";
import { summarize } from "../../src/snapshot/summary.js";

describe("summarize", () => {
  it("detects login pages by presence of password field", () => {
    const s = summarize({
      url: "https://example.com/login",
      meta: { title: "Sign in", canonical: null, og: {}, jsonld: [] },
      forms: [{
        stable_id: null,
        action: "/auth",
        method: "POST",
        submit_text: "Sign in",
        fields: [
          { name: "email", type: "email", label: "Email", required: true, placeholder: null },
          { name: "password", type: "password", label: "Password", required: true, placeholder: null },
        ],
      }],
      nodes_count: 80,
    });
    expect(s).toMatch(/login|sign[- ]?in/i);
    expect(s.toLowerCase()).toContain("email");
    expect(s.toLowerCase()).toContain("password");
  });

  it("detects product pages from JSON-LD @type=Product", () => {
    const s = summarize({
      url: "https://shop.example.com/widget",
      meta: {
        title: "Widget",
        canonical: null,
        og: {},
        jsonld: [{ "@type": "Product", name: "Widget", offers: { price: "19.99" } }],
      },
      forms: [],
      nodes_count: 240,
    });
    expect(s.toLowerCase()).toContain("product");
    expect(s).toContain("Widget");
    expect(s).toContain("19.99");
  });

  it("detects checkout/cart pages via URL+title pattern", () => {
    const s = summarize({
      url: "https://shop.example.com/checkout",
      meta: { title: "Cart — Shop", canonical: null, og: {}, jsonld: [] },
      forms: [],
      nodes_count: 120,
    });
    expect(s.toLowerCase()).toMatch(/checkout|cart/);
  });

  it("detects articles from JSON-LD @type=Article", () => {
    const s = summarize({
      url: "https://blog.example.com/my-post",
      meta: {
        title: "My Post",
        canonical: null,
        og: {},
        jsonld: [{ "@type": "Article", headline: "Why Husk Matters" }],
      },
      forms: [],
      nodes_count: 300,
    });
    expect(s.toLowerCase()).toContain("article");
    expect(s).toContain("Why Husk Matters");
  });

  it("detects search results from URL/title hints", () => {
    const s = summarize({
      url: "https://example.com/search?q=husk",
      meta: { title: "Search results for husk", canonical: null, og: {}, jsonld: [] },
      forms: [],
      nodes_count: 180,
    });
    expect(s.toLowerCase()).toContain("search");
  });

  it("falls back to generic title-based summary when no pattern matches", () => {
    const s = summarize({
      url: "https://example.com/random",
      meta: { title: "Random Page", canonical: null, og: {}, jsonld: [] },
      forms: [],
      nodes_count: 120,
    });
    expect(s).toContain("Random Page");
    expect(s).toContain("120");
  });

  it("falls back to URL when title is missing", () => {
    const s = summarize({
      url: "https://example.com/no-title",
      meta: { title: null, canonical: null, og: {}, jsonld: [] },
      forms: [],
      nodes_count: 5,
    });
    expect(s).toContain("https://example.com/no-title");
  });
});
