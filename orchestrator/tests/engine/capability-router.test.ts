import { describe, it, expect } from "vitest";
import { scoreEngine, rankEngines, pickEngine } from "../../src/engine/capability-router.js";
import { LIGHTPANDA_CAPS, CHROME_CAPS, ALL_ENGINES } from "../../src/engine/engine-capabilities.js";

describe("scoreEngine", () => {
  it("lightpanda meets a basic-js requirement with no features", () => {
    const s = scoreEngine(LIGHTPANDA_CAPS, {});
    expect(s.meets).toBe(true);
    expect(s.reasons).toBeUndefined();
  });

  it("lightpanda fails a full-js requirement", () => {
    const s = scoreEngine(LIGHTPANDA_CAPS, { js: "full" });
    expect(s.meets).toBe(false);
    expect(s.reasons?.[0]).toMatch(/js/);
  });

  it("chrome meets webrtc + service_worker requirements", () => {
    const s = scoreEngine(CHROME_CAPS, { features: ["webrtc", "service_worker"] });
    expect(s.meets).toBe(true);
  });

  it("lightpanda fails when webrtc is required", () => {
    const s = scoreEngine(LIGHTPANDA_CAPS, { features: ["webrtc"] });
    expect(s.meets).toBe(false);
    expect(s.reasons?.[0]).toMatch(/webrtc/);
  });

  it("max_latency rejects slower engines", () => {
    const s = scoreEngine(CHROME_CAPS, { max_latency: "fast" });
    expect(s.meets).toBe(false);
  });

  it("cookies_for requires a matching inventory entry", () => {
    const inv = new Set(["chrome:linkedin.com"]);
    expect(scoreEngine(CHROME_CAPS, { cookies_for: ["linkedin.com"] }, inv).meets).toBe(true);
    expect(scoreEngine(CHROME_CAPS, { cookies_for: ["linkedin.com"] }).meets).toBe(false);
    expect(scoreEngine(LIGHTPANDA_CAPS, { cookies_for: ["linkedin.com"] }, inv).meets).toBe(false);
  });

  it("prefer_engines adds a tie-break bonus", () => {
    const a = scoreEngine(LIGHTPANDA_CAPS, {});
    const b = scoreEngine(LIGHTPANDA_CAPS, { prefer_engines: ["lightpanda"] });
    expect(b.score).toBeGreaterThan(a.score);
  });
});

describe("rankEngines + pickEngine", () => {
  it("ranks meeting engines first, then by score", () => {
    const ranked = rankEngines(ALL_ENGINES, {});
    expect(ranked[0].meets).toBe(true);
    expect(ranked[1].meets).toBe(true);
    // Both meet basic; lightpanda is cheaper → ranks higher
    expect(ranked[0].engine).toBe("lightpanda");
    expect(ranked[1].engine).toBe("chrome");
  });

  it("pickEngine returns lightpanda for trivial requirements", () => {
    expect(pickEngine(ALL_ENGINES, {})).toBe("lightpanda");
  });

  it("pickEngine returns chrome when webrtc required", () => {
    expect(pickEngine(ALL_ENGINES, { features: ["webrtc"] })).toBe("chrome");
  });

  it("pickEngine returns null when nothing matches", () => {
    expect(pickEngine([LIGHTPANDA_CAPS], { features: ["webrtc"] })).toBeNull();
  });

  it("prefer_engines flips ranking on tie", () => {
    const r = rankEngines(ALL_ENGINES, { prefer_engines: ["chrome"] });
    expect(r[0].engine).toBe("chrome");
  });
});
