import type {
  CapabilityRequirement,
  EngineCapabilities,
  CapabilityScore,
} from "./capability-types.js";
import { meetsJs, meetsLatency } from "./capability-types.js";

/**
 * Score one engine against a capability requirement.
 *
 * meets = true iff:
 *  - engine.js >= required.js (default "basic")
 *  - engine.features ⊇ required.features
 *  - engine.latency ≤ required.max_latency (when set)
 * (cookies_for is checked by the caller against runtime cookie inventory — see capability-router caller.)
 *
 * Tie-break score: lower cost + matching prefer_engines + extra feature headroom.
 */
export function scoreEngine(
  engine: EngineCapabilities,
  req: CapabilityRequirement,
  cookieInventory?: Set<string>,
): CapabilityScore {
  const reasons: string[] = [];

  const requiredJs = req.js ?? "basic";
  if (!meetsJs(engine.js, requiredJs)) {
    reasons.push(`js: required ${requiredJs}, offered ${engine.js}`);
  }

  for (const feat of req.features ?? []) {
    if (!engine.features.includes(feat)) {
      reasons.push(`feature: missing ${feat}`);
    }
  }

  if (req.max_latency && !meetsLatency(engine.latency, req.max_latency)) {
    reasons.push(`latency: ${engine.latency} > ${req.max_latency}`);
  }

  for (const dom of req.cookies_for ?? []) {
    if (!cookieInventory || !cookieInventory.has(`${engine.engine}:${dom}`)) {
      reasons.push(`cookies: ${engine.engine} lacks session for ${dom}`);
    }
  }

  if (reasons.length > 0) {
    return { engine: engine.engine, meets: false, score: 0, reasons };
  }

  // Tie-break score (higher = better):
  //   -engine.cost (cheap wins)
  //   + prefer_engines bonus
  //   + small bonus for feature headroom over what's needed
  let score = -engine.cost;
  if (req.prefer_engines?.includes(engine.engine)) score += 100;
  const requiredFeatures = new Set(req.features ?? []);
  const extra = engine.features.filter((f) => !requiredFeatures.has(f)).length;
  score += extra * 0.1;

  return { engine: engine.engine, meets: true, score };
}

/**
 * Rank a list of engines against a requirement.
 * Returns all engines (meets and !meets), sorted by:
 *  1. meets=true first
 *  2. then by descending score
 *  3. then alphabetically (deterministic tie-break)
 */
export function rankEngines(
  engines: EngineCapabilities[],
  req: CapabilityRequirement,
  cookieInventory?: Set<string>,
): CapabilityScore[] {
  const scores = engines.map((e) => scoreEngine(e, req, cookieInventory));
  scores.sort((a, b) => {
    if (a.meets !== b.meets) return a.meets ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.engine.localeCompare(b.engine);
  });
  return scores;
}

/**
 * Pick the best matching engine for a requirement.
 * Returns the engine name or null when nothing passes the hard constraints.
 */
export function pickEngine(
  engines: EngineCapabilities[],
  req: CapabilityRequirement,
  cookieInventory?: Set<string>,
): string | null {
  const ranked = rankEngines(engines, req, cookieInventory);
  if (ranked.length === 0 || !ranked[0].meets) return null;
  return ranked[0].engine;
}
