/**
 * cookie-sync.ts
 *
 * Scopes Chrome's accumulated cookies to the target domain and imports them
 * into a lightpanda Session via Session.importCookies.
 *
 * Design notes:
 * - eTldPlusOne uses the "last 2 dotted parts" heuristic — it does NOT use the
 *   Public Suffix List (PSL). This means co.uk-style ccTLDs may resolve slightly
 *   wrong (we'd return "co.uk" instead of "example.co.uk"). Acceptable for v1.
 * - syncCookies skips the importCookies call when the scoped list is empty to
 *   avoid a no-op CDP round-trip.
 * - On importCookies error, syncCookies returns 0 instead of re-throwing so
 *   callers never crash due to a cookie sync failure.
 */

import type { CdpCookie } from "./chrome-watcher.js";

/**
 * A minimal Session shape — just the importCookies method, so this module
 * isn't coupled to the full Session class.
 */
export interface ImportingSession {
  importCookies(
    cookies: Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: string;
    }>,
  ): Promise<number>;
  /** Optional: get the attached profile name, or null if none set. */
  getProfile?(): string | null;
  /** Optional: capture cookies to vault (best-effort, should not throw). */
  captureToVault?(): Promise<void>;
}

/**
 * Minimal watcher shape — just getAllCookies, so this module isn't coupled to
 * the full ChromeWatcher class.
 */
export interface CookieReader {
  getAllCookies(): Promise<CdpCookie[]>;
}

/** Parse a URL and return its lowercase hostname, or null on failure. */
function tryHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Compute the "registrable domain" approximately — the last 2 dotted parts.
 *
 * Strips a leading dot first (Chrome stores cookie domains as ".example.com").
 * Single-label hostnames (e.g. "localhost") are returned as-is.
 *
 * Limitation: does not use the Public Suffix List, so co.uk-style TLDs
 * may give a slightly wrong answer — documented and acceptable for v1.
 */
export function eTldPlusOne(hostname: string): string {
  const clean = hostname.replace(/^\./, "").toLowerCase();
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;
  return parts.slice(-2).join(".");
}

/**
 * Filter `cookies` to only those whose domain matches the eTLD+1 of
 * `targetUrl` (covers the apex domain and all its subdomains).
 *
 * Returns an empty array if `targetUrl` is not a valid URL.
 */
export function scopeCookies(cookies: CdpCookie[], targetUrl: string): CdpCookie[] {
  const host = tryHostname(targetUrl);
  if (!host) return [];
  const targetEtld = eTldPlusOne(host);
  return cookies.filter((c) => eTldPlusOne(c.domain) === targetEtld);
}

/**
 * End-to-end sync:
 *  1. Read all cookies accumulated in the Chrome session.
 *  2. Scope them to the target URL's domain.
 *  3. Import into the lightpanda session.
 *
 * Returns the number of cookies imported (as reported by session.importCookies).
 *
 * Graceful degradation:
 * - If no cookies match the target domain the import call is skipped and 0 is returned.
 * - If importCookies throws, 0 is returned (the error is swallowed to avoid
 *   crashing the handoff pipeline due to a non-critical cookie sync failure).
 */
export async function syncCookies(
  watcher: CookieReader,
  session: ImportingSession,
  targetUrl: string,
): Promise<number> {
  const all = await watcher.getAllCookies();
  const scoped = scopeCookies(all, targetUrl);

  if (scoped.length === 0) {
    // Skip the CDP round-trip — nothing to import.
    return 0;
  }

  try {
    return await session.importCookies(scoped);
  } catch {
    return 0;
  }
}
