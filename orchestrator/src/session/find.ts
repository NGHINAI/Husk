import { jaroWinkler } from "../watchdog/candidates.js";
import type { SiteGraphCache } from "../cache/site-graph.js";

const ROLE_HINTS: Record<string, string> = {
  button: "button", btn: "button", link: "link", text: "textbox",
  textbox: "textbox", input: "textbox", field: "textbox", checkbox: "checkbox",
  radio: "radio", select: "combobox", combobox: "combobox", dropdown: "combobox",
  heading: "heading", title: "heading", image: "img", img: "img",
};

/**
 * Minimum composite score for a candidate to be included.
 * Composite = geometric_mean(full-string JW, avg-best-token JW), which
 * down-weights matches where the full-string OR the token-level similarity
 * is weak. 0.55 keeps semantically-close matches while rejecting
 * completely-unrelated content (e.g. "checkout cart total" vs "Email").
 */
const SCORE_THRESHOLD = 0.55;

export interface FindInput { intent: string; }

/**
 * A named subdivision of the visible viewport (3×3 grid).
 * Used in FindCandidate.viewport.region to let agents disambiguate by
 * visual location ("the one near top-left").
 */
export type ViewportRegion =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export interface FindCandidate {
  stable_id: string;
  role: string;
  name: string;
  score: number;
  /** Viewport position of this candidate — populated by the call-site
   *  (Session.resolveTarget) after CDP DOM.getBoxModel lookup.
   *  Absent when the caller did not request viewport enrichment. */
  viewport?: { x: number; y: number; region: ViewportRegion };
}

export interface FindResult {
  ok: boolean;
  candidates: FindCandidate[];
}

export interface FindContext {
  snapshot: { nodes: Array<{ i: string; r: string; n: string }> };
  cache: null | { query(role: string, nameNorm: string): Array<{ stable_id: string; role: string; name: string }> };
  /** Optional SiteGraphCache for reliability-weighted ranking. */
  siteGraphCache?: SiteGraphCache;
  /** Domain (hostname) for reliability lookup. Required when siteGraphCache is set. */
  domain?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractRoleHint(tokens: string[]): { role?: string; rest: string[] } {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const r = ROLE_HINTS[tokens[i]];
    if (r) return { role: r, rest: tokens.filter((_, j) => j !== i) };
  }
  return { rest: tokens };
}

/**
 * Composite similarity between a query string and a node's accessible name.
 *
 * Uses the geometric mean of:
 *   (a) full-string Jaro-Winkler — rewards overall character proximity, and
 *   (b) avg-best-token JW — for each query token, takes the best JW against
 *       any node token, then averages across query tokens.
 *
 * Geometric mean ensures both dimensions must be reasonable; a high score
 * on one axis alone (e.g. long shared prefix in full-string JW) is not
 * sufficient when the token-level match is poor, and vice-versa.
 */
function compositeScore(targetName: string, nodeNorm: string): number {
  const fullScore = jaroWinkler(targetName, nodeNorm);

  const qTokens = targetName.split(" ").filter(Boolean);
  const nTokens = nodeNorm.split(" ").filter(Boolean);
  if (qTokens.length === 0 || nTokens.length === 0) return fullScore;

  let totalBest = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const nt of nTokens) {
      const s = jaroWinkler(qt, nt);
      if (s > best) best = s;
    }
    totalBest += best;
  }
  const avgTokenScore = totalBest / qTokens.length;

  return Math.sqrt(fullScore * avgTokenScore);
}

/**
 * Classify a (x, y) point — expressed as fractions of viewport size in [0, 1]
 * — into one of nine named viewport regions (3×3 grid).
 *
 * Boundaries: x < 0.33 → left, x < 0.66 → center, else right;
 *             y < 0.33 → top,  y < 0.66 → center, else bottom.
 * When both axes land in "center", the result is "center".
 *
 * This is a pure function with no I/O — safe to test independently.
 */
export function classifyRegion(x: number, y: number): ViewportRegion {
  const col = x < 0.33 ? "left" : x < 0.66 ? "center" : "right";
  const row = y < 0.33 ? "top"  : y < 0.66 ? "center" : "bottom";
  if (row === "center" && col === "center") return "center";
  if (row === "center") return `center-${col}` as ViewportRegion;
  if (col === "center") return `${row}-center` as ViewportRegion;
  return `${row}-${col}` as ViewportRegion;
}

export async function runFind(ctx: FindContext, input: FindInput): Promise<FindResult> {
  const norm = normalize(input.intent);
  const tokens = norm.split(" ").filter(Boolean);
  const { role: roleHint, rest } = extractRoleHint(tokens);
  // Fall back to the full normalised intent if role extraction consumed all tokens.
  const targetName = rest.length > 0 ? rest.join(" ") : norm;

  const scored: FindCandidate[] = [];
  for (const node of ctx.snapshot.nodes) {
    if (!node.n) continue;
    if (roleHint && node.r !== roleHint) continue;
    const nodeNorm = normalize(node.n);
    const score = compositeScore(targetName, nodeNorm);
    if (score >= SCORE_THRESHOLD) {
      scored.push({ stable_id: node.i, role: node.r, name: node.n, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // Reliability weighting: self-healing route ranking using M4 cache history.
  // Applies: score *= (0.5 + 0.5 * reliability)
  // A neutral-prior selector (unseen, reliability = 0.5) is multiplied by 0.75 —
  // never penalized relative to a fully-reliable one (multiplied by 1.0).
  if (ctx.siteGraphCache && ctx.domain) {
    for (const c of scored) {
      const rel = ctx.siteGraphCache.reliability(ctx.domain, c.stable_id);
      c.score = Math.min(1, c.score * (0.5 + 0.5 * rel));
    }
    scored.sort((a, b) => b.score - a.score);
  }

  const top = scored.slice(0, 3);
  return { ok: top.length > 0, candidates: top };
}
