import type { EngineCapabilities } from "./capability-types.js";

/** Lightpanda — Zig-based headless browser. Fast but JS-limited. */
export const LIGHTPANDA_CAPS: EngineCapabilities = {
  engine: "lightpanda",
  js: "basic",
  features: ["complex_forms"],
  latency: "fast",
  cost: 1,
};

/** Chrome (or Chromium) — full browser. Slower but feature-complete. */
export const CHROME_CAPS: EngineCapabilities = {
  engine: "chrome",
  js: "full",
  features: [
    "webrtc",
    "service_worker",
    "webassembly",
    "shadow_dom_v1",
    "complex_forms",
    "media_playback",
    "file_upload",
    "websocket",
  ],
  latency: "medium",
  cost: 10,
};

/** Registry of all known engines. */
export const ALL_ENGINES: EngineCapabilities[] = [LIGHTPANDA_CAPS, CHROME_CAPS];

/** Look up capabilities by engine kind. Returns null when unknown. */
export function findEngine(name: string): EngineCapabilities | null {
  return ALL_ENGINES.find((e) => e.engine === name) ?? null;
}
