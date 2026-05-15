import { describe, expect, it } from "vitest";
import { normalizeDomain, isValidDomain } from "../../src/cache/domain.js";

describe("normalizeDomain", () => {
  it("extracts hostname from a full URL", () => {
    expect(normalizeDomain("https://example.com/foo/bar?x=1")).toBe("example.com");
  });

  it("lowercases the hostname", () => {
    expect(normalizeDomain("https://EXAMPLE.COM/")).toBe("example.com");
  });

  it("strips leading www.", () => {
    expect(normalizeDomain("https://www.example.com/")).toBe("example.com");
  });

  it("preserves non-www subdomains", () => {
    expect(normalizeDomain("https://mail.example.com/")).toBe("mail.example.com");
    expect(normalizeDomain("https://api.v2.example.com/")).toBe("api.v2.example.com");
  });

  it("ignores port number", () => {
    expect(normalizeDomain("http://example.com:8080/")).toBe("example.com");
  });

  it("ignores path, query, and fragment", () => {
    expect(normalizeDomain("https://example.com/path?q=1#hash")).toBe("example.com");
  });

  it("works with IPv4 hostnames", () => {
    expect(normalizeDomain("http://127.0.0.1:7777/")).toBe("127.0.0.1");
  });

  it("works with IPv6 hostnames", () => {
    // URL parser keeps brackets in the hostname
    expect(normalizeDomain("http://[::1]:8080/")).toBe("[::1]");
  });

  it("throws on invalid URL", () => {
    expect(() => normalizeDomain("not a url")).toThrow();
  });
});

describe("isValidDomain", () => {
  it("accepts a clean hostname", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("mail.example.com")).toBe(true);
    expect(isValidDomain("127.0.0.1")).toBe(true);
  });

  it("rejects domains with path separators or unsafe chars (DB filename safety)", () => {
    expect(isValidDomain("example.com/foo")).toBe(false);
    expect(isValidDomain("../etc/passwd")).toBe(false);
    expect(isValidDomain("example com")).toBe(false);
    expect(isValidDomain("")).toBe(false);
  });

  it("rejects domains longer than 253 chars (DNS limit)", () => {
    const longLabel = "a".repeat(254);
    expect(isValidDomain(longLabel)).toBe(false);
  });
});
