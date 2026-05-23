import { describe, it, expect } from "vitest";
import { detectPageHealth, KNOWN_RICH_SITES } from "../../src/engine/page-health.js";
import type { Snapshot } from "../../src/snapshot/types.js";

// Helper to build a synthetic snapshot
const snap = (overrides: Partial<Snapshot>): Snapshot => ({
  v: 1,
  url: "https://example.com/",
  count: 1,
  root: { i: "root", r: "RootWebArea", n: "", s: [], c: [] },
  sibling_sessions: [],
  signature: { dom_hash: "abc", network_fingerprint: "def", url: "https://example.com/" },
  meta: { title: null, canonical: null, og: {}, jsonld: [] },
  forms: [],
  network: { recent: [], likely_api_endpoints: [] },
  console: [],
  summary: "",
  session_history: [],
  ...overrides,
});

describe("KNOWN_RICH_SITES", () => {
  it("includes common SPA-heavy domains", () => {
    expect(KNOWN_RICH_SITES.has("linkedin.com")).toBe(true);
    expect(KNOWN_RICH_SITES.has("gmail.com")).toBe(true);
    expect(KNOWN_RICH_SITES.has("github.com")).toBe(true);
    expect(KNOWN_RICH_SITES.has("salesforce.com")).toBe(true);
  });
});

describe("detectPageHealth", () => {
  describe("polyfill-gap markers (Marker 1)", () => {
    it("fires on BroadcastChannel not defined", () => {
      const s = snap({
        url: "https://example.com/",
        console: [{ level: "error", text: "ReferenceError: BroadcastChannel is not defined\n  at ...", ts: 1 }],
      });
      const v = detectPageHealth(s);
      expect(v.should_fallback).toBe(true);
      expect(v.reasons.some((r) => r.includes("polyfill_gap"))).toBe(true);
    });

    it("fires on IndexedDB not defined", () => {
      const s = snap({
        console: [{ level: "error", text: "ReferenceError: IndexedDB is not defined", ts: 1 }],
      });
      expect(detectPageHealth(s).should_fallback).toBe(true);
    });

    it("fires on ServiceWorker not defined", () => {
      const s = snap({
        console: [{ level: "error", text: "ReferenceError: ServiceWorker is not defined", ts: 1 }],
      });
      expect(detectPageHealth(s).should_fallback).toBe(true);
    });

    it("fires on customElements not defined", () => {
      const s = snap({
        console: [{ level: "error", text: "ReferenceError: customElements is not defined", ts: 1 }],
      });
      expect(detectPageHealth(s).should_fallback).toBe(true);
    });

    it("does NOT fire on non-polyfill console errors", () => {
      const s = snap({
        url: "https://en.wikipedia.org/wiki/Husk",
        console: [{ level: "error", text: "Failed to load resource: 404", ts: 1 }],
        root: { i: "r", r: "RootWebArea", n: "Husk", s: [], c: Array(50).fill({ i: "x", r: "text", n: "content", s: [], c: [] }) },
      });
      expect(detectPageHealth(s).should_fallback).toBe(false);
    });

    it("does NOT fire on warning-level messages even if text matches", () => {
      const s = snap({
        url: "https://en.wikipedia.org/wiki/Husk",
        console: [{ level: "warn", text: "BroadcastChannel might not work", ts: 1 }],
        root: { i: "r", r: "RootWebArea", n: "Husk", s: [], c: Array(50).fill({ i: "x", r: "text", n: "content", s: [], c: [] }) },
      });
      expect(detectPageHealth(s).should_fallback).toBe(false);
    });
  });

  describe("empty AX on rich site (Marker 2)", () => {
    it("fires when LinkedIn returns only 4 AX nodes", () => {
      const s = snap({
        url: "https://www.linkedin.com/in/someone",
        root: { i: "r", r: "RootWebArea", n: "Profile", s: [], c: [
          { i: "x", r: "image", n: "LinkedIn", s: [], c: [] },
          { i: "y", r: "heading", n: "Ha habido un problema", s: [], c: [] },
          { i: "z", r: "button", n: "Reintentar", s: [], c: [] },
        ]},
      });
      expect(detectPageHealth(s).should_fallback).toBe(true);
      expect(detectPageHealth(s).reasons.some((r) => r.includes("empty_ax"))).toBe(true);
    });

    it("does NOT fire when LinkedIn returns a full tree", () => {
      const children = Array(100).fill(null).map((_, i) => ({ i: `n${i}`, r: "text", n: `item ${i}`, s: [], c: [] }));
      const s = snap({
        url: "https://www.linkedin.com/feed",
        root: { i: "r", r: "RootWebArea", n: "Feed", s: [], c: children },
      });
      expect(detectPageHealth(s).should_fallback).toBe(false);
    });

    it("does NOT fire on small unknown sites", () => {
      const s = snap({
        url: "https://myblog.example/post-1",
        root: { i: "r", r: "RootWebArea", n: "Post", s: [], c: [{ i: "x", r: "text", n: "small", s: [], c: [] }] },
      });
      expect(detectPageHealth(s).should_fallback).toBe(false);
    });
  });

  describe("error-only text (Marker 3)", () => {
    it("fires when ax tree has only 'reintentar' as content", () => {
      const s = snap({
        url: "https://example.com/anywhere",
        root: { i: "r", r: "RootWebArea", n: "Error", s: [], c: [
          { i: "x", r: "heading", n: "Reintentar", s: [], c: [] },
        ]},
      });
      expect(detectPageHealth(s).should_fallback).toBe(true);
      expect(detectPageHealth(s).reasons.some((r) => r.includes("only_error"))).toBe(true);
    });

    it("fires on 'something went wrong'", () => {
      const s = snap({
        url: "https://example.com/",
        root: { i: "r", r: "RootWebArea", n: "Something went wrong", s: [], c: [] },
      });
      expect(detectPageHealth(s).should_fallback).toBe(true);
    });
  });

  describe("minimal content on rich site (Marker 4)", () => {
    it("fires on GitHub with no jsonld, no og, no forms, < 20 nodes", () => {
      const s = snap({
        url: "https://github.com/some-repo",
        root: { i: "r", r: "RootWebArea", n: "GitHub", s: [], c: Array(5).fill({ i: "x", r: "text", n: "x", s: [], c: [] }) },
        meta: { title: "GitHub", canonical: null, og: {}, jsonld: [] },
        forms: [],
      });
      expect(detectPageHealth(s).should_fallback).toBe(true);
    });

    it("does NOT fire when GitHub has rich content (many nodes + jsonld)", () => {
      const children = Array(50).fill({ i: "x", r: "text", n: "real content", s: [], c: [] });
      const s = snap({
        url: "https://github.com/some-repo",
        root: { i: "r", r: "RootWebArea", n: "GitHub", s: [], c: children },
        meta: { title: "GitHub", canonical: null, og: { title: "Some Repo" }, jsonld: [{ "@type": "WebSite" }] },
        forms: [],
      });
      expect(detectPageHealth(s).should_fallback).toBe(false);
    });
  });

  describe("non-fallback cases", () => {
    it("clean Wikipedia page does NOT trigger fallback", () => {
      const children = Array(80).fill({ i: "n", r: "text", n: "wiki content", s: [], c: [] });
      const s = snap({
        url: "https://en.wikipedia.org/wiki/Husk",
        root: { i: "r", r: "RootWebArea", n: "Husk - Wikipedia", s: [], c: children },
        meta: { title: "Husk", canonical: null, og: {}, jsonld: [] },
      });
      expect(detectPageHealth(s).should_fallback).toBe(false);
      expect(detectPageHealth(s).reasons).toEqual([]);
    });

    it("clean Hacker News page does NOT trigger fallback", () => {
      const children = Array(60).fill({ i: "n", r: "link", n: "story title", s: [], c: [] });
      const s = snap({
        url: "https://news.ycombinator.com/",
        root: { i: "r", r: "RootWebArea", n: "Hacker News", s: [], c: children },
      });
      expect(detectPageHealth(s).should_fallback).toBe(false);
    });

    it("handles invalid URL gracefully (no throw)", () => {
      const s = snap({ url: "not-a-url" });
      const v = detectPageHealth(s);
      expect(typeof v.should_fallback).toBe("boolean");
    });
  });
});
