import { describe, expect, it } from "vitest";
import { runPreActionSanity, runPostActionAssertions } from "../../src/watchdog/sanity.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function makeSnap(nodes: Array<{ i: string; r: string; n: string; s?: ("v"|"e"|"c"|"f"|"d")[] }>): Snapshot {
  const [root, ...rest] = nodes;
  return {
    v: 1,
    url: "https://x.test",
    count: nodes.length,
    root: {
      ...root,
      s: root.s ?? ["v", "e"],
      c: rest.map((n) => ({ ...n, s: n.s ?? ["v", "e"] })),
    },
  };
}

describe("runPreActionSanity", () => {
  it("passes when button exists, visible, enabled, and click is role-compatible", () => {
    const snap = makeSnap([
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "button:ok", r: "button", n: "Submit", s: ["v", "e"] },
    ]);
    const res = runPreActionSanity(snap, "click", "button:ok");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.node?.i).toBe("button:ok");
  });

  it("rejects with element_not_found when stable_id is missing", () => {
    const snap = makeSnap([{ i: "RootWebArea:r", r: "RootWebArea", n: "Page" }]);
    const res = runPreActionSanity(snap, "click", "button:ghost");
    expect(res).toEqual({ ok: false, reason: "element_not_found", node: null });
  });

  it("rejects with element_not_visible when node lacks 'v' flag", () => {
    const snap = makeSnap([
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "button:x", r: "button", n: "X", s: ["e"] },
    ]);
    const res = runPreActionSanity(snap, "click", "button:x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("element_not_visible");
  });

  it("rejects with element_disabled when node carries 'd' or lacks 'e'", () => {
    const snap = makeSnap([
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "button:dis", r: "button", n: "Off", s: ["v", "d"] },
    ]);
    const res = runPreActionSanity(snap, "click", "button:dis");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("element_disabled");
  });

  it("rejects with wrong_role_for_action when verb doesn't fit the role", () => {
    const snap = makeSnap([
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "heading:h", r: "heading", n: "Title", s: ["v", "e"] },
    ]);
    const res = runPreActionSanity(snap, "click", "heading:h");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("wrong_role_for_action");
  });

  it("skips existence check entirely for press_key (focus-level)", () => {
    const snap = makeSnap([{ i: "RootWebArea:r", r: "RootWebArea", n: "Page" }]);
    const res = runPreActionSanity(snap, "press_key", null);
    expect(res.ok).toBe(true);
  });

  it("allows type on textbox without requiring 'e' flag (textbox-enabled is implicit)", () => {
    const snap = makeSnap([
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "textbox:t", r: "textbox", n: "Email", s: ["v"] },
    ]);
    const res = runPreActionSanity(snap, "type", "textbox:t");
    expect(res.ok).toBe(true);
  });
});

describe("runPostActionAssertions", () => {
  const before: Snapshot = {
    v: 1, url: "https://x.test/a", count: 2,
    root: {
      i: "RootWebArea:r", r: "RootWebArea", n: "Page", s: ["v"],
      c: [{ i: "button:b", r: "button", n: "Go", s: ["v", "e"] }],
    },
  };

  it("returns no warnings when DOM changed, no alert appeared, URL unchanged", () => {
    const after: Snapshot = {
      ...before,
      root: {
        ...before.root,
        c: [
          { i: "button:b", r: "button", n: "Go", s: ["v", "e"] },
          { i: "paragraph:p", r: "paragraph", n: "Hello!", s: ["v"] },
        ],
      },
    };
    const warnings = runPostActionAssertions({
      verb: "click",
      before, after,
      urlBefore: "https://x.test/a",
      urlAfter: "https://x.test/a",
    });
    expect(warnings).toEqual([]);
  });

  it("emits no_mutation_observed when before and after are identical", () => {
    const warnings = runPostActionAssertions({
      verb: "click", before, after: before,
      urlBefore: "https://x.test/a", urlAfter: "https://x.test/a",
    });
    expect(warnings.map((w) => w.reason)).toContain("no_mutation_observed");
  });

  it("emits error_alert_appeared when a new alert role with negative content is present", () => {
    const after: Snapshot = {
      ...before,
      root: {
        ...before.root,
        c: [
          { i: "button:b", r: "button", n: "Go", s: ["v", "e"] },
          { i: "alert:a", r: "alert", n: "Submission failed: invalid email", s: ["v"] },
        ],
      },
    };
    const warnings = runPostActionAssertions({
      verb: "click", before, after,
      urlBefore: "https://x.test/a", urlAfter: "https://x.test/a",
    });
    expect(warnings.some((w) => w.reason === "error_alert_appeared")).toBe(true);
  });

  it("emits unexpected_navigation when click changed the URL", () => {
    const after = { ...before, url: "https://x.test/b" };
    const warnings = runPostActionAssertions({
      verb: "click", before, after,
      urlBefore: "https://x.test/a", urlAfter: "https://x.test/b",
    });
    expect(warnings.some((w) => w.reason === "unexpected_navigation")).toBe(true);
  });

  it("does NOT emit unexpected_navigation for press_key (Tab/Enter can legitimately navigate)", () => {
    const after = { ...before, url: "https://x.test/b" };
    const warnings = runPostActionAssertions({
      verb: "press_key", before, after,
      urlBefore: "https://x.test/a", urlAfter: "https://x.test/b",
    });
    expect(warnings.some((w) => w.reason === "unexpected_navigation")).toBe(false);
  });
});
