import { describe, it, expect } from "vitest";
import { runVerify, runAllVerify } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck } from "../../src/cognition/intention-types.js";

describe("verify-runner", () => {
  const baseSnap = { url: "https://test.com/page", nodes: [{ i: "h1", r: "heading", n: "Welcome" }] };

  it("url check passes on matching pattern", () => {
    const check: VerifyCheck = { type: "url", pattern: "/page$", description: "URL ends with /page" };
    const ev = runVerify(check, { currentUrl: "https://test.com/page", snapshot: { url: "https://test.com/page", root: undefined } as any });
    expect(ev.passed).toBe(true);
    expect(ev.source).toBe("url");
    expect(ev.ts).toBeGreaterThan(0);
  });

  it("url check fails on mismatch", () => {
    const check: VerifyCheck = { type: "url", pattern: "/admin", description: "admin url" };
    const ev = runVerify(check, { currentUrl: "https://test.com/page", snapshot: { url: "x", root: undefined } as any });
    expect(ev.passed).toBe(false);
    expect(ev.source).toBe("url");
    expect(ev.ts).toBeGreaterThan(0);
  });

  it("network check matches by url_pattern + method + status", () => {
    const check: VerifyCheck = { type: "network", method: "POST", url_pattern: "/api/connect", status_min: 200, status_max: 299, description: "connect 2xx" };
    const ev = runVerify(check, {
      currentUrl: "x",
      snapshot: { url: "x", root: undefined } as any,
      network: [
        { method: "POST", url: "https://x.com/api/connect", status: 201, ts: 1 },
      ],
    });
    expect(ev.passed).toBe(true);
    expect(ev.observed_value).toBeDefined();
    expect(ev.source).toBe("network");
    expect(ev.ts).toBeGreaterThan(0);
  });

  it("network check fails when status outside range", () => {
    const check: VerifyCheck = { type: "network", url_pattern: "/api", status_min: 200, status_max: 299, description: "2xx" };
    const ev = runVerify(check, {
      currentUrl: "x",
      snapshot: { url: "x", root: undefined } as any,
      network: [{ method: "GET", url: "/api", status: 429, ts: 1 }],
    });
    expect(ev.passed).toBe(false);
    expect(ev.source).toBe("network");
    expect(ev.ts).toBeGreaterThan(0);
  });

  it("network check fails when no network ctx provided", () => {
    const check: VerifyCheck = { type: "network", url_pattern: "/api", description: "any" };
    const ev = runVerify(check, { currentUrl: "x", snapshot: { url: "x", root: undefined } as any });
    expect(ev.passed).toBe(false);
    expect(ev.source).toBe("network");
    expect(ev.ts).toBeGreaterThan(0);
  });

  it("predicate check uses predicate evaluator", () => {
    const check: VerifyCheck = {
      type: "predicate",
      predicate: { type: "url_pattern", regex: "/page$" },
      description: "url pattern",
    };
    const ev = runVerify(check, {
      currentUrl: "https://x/page",
      snapshot: { url: "https://x/page", root: { r: "main", c: [] } } as any,
    });
    expect(ev.passed).toBe(true);
    expect(ev.source).toBe("predicate");
    expect(ev.ts).toBeGreaterThan(0);
  });

  it("runAllVerify returns one Evidence per check", () => {
    const checks: VerifyCheck[] = [
      { type: "url", pattern: "/page$", description: "url" },
      { type: "url", pattern: "/admin", description: "no admin" },
    ];
    const ev = runAllVerify(checks, { currentUrl: "https://x/page", snapshot: { url: "x", root: undefined } as any });
    expect(ev).toHaveLength(2);
    expect(ev[0].passed).toBe(true);
    expect(ev[1].passed).toBe(false);
  });
});
