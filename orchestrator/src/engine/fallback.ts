/**
 * fallback.ts
 *
 * Engine swap with state transfer: lightpanda → Chrome.
 *
 * When page-health detects that lightpanda can't render the current page,
 * this function captures state (URL + cookies), releases the lightpanda
 * handle, acquires a Chrome handle, restores state, and re-navigates.
 * The session_id is unchanged throughout; stable_ids naturally invalidate
 * because the next snapshot comes from a different engine.
 *
 * Order of operations (strictly enforced):
 *  1. Capture current URL from the existing engine
 *  2. Capture all cookies from the existing engine (best-effort)
 *  3. Acquire a fresh Chrome handle from the pool (may fail → error result)
 *  4. Release the old (lightpanda) handle BEFORE swapping (no overlap)
 *  5. Swap in the new Chrome handle
 *  6. Restore cookies into the new engine (best-effort)
 *  7. Re-navigate to the captured URL (skipped if null or about:blank)
 */

import type { ChromePool } from "./chrome-pool.js";
import type { EngineHandle } from "./engine-router.js";

// ---------------------------------------------------------------------------
// Cookie type — shared between export and import
// ---------------------------------------------------------------------------

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

// ---------------------------------------------------------------------------
// SwappableSession interface
// ---------------------------------------------------------------------------

/**
 * Minimal Session interface this module depends on.
 * The real Session (T6) implements all of these.
 * Defined here as an interface so fallbackToChrome is fully decoupled from
 * the concrete Session class.
 */
export interface SwappableSession {
  /** Return the URL currently loaded in the engine, or null if none. */
  getCurrentUrl(): string | null;
  /** Export all cookies from the current engine. */
  exportCookies(): Promise<Cookie[]>;
  /**
   * Import cookies into the current engine.
   * Returns the number of cookies successfully imported.
   */
  importCookies(cookies: Cookie[]): Promise<number>;
  /** Release the current engine handle back to its pool. */
  releaseEngine(): Promise<void>;
  /** Replace the session's internal engine handle with a new one. */
  swapEngine(handle: EngineHandle): Promise<void>;
  /** Navigate the current engine to the given URL. */
  goto(url: string, opts?: { include_snapshot?: boolean }): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface FallbackResult {
  ok: boolean;
  new_engine?: "chrome";
  fellback_from?: "lightpanda";
  cookies_transferred: number;
  ms_elapsed: number;
  reason?: "chrome_not_found" | "pool_exhausted" | "swap_failed";
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Swap a session's underlying engine from lightpanda to Chrome.
 * Preserves URL + cookies across the swap.
 *
 * Returns a structured FallbackResult indicating success or failure mode.
 * The old engine is always released on error paths (cleanup guarantee).
 */
export async function fallbackToChrome(
  session: SwappableSession,
  chromePool: ChromePool,
  sessionId: string,
): Promise<FallbackResult> {
  const start = Date.now();

  // Step 1: capture current URL before touching anything
  const currentUrl = session.getCurrentUrl();

  // Step 2: capture cookies (best-effort — a CDP error here shouldn't abort the swap)
  let cookies: Cookie[] = [];
  try {
    cookies = await session.exportCookies();
  } catch {
    cookies = [];
  }

  // Step 3: acquire a Chrome handle from the pool — this can legitimately fail
  let chromeHandle: EngineHandle;
  try {
    const raw = await chromePool.acquire(sessionId);
    // Wrap with pool-aware release so the handle returns to the pool on release()
    chromeHandle = {
      kind: "chrome",
      cdp: raw.cdp,
      port: (raw as any).port,
      profileDir: (raw as any).profileDir,
      release: () => chromePool.releaseToPool(raw as any),
    };
  } catch (err) {
    const msg = String((err as Error).message ?? "");
    let reason: FallbackResult["reason"];
    if (/timeout/i.test(msg)) {
      reason = "pool_exhausted";
    } else {
      // "not found", binary missing, spawn error → chrome_not_found
      reason = "chrome_not_found";
    }
    return {
      ok: false,
      cookies_transferred: 0,
      ms_elapsed: Date.now() - start,
      reason,
    };
  }

  // Step 4: release the OLD engine BEFORE the swap.
  // No two CDP sessions should be live on the same logical session at once.
  try {
    await session.releaseEngine();
  } catch {
    // Best-effort — swallow; the swap should proceed regardless
  }

  // Step 5: swap in the new Chrome handle
  try {
    await session.swapEngine(chromeHandle);
  } catch {
    // Swap failed — return the chrome handle to the pool to avoid leaking it
    try {
      await chromeHandle.release();
    } catch {
      // swallow secondary failure
    }
    return {
      ok: false,
      cookies_transferred: 0,
      ms_elapsed: Date.now() - start,
      reason: "swap_failed",
    };
  }

  // Step 6: restore cookies into the new engine (best-effort)
  let cookiesImported = 0;
  if (cookies.length > 0) {
    try {
      cookiesImported = await session.importCookies(cookies);
    } catch {
      cookiesImported = 0;
    }
  }

  // Step 7: re-navigate to the captured URL — skip if null or about:blank
  if (currentUrl && currentUrl !== "about:blank") {
    try {
      await session.goto(currentUrl);
    } catch {
      // Navigation failed, but the engine swap itself succeeded.
      // Return ok:true — the caller can retry navigation independently.
    }
  }

  return {
    ok: true,
    new_engine: "chrome",
    fellback_from: "lightpanda",
    cookies_transferred: cookiesImported,
    ms_elapsed: Date.now() - start,
  };
}
