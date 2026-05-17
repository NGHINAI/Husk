import { describe, it, expect } from "vitest";
import { deriveApiHints } from "../../src/snapshot/api-hints.js";
import type { NetworkEntry } from "../../src/session/network-buffer.js";

const e = (partial: Partial<NetworkEntry>): NetworkEntry => ({
  url: "https://example.com/page",
  method: "GET",
  started_at: 0,
  ...partial,
});

describe("deriveApiHints", () => {
  it("keeps requests whose content-type is JSON", () => {
    const hints = deriveApiHints([
      e({ url: "https://example.com/api/users/1", method: "GET", status: 200, content_type: "application/json" }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0].url).toBe("https://example.com/api/users/1");
  });

  it("keeps requests with /api/ or /v1/ paths even when content_type is unknown", () => {
    const hints = deriveApiHints([
      e({ url: "https://x/api/products", status: 200 }),
      e({ url: "https://x/v2/orders", status: 200 }),
    ]);
    expect(hints).toHaveLength(2);
  });

  it("keeps GraphQL endpoints", () => {
    const hints = deriveApiHints([
      e({ url: "https://x/graphql", method: "POST", status: 200, content_type: "application/json" }),
    ]);
    expect(hints).toHaveLength(1);
  });

  it("excludes HTML / CSS / JS / images", () => {
    const hints = deriveApiHints([
      e({ url: "https://x/index.html", content_type: "text/html", status: 200 }),
      e({ url: "https://x/style.css", content_type: "text/css", status: 200 }),
      e({ url: "https://x/bundle.js", content_type: "application/javascript", status: 200 }),
      e({ url: "https://x/img.png", content_type: "image/png", status: 200 }),
      e({ url: "https://x/font.woff2", content_type: "font/woff2", status: 200 }),
    ]);
    expect(hints).toEqual([]);
  });

  it("excludes failed requests (status >= 400)", () => {
    const hints = deriveApiHints([
      e({ url: "https://x/api/x", status: 404, content_type: "application/json" }),
      e({ url: "https://x/api/y", status: 500, content_type: "application/json" }),
      e({ url: "https://x/api/z", status: 200, content_type: "application/json" }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0].url).toBe("https://x/api/z");
  });

  it("dedupes by URL+method", () => {
    const hints = deriveApiHints([
      e({ url: "https://x/api/x", method: "GET", status: 200, content_type: "application/json" }),
      e({ url: "https://x/api/x", method: "GET", status: 200, content_type: "application/json" }),
      e({ url: "https://x/api/x", method: "POST", status: 200, content_type: "application/json" }),
    ]);
    expect(hints).toHaveLength(2);
  });

  it("keeps in-flight requests (status undefined) only if they look API-y", () => {
    const hints = deriveApiHints([
      e({ url: "https://x/api/slow" }),  // in-flight, no status
      e({ url: "https://x/index.html" }), // in-flight HTML-looking
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0].url).toBe("https://x/api/slow");
  });
});
