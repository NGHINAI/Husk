import type { SiteGraphCache } from "../cache/site-graph.js";
import type { Candidate, Verb } from "./types.js";

/**
 * Jaro-Winkler similarity in [0, 1]. Standard formulation:
 *   jaro = (m/|s1| + m/|s2| + (m-t)/m) / 3
 *   winkler = jaro + l * p * (1 - jaro), with l = shared prefix len (≤ 4), p = 0.1.
 * Returns 0 when either string is empty.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(b.length - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  const cap = Math.min(4, a.length, b.length);
  for (let i = 0; i < cap; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Verbs that should bias candidate search to their compatible role family.
 * `click` returns buttons/links/menuitems first; `type` returns textboxes.
 * `scroll` and `press_key` accept any role, so we don't filter.
 */
const VERB_ROLE_HINT: Record<Verb, string[] | null> = {
  click: ["button", "link", "menuitem", "checkbox", "radio", "tab", "option", "switch"],
  type: ["textbox", "combobox", "searchbox"],
  scroll: null,
  press_key: null,
  upload: null,
};

/**
 * Query the per-domain cache for selectors that fuzzy-match `nameHint`,
 * biased toward roles compatible with `verb`. Returns up to 3 candidates.
 *
 * Tradeoff: we read ALL rows for the role family (single sqlite query),
 * then score in-memory. At v0 the cache holds <10K rows per domain, which
 * scores in <2 ms. v0.1+ may push the prefix filter into SQL.
 */
export function findCandidates(
  cache: SiteGraphCache,
  domain: string,
  verb: Verb,
  nameHint: string
): Candidate[] {
  const hint = nameHint.toLowerCase().trim();
  if (!hint) return [];

  const roleHint = VERB_ROLE_HINT[verb];
  const pool: { stable_id: string; role: string; name_norm: string }[] = [];

  if (roleHint) {
    for (const r of roleHint) {
      const rows = cache.query(domain, { role: r, limit: 200 });
      pool.push(...rows);
    }
  } else {
    pool.push(...cache.query(domain, { limit: 500 }));
  }

  const scored = pool
    .filter((r) => r.name_norm.length > 0)
    .map((r) => ({
      stable_id: r.stable_id,
      role: r.role,
      name: r.name_norm,
      score: jaroWinkler(hint, r.name_norm),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored.filter((c) => c.score >= 0.6);
}
