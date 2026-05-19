import { describe, it, expect } from "vitest";
import { WATCH_HTML } from "../../src/watch/index.html.js";

describe("Watch UI v2", () => {
  it("contains sibling tab list container", () => {
    expect(WATCH_HTML).toContain("tabList");
  });

  it("contains question banner and answer handler", () => {
    expect(WATCH_HTML).toContain("questionBanner");
    expect(WATCH_HTML).toContain("/ask/");
  });

  it("contains handoff banner with link to handoff page", () => {
    expect(WATCH_HTML).toContain("handoffBanner");
    expect(WATCH_HTML).toMatch(/handoff_url|handoffUrl/);
  });

  it("listens for the new SSE event kinds", () => {
    expect(WATCH_HTML).toContain("pending_question");
    expect(WATCH_HTML).toContain("pending_handoff");
    expect(WATCH_HTML).toContain("resolved");
  });

  it("status badge has three states (live/paused/needs answer)", () => {
    // Loose check — must support multiple distinct states beyond M13's single live/dead
    expect(WATCH_HTML).toMatch(/paused/);
    expect(WATCH_HTML).toMatch(/needs[- _]?answer|question/i);
  });

  it("still has the M13/M14 features intact", () => {
    expect(WATCH_HTML).toContain("husk · /watch");
    expect(WATCH_HTML).toContain("EventSource");
    expect(WATCH_HTML).toContain("sessionId");  // session_id input still present
  });

  it("is self-contained (no external assets)", () => {
    expect(WATCH_HTML).not.toMatch(/<script\s+src=/i);
    expect(WATCH_HTML).not.toMatch(/<link\s+rel=["']stylesheet/i);
  });

  it("is under 15KB (was ~7KB pre-T8; adding chat + tabs + banners should fit)", () => {
    expect(WATCH_HTML.length).toBeLessThan(15_000);
  });
});
