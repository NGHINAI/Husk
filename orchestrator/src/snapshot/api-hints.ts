/**
 * api-hints — derive likely REST/GraphQL API endpoints from the network buffer.
 *
 * Filters the raw network ring buffer down to requests that are likely to be
 * data-layer API calls an AI agent could call directly via fetch(). Excludes
 * static assets (HTML, CSS, JS, images, fonts), failed requests, and dedupes
 * by URL+method.
 */

import type { NetworkEntry } from "../session/network-buffer.js";

export interface ApiHint {
  url: string;
  method: string;
  status: number | undefined;
  content_type: string | undefined;
}

/**
 * Content-type prefixes that unambiguously indicate static assets.
 * Checked against the lowercased content_type string.
 */
const STATIC_CONTENT_TYPES = [
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "image/",
  "font/",
  "video/",
  "audio/",
];

/**
 * Path patterns that suggest an API endpoint regardless of content-type.
 * Matches: /api/, /v1/, /v2/, /graphql, /rest
 */
const API_PATH_HINTS = /\/api\/|\/v\d+\/|\/graphql\b|\/rest\b/i;

/**
 * Derive a filtered, deduped list of likely API endpoints from a network
 * ring buffer snapshot. Pure function — no side effects.
 *
 * Inclusion criteria (must satisfy ALL):
 *   1. Not a failed request (status < 400, or status undefined for in-flight)
 *   2. Not a static asset content-type
 *   3. Either: content-type looks like JSON/GraphQL, OR path matches API_PATH_HINTS
 *
 * Deduplication key: `${method} ${url}` — first occurrence wins.
 */
export function deriveApiHints(recent: NetworkEntry[]): ApiHint[] {
  const candidates: ApiHint[] = [];

  for (const entry of recent) {
    // 1. Exclude definitively failed requests (>= 400).
    //    status === 0 means network-level failure (loadingFailed), also exclude.
    if (entry.status !== undefined && entry.status >= 400) continue;
    if (entry.status === 0) continue;

    const ct = (entry.content_type ?? "").toLowerCase();

    // 2. Exclude static asset content-types.
    const isStatic = STATIC_CONTENT_TYPES.some((prefix) => ct.startsWith(prefix));
    if (isStatic) continue;

    // 3. Must look like an API endpoint.
    const looksJson = /json|\+json|graphql/.test(ct);
    const looksApiPath = API_PATH_HINTS.test(entry.url);
    if (!looksJson && !looksApiPath) continue;

    candidates.push({
      url: entry.url,
      method: entry.method,
      status: entry.status,
      content_type: entry.content_type,
    });
  }

  // 4. Dedup by URL+method, preserving first occurrence order.
  const seen = new Set<string>();
  return candidates.filter((hint) => {
    const key = `${hint.method} ${hint.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
