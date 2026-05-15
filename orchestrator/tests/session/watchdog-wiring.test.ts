import { describe, expect, it } from "vitest";
import { Watchdog } from "../../src/watchdog/watchdog.js";
import type { Snapshot } from "../../src/snapshot/types.js";
import { SelectorResolver } from "../../src/snapshot/resolver.js";

function snapWithButton(): Snapshot {
  const r = new SelectorResolver();
  r.set("button:ok", 42);
  return {
    v: 1, url: "https://x.test/", count: 2,
    root: {
      i: "RootWebArea:r", r: "RootWebArea", n: "Page", s: ["v"],
      c: [{ i: "button:ok", r: "button", n: "Submit", s: ["v", "e"] }],
    },
    _resolver: r,
  };
}

describe("Watchdog.evaluatePre", () => {
  it("returns ok with resolved backendNodeId when sanity passes", () => {
    const wd = new Watchdog();
    const res = wd.evaluatePre(snapWithButton(), "click", "button:ok");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.backendNodeId).toBe(42);
  });

  it("returns rejection when stable_id missing", () => {
    const wd = new Watchdog();
    const res = wd.evaluatePre(snapWithButton(), "click", "button:ghost");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.envelope.reason).toBe("element_not_found");
  });

  it("returns rejection when role doesn't match verb", () => {
    const wd = new Watchdog();
    const snap = snapWithButton();
    snap.root.c![0] = { i: "heading:h", r: "heading", n: "Title", s: ["v", "e"] };
    snap._resolver!.set("heading:h", 99);
    const res = wd.evaluatePre(snap, "click", "heading:h");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.envelope.reason).toBe("wrong_role_for_action");
  });

  it("returns ok with backendNodeId=null for press_key", () => {
    const wd = new Watchdog();
    const res = wd.evaluatePre(snapWithButton(), "press_key", null);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.backendNodeId).toBe(null);
  });
});
