/**
 * engine-router.ts
 *
 * Uniform acquire(kind) across both engine pools.
 *
 * The router is intentionally thin — it bridges two different pool APIs into
 * one consistent EngineHandle shape. No fallback logic lives here; auto-fallback
 * from lightpanda → chrome happens after goto() in the Session layer (T5/T6).
 *
 * EnginePool (lightpanda) API note:
 *   - acquire() returns an EngineHandle with a release() method
 *   - There is no releaseToPool() on EnginePool itself
 *   The router therefore defines a LightpandaPool interface whose releaseToPool
 *   receives the raw handle. Callers wrapping the real EnginePool should provide
 *   an adapter where releaseToPool(handle) calls handle.release().
 *   In tests, the mock supplies releaseToPool directly on the pool object.
 *
 * ChromePool API:
 *   - acquire(sessionId) returns ChromeEngineHandle
 *   - releaseToPool(handle) returns the handle to the pool
 */

import type { ChromePool } from "./chrome-pool.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EngineKind = "lightpanda" | "chrome" | "auto";
export type ResolvedEngineKind = "lightpanda" | "chrome";

/**
 * Uniform handle shape across both engines. Both speak CDP; both have a
 * release() that returns the handle to its respective pool.
 * The Session layer only cares about `kind` and `cdp`.
 */
export interface EngineHandle {
  kind: ResolvedEngineKind;
  /** CDP client — typed loosely to avoid coupling to either engine's specific shape. */
  cdp: unknown;
  port?: number;
  profileDir?: string;
  /** Return the handle to its pool. */
  release(): Promise<void>;
}

/**
 * Minimal interface the router requires from the lightpanda pool.
 * The real EnginePool does NOT have releaseToPool — callers must wrap it.
 * A release handle from EnginePool carries its own release() method;
 * a wrapping adapter would be: releaseToPool: (h) => h.release().
 */
export interface LightpandaPoolAdapter {
  acquire(sessionId?: string): Promise<{ cdp?: unknown; port?: number; profileDir?: string; release(): Promise<void> }>;
  releaseToPool(handle: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface EngineRouterOpts {
  lightpandaPool: LightpandaPoolAdapter;
  chromePool: ChromePool;
}

export interface EngineRouter {
  /**
   * Acquire an engine handle of the requested kind.
   * "auto" starts with lightpanda; the auto-fallback decision happens AFTER
   * goto (in Session, not here).
   */
  acquire(kind: EngineKind, sessionId: string): Promise<EngineHandle>;
  /** Shut down both pools. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEngineRouter(opts: EngineRouterOpts): EngineRouter {
  const { lightpandaPool, chromePool } = opts;

  return {
    async acquire(kind, sessionId) {
      if (kind === "chrome") {
        const handle = await chromePool.acquire(sessionId);
        return {
          kind: "chrome",
          cdp: handle.cdp,
          port: handle.port,
          profileDir: handle.profileDir,
          release: () => chromePool.releaseToPool(handle),
        };
      }

      if (kind === "lightpanda" || kind === "auto") {
        // Both "lightpanda" and "auto" start with lightpanda.
        // Auto-fallback to chrome is decided later in the goto path (T5/T6).
        const handle = await lightpandaPool.acquire(sessionId);
        return {
          kind: "lightpanda",
          cdp: handle.cdp,
          port: handle.port,
          profileDir: handle.profileDir,
          release: () => lightpandaPool.releaseToPool(handle),
        };
      }

      throw new Error(`Unknown engine kind: "${kind as string}"`);
    },

    async close() {
      await Promise.all([lightpandaPool.close(), chromePool.close()]);
    },
  };
}
