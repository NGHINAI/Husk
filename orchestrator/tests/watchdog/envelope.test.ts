import { describe, expect, it } from "vitest";
import { buildRejection } from "../../src/watchdog/envelope.js";
import type { Snapshot } from "../../src/snapshot/types.js";

const snap: Snapshot = {
  v: 1,
  url: "https://x.test",
  count: 1,
  root: { i: "RootWebArea:r", r: "RootWebArea", n: "Page", s: ["v"] },
};

describe("buildRejection", () => {
  it("returns ok:false with the supplied reason + verb + snapshot", () => {
    const env = buildRejection({
      reason: "element_not_found",
      verb: "click",
      stable_id_attempted: "button:missing",
      snapshot: snap,
      candidates: [],
    });
    expect(env.ok).toBe(false);
    expect(env.reason).toBe("element_not_found");
    expect(env.verb).toBe("click");
    expect(env.stable_id_attempted).toBe("button:missing");
    expect(env.snapshot_at_attempt).toBe(snap);
    expect(env.candidates).toEqual([]);
    expect(env.message).toBeUndefined();
  });

  it("includes optional message when supplied", () => {
    const env = buildRejection({
      reason: "policy_forbidden",
      verb: "click",
      stable_id_attempted: "button:delete",
      snapshot: snap,
      candidates: [],
      message: "Delete is forbidden by policy",
    });
    expect(env.message).toBe("Delete is forbidden by policy");
  });
});
