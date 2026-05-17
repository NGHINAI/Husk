/**
 * Type definitions for the site graph cache.
 */

/** One row in the `selectors` table. Matches the SQLite column shape. */
export interface SiteGraphRow {
  stable_id: string;
  /** v0.1+ for cross-deploy DOM-drift router; null in v0 */
  current_css: string | null;
  current_xpath: string | null;
  role: string;
  name_norm: string;
  /** Unix milliseconds */
  last_seen_at: number;
  /** v0.1+ fuzzy-resolve cache stats; always 0 in v0 */
  hit_count: number;
  miss_count: number;
  /** M14: per-selector action outcome counts for reliability scoring */
  success_count: number;
  failure_count: number;
}

/** Criteria for `SiteGraphCache.query()`. All fields optional; intersection semantics. */
export interface QueryCriteria {
  /** Look up by exact stable_id. Returns 0 or 1 row. */
  stable_id?: string;
  /** Match by exact ARIA role. */
  role?: string;
  /** Match by normalized accessible name (exact equality on already-normalized form). */
  name_norm?: string;
  /** Limit results. Default: no limit. */
  limit?: number;
}

/** Cache configuration. */
export interface SiteGraphConfig {
  /** Directory containing per-domain `*.db` files. Default: ~/.husk/site-graph */
  cacheDir: string;
}
