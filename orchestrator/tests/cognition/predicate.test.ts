/**
 * Tests for the predicate evaluator — Task 2 of M18 Phase A.
 *
 * All 9 primitives (url_pattern, ax_role_name, ax_text_match, network_recent,
 * cookies_contain, forms_present, and, or, not) plus edge cases:
 *   - vacuous AND (empty all → true)
 *   - vacuous OR (empty any → false)
 *   - invalid regex → false (no throw)
 *   - unknown predicate type → false (no throw)
 *   - missing optional snapshot fields → false (graceful)
 */

import { describe, it, expect } from "vitest";
import { evaluate } from "../../src/cognition/predicate.js";
import type { SnapshotForPredicate } from "../../src/cognition/predicate.js";
import type { Predicate } from "../../src/cognition/types.js";

// ---------------------------------------------------------------------------
// Shared fixture snapshot
// ---------------------------------------------------------------------------

const snap: SnapshotForPredicate = {
  url: "https://linkedin.com/feed",
  root: {
    i: "root",
    r: "RootWebArea",
    n: "LinkedIn Feed",
    c: [
      { i: "h1", r: "heading", n: "Feed", c: [] },
      { i: "b1", r: "button", n: "Sign out", c: [] },
      {
        i: "nav",
        r: "navigation",
        n: "Main nav",
        c: [
          { i: "lnk", r: "link", n: "Jobs", c: [] },
        ],
      },
    ],
  },
  network: {
    recent: [
      { url: "https://linkedin.com/api/me", method: "GET", status: 200 },
      { url: "https://linkedin.com/api/feed", method: "POST", status: 201 },
    ],
  },
  forms: [
    { fields: [{ type: "text" }, { type: "password" }] },
  ],
  cookies: [
    { name: "li_at", value: "abc123" },
    { name: "JSESSIONID", value: "xyz789" },
  ],
};

// Minimal snapshot — no optional fields
const bare: SnapshotForPredicate = {
  url: "https://example.com/",
  root: { i: "r", r: "RootWebArea", n: "", c: [] },
};

// ---------------------------------------------------------------------------
// url_pattern
// ---------------------------------------------------------------------------

describe("url_pattern", () => {
  it("matches when regex hits the URL", () => {
    expect(evaluate({ type: "url_pattern", regex: "/feed$" }, snap)).toBe(true);
  });

  it("does not match when regex misses the URL", () => {
    expect(evaluate({ type: "url_pattern", regex: "/login$" }, snap)).toBe(false);
  });

  it("is case-sensitive on paths", () => {
    // URL path /feed should NOT match /FEED (case-sensitive)
    expect(evaluate({ type: "url_pattern", regex: "/FEED$" }, snap)).toBe(false);
  });

  it("invalid regex returns false, does not throw", () => {
    expect(() =>
      evaluate({ type: "url_pattern", regex: "[invalid" }, snap)
    ).not.toThrow();
    expect(evaluate({ type: "url_pattern", regex: "[invalid" }, snap)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ax_role_name
// ---------------------------------------------------------------------------

describe("ax_role_name", () => {
  it("matches by role only (no name filter)", () => {
    expect(evaluate({ type: "ax_role_name", role: "heading" }, snap)).toBe(true);
  });

  it("matches by role + exact name (case-insensitive)", () => {
    expect(evaluate({ type: "ax_role_name", role: "button", name: "Sign out" }, snap)).toBe(true);
  });

  it("exact name match is case-insensitive", () => {
    expect(evaluate({ type: "ax_role_name", role: "button", name: "sign out" }, snap)).toBe(true);
  });

  it("fails when exact name does not match", () => {
    expect(evaluate({ type: "ax_role_name", role: "button", name: "Login" }, snap)).toBe(false);
  });

  it("matches by role + name_regex", () => {
    expect(
      evaluate({ type: "ax_role_name", role: "button", name_regex: "Sign\\s*out" }, snap)
    ).toBe(true);
  });

  it("fails when role+name_regex does not match", () => {
    expect(
      evaluate({ type: "ax_role_name", role: "button", name_regex: "^Register$" }, snap)
    ).toBe(false);
  });

  it("finds deeply nested nodes", () => {
    // "Jobs" link is nested inside navigation
    expect(evaluate({ type: "ax_role_name", role: "link", name: "Jobs" }, snap)).toBe(true);
  });

  it("fails when role does not exist in tree", () => {
    expect(evaluate({ type: "ax_role_name", role: "dialog" }, snap)).toBe(false);
  });

  it("invalid name_regex returns false, does not throw", () => {
    expect(() =>
      evaluate({ type: "ax_role_name", role: "button", name_regex: "[bad" }, snap)
    ).not.toThrow();
    expect(evaluate({ type: "ax_role_name", role: "button", name_regex: "[bad" }, snap)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ax_text_match
// ---------------------------------------------------------------------------

describe("ax_text_match", () => {
  it("matches text found anywhere in the tree", () => {
    expect(evaluate({ type: "ax_text_match", regex: "Sign out" }, snap)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(evaluate({ type: "ax_text_match", regex: "sign out" }, snap)).toBe(true);
    expect(evaluate({ type: "ax_text_match", regex: "LINKEDIN FEED" }, snap)).toBe(true);
  });

  it("fails when text is not present", () => {
    expect(evaluate({ type: "ax_text_match", regex: "Banana" }, snap)).toBe(false);
  });

  it("invalid regex returns false, does not throw", () => {
    expect(() =>
      evaluate({ type: "ax_text_match", regex: "[bad" }, snap)
    ).not.toThrow();
    expect(evaluate({ type: "ax_text_match", regex: "[bad" }, snap)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// network_recent
// ---------------------------------------------------------------------------

describe("network_recent", () => {
  it("matches when url_pattern hits a recent network entry", () => {
    expect(
      evaluate({ type: "network_recent", url_pattern: "/api/me" }, snap)
    ).toBe(true);
  });

  it("matches with method filter", () => {
    expect(
      evaluate({ type: "network_recent", url_pattern: "/api/me", method: "GET" }, snap)
    ).toBe(true);
  });

  it("fails when method does not match", () => {
    expect(
      evaluate({ type: "network_recent", url_pattern: "/api/me", method: "POST" }, snap)
    ).toBe(false);
  });

  it("matches with url + method + status", () => {
    expect(
      evaluate(
        { type: "network_recent", url_pattern: "/api/me", method: "GET", status: 200 },
        snap
      )
    ).toBe(true);
  });

  it("fails when status does not match", () => {
    expect(
      evaluate(
        { type: "network_recent", url_pattern: "/api/me", method: "GET", status: 404 },
        snap
      )
    ).toBe(false);
  });

  it("returns false when snapshot has no network field", () => {
    expect(
      evaluate({ type: "network_recent", url_pattern: "/api/me" }, bare)
    ).toBe(false);
  });

  it("url_pattern match is case-insensitive", () => {
    expect(
      evaluate({ type: "network_recent", url_pattern: "/API/ME" }, snap)
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cookies_contain
// ---------------------------------------------------------------------------

describe("cookies_contain", () => {
  it("matches when cookie name exists", () => {
    expect(evaluate({ type: "cookies_contain", name: "li_at" }, snap)).toBe(true);
  });

  it("fails when cookie name does not exist", () => {
    expect(evaluate({ type: "cookies_contain", name: "nonexistent" }, snap)).toBe(false);
  });

  it("matches with value_regex", () => {
    expect(
      evaluate({ type: "cookies_contain", name: "li_at", value_regex: "^abc" }, snap)
    ).toBe(true);
  });

  it("fails when value_regex does not match the cookie value", () => {
    expect(
      evaluate({ type: "cookies_contain", name: "li_at", value_regex: "^xyz" }, snap)
    ).toBe(false);
  });

  it("returns false when snapshot has no cookies field", () => {
    expect(evaluate({ type: "cookies_contain", name: "li_at" }, bare)).toBe(false);
  });

  it("invalid value_regex returns false, does not throw", () => {
    expect(() =>
      evaluate({ type: "cookies_contain", name: "li_at", value_regex: "[bad" }, snap)
    ).not.toThrow();
    expect(evaluate({ type: "cookies_contain", name: "li_at", value_regex: "[bad" }, snap)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// forms_present
// ---------------------------------------------------------------------------

describe("forms_present", () => {
  it("matches when at least one form is present (no constraints)", () => {
    expect(evaluate({ type: "forms_present" }, snap)).toBe(true);
  });

  it("matches when min_fields is satisfied", () => {
    expect(evaluate({ type: "forms_present", min_fields: 2 }, snap)).toBe(true);
  });

  it("fails when min_fields is not satisfied", () => {
    expect(evaluate({ type: "forms_present", min_fields: 5 }, snap)).toBe(false);
  });

  it("matches when field_types are present", () => {
    expect(
      evaluate({ type: "forms_present", field_types: ["text", "password"] }, snap)
    ).toBe(true);
  });

  it("fails when a required field_type is missing", () => {
    expect(
      evaluate({ type: "forms_present", field_types: ["email"] }, snap)
    ).toBe(false);
  });

  it("returns false when snapshot has no forms field", () => {
    expect(evaluate({ type: "forms_present" }, bare)).toBe(false);
  });

  it("returns false when forms array is empty", () => {
    const s = { ...snap, forms: [] };
    expect(evaluate({ type: "forms_present" }, s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// and / or / not combinators
// ---------------------------------------------------------------------------

describe("and combinator", () => {
  it("returns true when all sub-predicates pass", () => {
    expect(
      evaluate(
        {
          type: "and",
          all: [
            { type: "url_pattern", regex: "/feed$" },
            { type: "ax_role_name", role: "button", name: "Sign out" },
          ],
        },
        snap
      )
    ).toBe(true);
  });

  it("returns false when any sub-predicate fails", () => {
    expect(
      evaluate(
        {
          type: "and",
          all: [
            { type: "url_pattern", regex: "/feed$" },
            { type: "ax_role_name", role: "button", name: "Login" },
          ],
        },
        snap
      )
    ).toBe(false);
  });

  it("vacuous AND (empty all) returns true", () => {
    expect(evaluate({ type: "and", all: [] }, snap)).toBe(true);
  });

  it("short-circuits on first failure", () => {
    // If first fails, second (which would pass) is irrelevant — still false
    expect(
      evaluate(
        {
          type: "and",
          all: [
            { type: "url_pattern", regex: "/login$" },
            { type: "url_pattern", regex: "/feed$" },
          ],
        },
        snap
      )
    ).toBe(false);
  });
});

describe("or combinator", () => {
  it("returns true when any sub-predicate passes", () => {
    expect(
      evaluate(
        {
          type: "or",
          any: [
            { type: "url_pattern", regex: "/banana" },
            { type: "ax_role_name", role: "button", name: "Sign out" },
          ],
        },
        snap
      )
    ).toBe(true);
  });

  it("returns false when all sub-predicates fail", () => {
    expect(
      evaluate(
        {
          type: "or",
          any: [
            { type: "url_pattern", regex: "/banana" },
            { type: "ax_role_name", role: "button", name: "Login" },
          ],
        },
        snap
      )
    ).toBe(false);
  });

  it("vacuous OR (empty any) returns false", () => {
    expect(evaluate({ type: "or", any: [] }, snap)).toBe(false);
  });
});

describe("not combinator", () => {
  it("inverts a passing predicate to false", () => {
    expect(
      evaluate(
        { type: "not", not: { type: "url_pattern", regex: "/feed$" } },
        snap
      )
    ).toBe(false);
  });

  it("inverts a failing predicate to true", () => {
    expect(
      evaluate(
        { type: "not", not: { type: "url_pattern", regex: "/login$" } },
        snap
      )
    ).toBe(true);
  });

  it("double-not returns original result", () => {
    expect(
      evaluate(
        {
          type: "not",
          not: { type: "not", not: { type: "url_pattern", regex: "/feed$" } },
        },
        snap
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown / malformed predicate types (graceful degradation)
// ---------------------------------------------------------------------------

describe("graceful degradation", () => {
  it("unknown predicate type returns false, does not throw", () => {
    expect(() =>
      evaluate({ type: "unknown_kind" } as unknown as Predicate, snap)
    ).not.toThrow();
    expect(evaluate({ type: "unknown_kind" } as unknown as Predicate, snap)).toBe(false);
  });

  it("undefined predicate fields are handled gracefully", () => {
    // ax_role_name with no role matching existing nodes
    expect(
      evaluate({ type: "ax_role_name", role: "nonexistent_role" }, snap)
    ).toBe(false);
  });
});
