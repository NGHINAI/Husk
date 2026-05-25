/**
 * Capability layer for Husk v0.1 Phase D.
 *
 * Intentions / sessions declare what they need; engines declare what they offer.
 * The router scores each engine against requirements and picks the best match.
 */

/** JS execution level offered (or required). */
export type JsLevel = "none" | "basic" | "full";

/** Latency class — coarse-grained ranking for tie-breaking. */
export type LatencyClass = "fast" | "medium" | "slow";

/** A feature flag — open enum so site-specific needs can extend it. */
export type FeatureFlag =
  | "webrtc"
  | "service_worker"
  | "webassembly"
  | "shadow_dom_v1"
  | "complex_forms"
  | "media_playback"
  | "file_upload"
  | "websocket"
  | string;

/** What an intention or session declares it needs from an engine. */
export interface CapabilityRequirement {
  /** Minimum JS execution level. Defaults to "basic" when omitted. */
  js?: JsLevel;
  /** Feature flags the task requires. Defaults to []. */
  features?: FeatureFlag[];
  /** Domains the engine must already have authenticated session cookies for. */
  cookies_for?: string[];
  /** Maximum acceptable latency class. Engines slower than this are rejected. */
  max_latency?: LatencyClass;
  /** Soft preference for engines on this list when scores tie. */
  prefer_engines?: string[];
}

/** What an engine offers. */
export interface EngineCapabilities {
  /** Identifier — matches the kind used by the engine-router (e.g. "lightpanda", "chrome"). */
  engine: string;
  /** Maximum JS level supported. */
  js: JsLevel;
  /** Feature flags supported. */
  features: FeatureFlag[];
  /** Typical latency class for cold action dispatch. */
  latency: LatencyClass;
  /** Rough cost score (relative). Cheaper engines preferred when capabilities match. */
  cost: number;
}

/** Score for a single engine against a requirement set. */
export interface CapabilityScore {
  engine: string;
  /** Hard-pass: meets all required capabilities. */
  meets: boolean;
  /** Tie-break score; only meaningful when meets=true. Higher is better. */
  score: number;
  /** When meets=false, the unmet constraints. */
  reasons?: string[];
}

const JS_RANK: Record<JsLevel, number> = { none: 0, basic: 1, full: 2 };
const LATENCY_RANK: Record<LatencyClass, number> = { fast: 0, medium: 1, slow: 2 };

/** Compare two js levels: returns true when `offered >= required`. */
export function meetsJs(offered: JsLevel, required: JsLevel): boolean {
  return JS_RANK[offered] >= JS_RANK[required];
}

/** Latency comparison: returns true when `offered <= max_latency`. */
export function meetsLatency(offered: LatencyClass, max: LatencyClass): boolean {
  return LATENCY_RANK[offered] <= LATENCY_RANK[max];
}
