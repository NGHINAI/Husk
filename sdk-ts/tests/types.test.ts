import { describe, expect, it } from "vitest";
import type {
  Snapshot,
  SnapshotNode,
  RejectionEnvelope,
  ActionResult,
  Warning,
  PolicyDocument,
  Verb,
} from "../src/types.js";

describe("wire types", () => {
  it("Snapshot matches orchestrator wire format (v=1, url, count, root)", () => {
    const s: Snapshot = {
      v: 1,
      url: "https://x.test",
      count: 1,
      root: { i: "RootWebArea:r", r: "RootWebArea", n: "Page", s: ["v"] },
    };
    expect(s.v).toBe(1);
    expect(s.root.i).toBe("RootWebArea:r");
  });

  it("RejectionEnvelope is a discriminated union via ok:false", () => {
    const e: RejectionEnvelope = {
      ok: false,
      reason: "element_not_found",
      verb: "click",
      stable_id_attempted: "button:ghost",
      candidates: [],
      snapshot_at_attempt: { v: 1, url: "", count: 0, root: { i: "x", r: "x", n: "", s: [] } },
    };
    expect(e.ok).toBe(false);
  });

  it("ActionResult discriminates ok via the literal type", () => {
    const success: ActionResult = { ok: true, warnings: [] as Warning[] };
    const failure: ActionResult = {
      ok: false,
      reason: "element_disabled",
      verb: "click",
      stable_id_attempted: "x",
      candidates: [],
      snapshot_at_attempt: { v: 1, url: "", count: 0, root: { i: "x", r: "x", n: "", s: [] } },
    };
    expect(success.ok && "warnings" in success).toBe(true);
    expect(!failure.ok && "reason" in failure).toBe(true);
  });
});
