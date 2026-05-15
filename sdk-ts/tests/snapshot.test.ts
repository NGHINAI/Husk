import { describe, expect, it } from "vitest";
import { findInSnapshot, findAllInSnapshot } from "../src/snapshot.js";
import type { Snapshot } from "../src/types.js";

const snap: Snapshot = {
  v: 1,
  url: "https://x.test",
  count: 4,
  root: {
    i: "RootWebArea:r",
    r: "RootWebArea",
    n: "Page",
    s: ["v"],
    c: [
      { i: "heading:h", r: "heading", n: "Hello Husk", s: ["v"] },
      { i: "button:submit", r: "button", n: "Submit Application", s: ["v", "e"] },
      { i: "button:disabled", r: "button", n: "Disabled Button", s: ["v", "d"] },
      { i: "textbox:email", r: "textbox", n: "Email", s: ["v", "e"] },
    ],
  },
};

describe("findInSnapshot", () => {
  it("finds by exact role + nameMatches regex", () => {
    const hit = findInSnapshot(snap, { role: "button", nameMatches: /submit/i });
    expect(hit?.i).toBe("button:submit");
  });

  it("returns null when no match", () => {
    expect(findInSnapshot(snap, { role: "link" })).toBeNull();
  });

  it("matches by name substring (string passed)", () => {
    const hit = findInSnapshot(snap, { name: "Hello" });
    expect(hit?.i).toBe("heading:h");
  });

  it("findAll returns all matches in document order", () => {
    const all = findAllInSnapshot(snap, { role: "button" });
    expect(all.map((n) => n.i)).toEqual(["button:submit", "button:disabled"]);
  });

  it("supports role omitted (any role)", () => {
    const hit = findInSnapshot(snap, { nameMatches: /Email/ });
    expect(hit?.i).toBe("textbox:email");
  });
});
