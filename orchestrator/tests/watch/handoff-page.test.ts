import { describe, it, expect } from "vitest";
import { HANDOFF_HTML, bookmarkletFor } from "../../src/http/handoff-page.html.js";

describe("HANDOFF_HTML", () => {
  it("contains the placeholders for substitution", () => {
    expect(HANDOFF_HTML).toContain("__TOKEN__");
    expect(HANDOFF_HTML).toContain("__REASON__");
    expect(HANDOFF_HTML).toContain("__SUGGESTED__");
    expect(HANDOFF_HTML).toContain("__CURRENT_URL__");
    expect(HANDOFF_HTML).toContain("__BOOKMARKLET__");
  });

  it("is self-contained (no external assets)", () => {
    expect(HANDOFF_HTML).not.toMatch(/<script\s+src=/i);
    expect(HANDOFF_HTML).not.toMatch(/<link\s+rel=["']stylesheet/i);
  });

  it("includes resume buttons + textarea for paste mode", () => {
    expect(HANDOFF_HTML).toContain("resumeWithPaste");
    expect(HANDOFF_HTML).toContain("resumeNoCookies");
    expect(HANDOFF_HTML).toMatch(/<textarea/);
  });
});

describe("bookmarkletFor", () => {
  it("starts with javascript: and includes the orchestrator origin + token", () => {
    const b = bookmarkletFor("tok-abc", "http://127.0.0.1:7777");
    expect(b.startsWith("javascript:")).toBe(true);
    expect(decodeURIComponent(b)).toContain("http://127.0.0.1:7777/handoff/tok-abc/resume");
    expect(decodeURIComponent(b)).toContain("document.cookie");
  });
});
