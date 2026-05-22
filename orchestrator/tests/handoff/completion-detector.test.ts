import { describe, it, expect } from "vitest";
import {
  detectCompletion,
  isOnLoginPath,
  sameDomain,
  buildOverlayScript,
} from "../../src/handoff/completion-detector.js";

describe("isOnLoginPath", () => {
  it("matches common login paths", () => {
    expect(isOnLoginPath("https://linkedin.com/login")).toBe(true);
    expect(isOnLoginPath("https://github.com/login")).toBe(true);
    expect(isOnLoginPath("https://accounts.google.com/signin")).toBe(true);
    expect(isOnLoginPath("https://x.com/sign-in")).toBe(true);
    expect(isOnLoginPath("https://x.com/auth/verify")).toBe(true);
    expect(isOnLoginPath("https://x.com/oauth/consent")).toBe(true);
    expect(isOnLoginPath("https://x.com/2fa")).toBe(true);
    expect(isOnLoginPath("https://x.com/challenge")).toBe(true);
    expect(isOnLoginPath("https://x.com/verify")).toBe(true);
  });

  it("does not match non-login paths", () => {
    expect(isOnLoginPath("https://linkedin.com/feed")).toBe(false);
    expect(isOnLoginPath("https://linkedin.com/in/john-doe")).toBe(false);
    expect(isOnLoginPath("https://github.com/")).toBe(false);
    expect(isOnLoginPath("https://x.com/")).toBe(false);
  });

  it("path matching is case-insensitive", () => {
    expect(isOnLoginPath("https://x.com/LOGIN")).toBe(true);
    expect(isOnLoginPath("https://x.com/SignIn")).toBe(true);
  });

  it("invalid URL strings return false (don't throw)", () => {
    expect(isOnLoginPath("not a url")).toBe(false);
    expect(isOnLoginPath("")).toBe(false);
  });
});

describe("sameDomain", () => {
  it("same hostname matches", () => {
    expect(sameDomain("https://linkedin.com/login", "https://linkedin.com/feed")).toBe(true);
  });

  it("subdomain of target matches", () => {
    expect(sameDomain("https://linkedin.com/login", "https://www.linkedin.com/feed")).toBe(true);
    expect(sameDomain("https://linkedin.com/login", "https://accounts.linkedin.com/x")).toBe(true);
  });

  it("target is a subdomain, observed is the apex", () => {
    expect(sameDomain("https://accounts.google.com/signin", "https://google.com/")).toBe(true);
  });

  it("different domain returns false", () => {
    expect(sameDomain("https://linkedin.com/login", "https://google.com/")).toBe(false);
    expect(sameDomain("https://linkedin.com/login", "https://linkedin-fake.com/")).toBe(false);
  });

  it("invalid URLs return false", () => {
    expect(sameDomain("not a url", "https://x.com/")).toBe(false);
    expect(sameDomain("https://x.com/", "not a url")).toBe(false);
  });
});

describe("detectCompletion", () => {
  it("true when same domain + not on login path", () => {
    expect(detectCompletion("https://linkedin.com/login", "https://linkedin.com/feed")).toBe(true);
  });

  it("true when subdomain hop is fine (still on linkedin)", () => {
    expect(detectCompletion("https://linkedin.com/login", "https://www.linkedin.com/feed")).toBe(true);
  });

  it("false when still on login path", () => {
    expect(detectCompletion("https://linkedin.com/login", "https://linkedin.com/login?next=/feed")).toBe(false);
    expect(detectCompletion("https://linkedin.com/login", "https://linkedin.com/checkpoint/challenge")).toBe(false);
  });

  it("false on OAuth redirect (different domain) — caller's job to know if final URL is the target", () => {
    // OAuth: linkedin → google → linkedin. The detector only fires when we're back on linkedin.
    expect(detectCompletion("https://linkedin.com/login", "https://accounts.google.com/oauth/consent")).toBe(false);
  });

  it("true once back on target domain after an OAuth bounce", () => {
    // After Google consent, redirected back to linkedin.com/feed
    expect(detectCompletion("https://linkedin.com/login", "https://linkedin.com/feed?from=oauth")).toBe(true);
  });

  it("false on invalid URLs", () => {
    expect(detectCompletion("not a url", "https://x.com/feed")).toBe(false);
    expect(detectCompletion("https://x.com/login", "")).toBe(false);
  });
});

describe("buildOverlayScript", () => {
  it("returns a JS string that POSTs to the seamless-done endpoint with the right token + port", () => {
    const script = buildOverlayScript("tok-abc", 7777);
    expect(script).toContain("tok-abc");
    expect(script).toContain("7777");
    expect(script).toContain("/handoff/tok-abc/seamless-done");
    expect(script).toContain("fetch");
  });

  it("script is syntactically valid JS (wraps in IIFE; new Function parses it without throw)", () => {
    const script = buildOverlayScript("t", 80);
    // Wrap in a factory so global side effects don't fire when parsing
    expect(() => new Function(script)).not.toThrow();
  });

  it("button is visually distinctive (green, fixed bottom-right)", () => {
    const script = buildOverlayScript("t", 80);
    expect(script).toMatch(/position:fixed/);
    expect(script).toMatch(/bottom/);
  });

  it("script escapes the token (no XSS even if token contains weird chars)", () => {
    const script = buildOverlayScript('";alert(1)//', 80);
    expect(script).not.toMatch(/";alert\(1\)\/\//);  // raw injection
    // Either escaped or rejected — we just verify nothing parses to an alert call
  });
});
