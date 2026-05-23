/**
 * chrome-pool.ts
 *
 * Memory-aware Chrome session pool for Husk.
 *
 * Key differences from the lightpanda EnginePool (pool.ts):
 *  - 500 MB per session (vs 30 MB) → lower maxParallel ceiling
 *  - minWarm default 1 (vs 4) — Chrome spinup is expensive, pre-warm conservatively
 *  - idleShrinkMs default 5 min — keep warm longer to avoid frequent cold starts
 *  - Public releaseToPool() method — caller controls lifecycle (engine-router T3)
 *  - spawn is injectable via opts for test isolation
 */

import { freemem } from "node:os";
import type { ChromeEngineHandle } from "./chrome-engine.js";
import { spawnChromeEngine } from "./chrome-engine.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChromePoolOpts {
  /** Max concurrent Chrome sessions. Default: min(50, freeMb/500). */
  maxParallel?: number;
  /** Pre-warm count on ready(). Default 1 (Chrome is heavy). */
  minWarm?: number;
  /** Idle threshold before reaping idle handles. Default 5 min. */
  idleShrinkMs?: number;
  /** Acquire timeout. Default 30s. */
  acquireTimeoutMs?: number;
  /** Injected for tests. Defaults to real spawnChromeEngine. */
  spawn?: (sessionId: string) => Promise<ChromeEngineHandle>;
}

// ---------------------------------------------------------------------------
// Pure helper — exported for direct unit tests
// ---------------------------------------------------------------------------

/**
 * Compute max parallel Chrome sessions from available memory.
 * Budget: 500 MB per Chrome session. Capped at 50, floored at 1.
 */
export function computeChromeMaxParallel(opts: { freeMb: number }): number {
  return Math.max(1, Math.min(50, Math.floor(opts.freeMb / 500)));
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface PoolEntry {
  handle: ChromeEngineHandle;
  busy: boolean;
  lastReleasedAt: number;
}

interface Waiter {
  sessionId: string;
  resolve: (h: ChromeEngineHandle) => void;
  reject: (e: Error) => void;
  deadline: number;
}

// ---------------------------------------------------------------------------
// ChromePool
// ---------------------------------------------------------------------------

export class ChromePool {
  private readonly maxParallel: number;
  private readonly minWarm: number;
  private readonly idleShrinkMs: number;
  private readonly acquireTimeoutMs: number;
  private readonly spawnFn: (sessionId: string) => Promise<ChromeEngineHandle>;

  private entries: PoolEntry[] = [];
  private waiters: Waiter[] = [];
  private closed = false;
  private reaperInterval: NodeJS.Timeout | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(opts: ChromePoolOpts = {}) {
    const freeMb = Math.floor(freemem() / 1024 / 1024);
    this.maxParallel = opts.maxParallel ?? computeChromeMaxParallel({ freeMb });
    this.minWarm = opts.minWarm ?? 1;
    this.idleShrinkMs = opts.idleShrinkMs ?? 300_000; // 5 min
    this.acquireTimeoutMs = opts.acquireTimeoutMs ?? 30_000;
    this.spawnFn = opts.spawn ?? spawnChromeEngine;

    // Reaper runs at half the idle threshold, min 50ms for test ergonomics
    const reaperInterval = Math.max(50, this.idleShrinkMs / 2);
    this.reaperInterval = setInterval(() => { this.reap(); }, reaperInterval);
    this.reaperInterval.unref();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Pre-warm minWarm handles. Call before the first acquire for best latency.
   * Idempotent — multiple calls return the same promise.
   */
  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await Promise.all(
          Array.from({ length: this.minWarm }, (_, i) =>
            this.spawnEntry(`warm-${i}`),
          ),
        );
      })();
    }
    return this.readyPromise;
  }

  /**
   * Acquire an idle Chrome handle, or spin up a new one if under maxParallel,
   * or queue and wait if at capacity.
   */
  async acquire(sessionId: string): Promise<ChromeEngineHandle> {
    if (this.closed) throw new Error("ChromePool: closed");

    // 1. Reuse an idle entry
    const idle = this.entries.find((e) => !e.busy);
    if (idle) {
      idle.busy = true;
      return idle.handle;
    }

    // 2. Spin up a fresh entry if we have capacity
    if (this.entries.length < this.maxParallel) {
      const entry = await this.spawnEntry(sessionId);
      entry.busy = true;
      return entry.handle;
    }

    // 3. Block until a slot opens or we time out
    return new Promise<ChromeEngineHandle>((resolve, reject) => {
      let settled = false;
      const deadline = Date.now() + this.acquireTimeoutMs;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.waiters.findIndex((w) => w.resolve === onResolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(
          new Error(
            `ChromePool.acquire timed out after ${this.acquireTimeoutMs}ms`,
          ),
        );
      }, this.acquireTimeoutMs);

      const onResolve = (handle: ChromeEngineHandle) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(handle);
      };

      this.waiters.push({ sessionId, resolve: onResolve, reject, deadline });
    });
  }

  /**
   * Return a handle to the pool. If a waiter is queued, the handle is handed
   * off immediately. Otherwise it becomes idle for the next acquire().
   */
  async releaseToPool(handle: ChromeEngineHandle): Promise<void> {
    const entry = this.entries.find((e) => e.handle === handle);
    if (!entry) return;

    entry.lastReleasedAt = Date.now();

    // Hand off to a queued waiter immediately
    const waiter = this.waiters.shift();
    if (waiter) {
      entry.busy = true;
      waiter.resolve(handle);
      return;
    }

    // Otherwise mark idle for reuse
    entry.busy = false;
  }

  /**
   * Shut down the pool: reject pending waiters, release all handles.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }

    // Drain waiters
    for (const w of this.waiters) {
      w.reject(new Error("ChromePool: closing"));
    }
    this.waiters = [];

    // Release all handles (busy or idle)
    await Promise.all(
      this.entries.map((e) => e.handle.release().catch(() => {})),
    );
    this.entries = [];
  }

  /**
   * Return pool stats for observability / health checks.
   */
  stats(): { warm: number; busy: number; total: number; max: number } {
    const busy = this.entries.filter((e) => e.busy).length;
    return {
      warm: this.entries.length - busy,
      busy,
      total: this.entries.length,
      max: this.maxParallel,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async spawnEntry(sessionId: string): Promise<PoolEntry> {
    const handle = await this.spawnFn(sessionId);
    const entry: PoolEntry = {
      handle,
      busy: false,
      lastReleasedAt: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  private reap(): void {
    if (this.closed) return;
    const now = Date.now();
    const idle = this.entries.filter((e) => !e.busy);
    // Never reap below minWarm
    if (idle.length <= this.minWarm) return;
    const excess = idle
      .filter((e) => now - e.lastReleasedAt >= this.idleShrinkMs)
      .slice(0, idle.length - this.minWarm);
    for (const entry of excess) {
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) {
        this.entries.splice(idx, 1);
        void entry.handle.release().catch(() => {});
      }
    }
  }
}
