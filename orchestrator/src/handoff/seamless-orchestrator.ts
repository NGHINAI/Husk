/**
 * seamless-orchestrator.ts
 *
 * T5: Blocking entry point for the seamless handoff flow.
 *
 * Ties T1 (chrome-launcher) + T2 (chrome-watcher) + T3 (completion-detector)
 * + T4 (cookie-sync) into a single Promise-returning function that:
 *
 *   1. Checks Chrome is available (chrome_not_found early exit)
 *   2. Creates per-handoff profile dir + finds a free port
 *   3. Spawns Chrome at targetUrl with CDP enabled
 *   4. Waits for CDP ready, connects ChromeWatcher
 *   5. Injects overlay button script (manual fallback)
 *   6. Resolves on first of:
 *      a. Navigation detectCompletion → "url_change"
 *      b. External manualDone trigger → "manual"
 *      c. timeoutMs elapsed → "timeout"
 *   7. On success (a or b): calls syncCookies → cookies_imported
 *   8. Cleanup on ALL exit paths: close watcher, kill child, rm profile dir
 *
 * All IO functions are injectable (findChrome, spawnChrome, connectToChrome,
 * createProfileDir, cleanupProfileDir) — tests pass stubs, production wires
 * the real implementations from T1–T4.
 */

import type { SpawnedChrome } from "./chrome-launcher.js";
import { findFreePort } from "./chrome-launcher.js";
import type { ChromeWatcher } from "./chrome-watcher.js";
import type { ImportingSession } from "./cookie-sync.js";
import { detectCompletion, buildOverlayScript } from "./completion-detector.js";
import { syncCookies } from "./cookie-sync.js";

export interface SeamlessHandoffResult {
  resumed: boolean;
  reason?: "timeout" | "chrome_not_found";
  cookies_imported: number;
  ms_paused: number;
}

export interface SeamlessHandoffOpts {
  session: ImportingSession;
  targetUrl: string;
  timeoutMs: number;
  token: string;
  huskPort: number;
  /** Injected deps — production wires to the real implementations; tests pass stubs. */
  findChrome: () => string | null;
  spawnChrome: (opts: {
    binaryPath: string;
    targetUrl: string;
    profileDir: string;
    port: number;
  }) => SpawnedChrome;
  connectToChrome: (port: number) => Promise<ChromeWatcher>;
  createProfileDir: (token: string) => Promise<string>;
  cleanupProfileDir: (dir: string) => Promise<void> | void;
  /**
   * Optional: the orchestrator calls this ONCE it has a manual-done trigger.
   * T6's HTTP endpoint /handoff/:token/seamless-done invokes the trigger to
   * signal that the user has clicked the overlay button.
   */
  onManualDoneHandle?: (trigger: () => void) => void;
}

export async function runSeamlessHandoff(
  opts: SeamlessHandoffOpts,
): Promise<SeamlessHandoffResult> {
  const startedAt = Date.now();

  // Step 1: Find Chrome
  const chromePath = opts.findChrome();
  if (!chromePath) {
    return {
      resumed: false,
      reason: "chrome_not_found",
      cookies_imported: 0,
      ms_paused: 0,
    };
  }

  // Step 2: Create profile dir + find free port
  const profileDir = await opts.createProfileDir(opts.token);
  // findFreePort is imported at module level; tests stub spawnChrome so the port value is irrelevant to them.
  const port = await findFreePort();

  // Step 3: Spawn Chrome
  const spawned = opts.spawnChrome({
    binaryPath: chromePath,
    targetUrl: opts.targetUrl,
    profileDir,
    port,
  });

  let watcher: ChromeWatcher | null = null;
  let resolved = false;

  return new Promise<SeamlessHandoffResult>((resolve) => {
    /** Final cleanup + resolve — idempotent: only runs once. */
    const finalize = async (result: SeamlessHandoffResult) => {
      if (resolved) return;
      resolved = true;
      try {
        if (watcher) await watcher.close();
      } catch {
        /* swallow watcher close errors */
      }
      try {
        spawned.child.kill();
      } catch {
        /* swallow child kill errors */
      }
      try {
        await opts.cleanupProfileDir(profileDir);
      } catch {
        /* swallow profile dir cleanup errors */
      }
      resolve(result);
    };

    /** Called when a completion signal fires. */
    const completionTriggered = async (
      signal: "url_change" | "manual" | "timeout",
    ) => {
      if (resolved) return;
      if (signal === "timeout") {
        await finalize({
          resumed: false,
          reason: "timeout",
          cookies_imported: 0,
          ms_paused: Date.now() - startedAt,
        });
        return;
      }
      // url_change or manual → attempt cookie sync
      let count = 0;
      if (watcher) {
        try {
          count = await syncCookies(watcher, opts.session, opts.targetUrl);
        } catch {
          count = 0;
        }
      }
      // Auto-save to vault if cookies were imported and session has a profile
      if (count > 0 && opts.session.getProfile?.() && opts.session.captureToVault) {
        try {
          await opts.session.captureToVault();
        } catch {
          // Best-effort: handoff still succeeds even if save fails
        }
      }
      await finalize({
        resumed: true,
        cookies_imported: count,
        ms_paused: Date.now() - startedAt,
      });
    };

    // Timeout watchdog
    const timeoutTimer = setTimeout(
      () => completionTriggered("timeout"),
      opts.timeoutMs,
    );

    // Publish manual-done trigger to the caller (T6 wires this to its HTTP endpoint)
    if (opts.onManualDoneHandle) {
      opts.onManualDoneHandle(() => {
        clearTimeout(timeoutTimer);
        completionTriggered("manual");
      });
    }

    // Async wiring: wait for Chrome ready → connect watcher → inject overlay → subscribe nav
    (async () => {
      try {
        // Step 4: Wait for CDP ready
        await spawned.whenReady?.();
        watcher = await opts.connectToChrome(port);

        // Step 5: Inject overlay button script (manual fallback path)
        const script = buildOverlayScript(opts.token, opts.huskPort);
        await watcher.injectOverlayScript(script);

        // Step 6: Listen for navigation events; resolve on completion
        watcher.onNavigation((url) => {
          if (resolved) return;
          if (detectCompletion(opts.targetUrl, url)) {
            clearTimeout(timeoutTimer);
            completionTriggered("url_change");
          }
        });
      } catch {
        // If wiring fails (e.g. CDP connect error), terminate with timeout-style result
        clearTimeout(timeoutTimer);
        await finalize({
          resumed: false,
          reason: "timeout",
          cookies_imported: 0,
          ms_paused: Date.now() - startedAt,
        });
      }
    })();
  });
}
