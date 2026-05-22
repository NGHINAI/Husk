import { describe, it, expect } from "vitest";
import { WATCH_HTML } from "../../src/watch/index.html.js";

describe("Watch UI v3 — seamless banner", () => {
  it("HTML references the seamless mode in the handoff banner handler", () => {
    // When pending_handoff arrives with mode:"seamless", banner shows different copy
    expect(WATCH_HTML).toMatch(/seamless/i);
    expect(WATCH_HTML).toMatch(/Waiting in your Chrome/i);
  });

  it("HTML still has the paste-mode handoff banner copy from M15", () => {
    // Backward compat — paste-mode banner still works
    expect(WATCH_HTML).toMatch(/handoff_url|handoffUrl/);
    expect(WATCH_HTML).toMatch(/Open handoff page/i);
  });

  it("HTML still under 15 KB cap", () => {
    expect(WATCH_HTML.length).toBeLessThan(15_000);
  });

  it("still has the M13/M14/M15 features intact", () => {
    expect(WATCH_HTML).toContain("husk · /watch");
    expect(WATCH_HTML).toContain("EventSource");
    expect(WATCH_HTML).toContain("pending_question");
    expect(WATCH_HTML).toContain("pending_handoff");
    expect(WATCH_HTML).toContain("resolved");
    expect(WATCH_HTML).toContain("tabList");
  });

  it("is self-contained (no external assets)", () => {
    expect(WATCH_HTML).not.toMatch(/<script\s+src=/i);
    expect(WATCH_HTML).not.toMatch(/<link\s+rel=["']stylesheet/i);
  });
});
