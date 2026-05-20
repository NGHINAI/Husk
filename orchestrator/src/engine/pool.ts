import { freemem } from "node:os";
import type { LightpandaProcess } from "./lifecycle.js";
import { spawnLightpanda, type LightpandaSpawnOptions } from "./lifecycle.js";

export interface EnginePoolOptions {
  /** Warm processes kept ready at all times. Default 4. */
  minWarm?: number;
  /** Hard ceiling. Default: computed from free memory. */
  maxParallel?: number;
  /** ms before excess warm processes are reaped. Default 30s. */
  idleShrinkMs?: number;
  /** ms before acquire() gives up waiting. Default 30s. */
  acquireTimeoutMs?: number;
  /** Spawn function (lets tests inject fakes). */
  spawn?: () => Promise<LightpandaProcess>;
  /** Forwarded to spawnLightpanda when no `spawn` override. */
  spawnOptions?: LightpandaSpawnOptions;
}

export interface EngineHandle {
  process: LightpandaProcess;
  release(): Promise<void>;
}

export function computeMaxParallel(opts: { freeMb?: number } = {}): number {
  const free = opts.freeMb ?? Math.floor(freemem() / 1024 / 1024);
  return Math.min(50, Math.max(1, Math.floor(free / 30)));
}

interface PoolEntry {
  process: LightpandaProcess;
  busy: boolean;
  lastReleasedAt: number;
}

export class EnginePool {
  private readonly opts: {
    minWarm: number;
    maxParallel: number;
    idleShrinkMs: number;
    acquireTimeoutMs: number;
    spawn: () => Promise<LightpandaProcess>;
  };
  private readonly entries: PoolEntry[] = [];
  private readonly waiters: Array<{ resolve: (e: PoolEntry) => void; reject: (e: Error) => void }> = [];
  private reaperInterval: NodeJS.Timeout | null = null;
  private readyPromise: Promise<void> | null = null;
  private closed = false;

  constructor(opts: EnginePoolOptions = {}) {
    this.opts = {
      minWarm: opts.minWarm ?? 4,
      maxParallel: opts.maxParallel ?? computeMaxParallel(),
      idleShrinkMs: opts.idleShrinkMs ?? 300_000,
      acquireTimeoutMs: opts.acquireTimeoutMs ?? 30_000,
      spawn: opts.spawn ?? (() => spawnLightpanda(opts.spawnOptions ?? { binary: "" })),
    };
  }

  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        const initial = await Promise.all(
          Array.from({ length: this.opts.minWarm }, () => this.spawnEntry())
        );
        this.entries.push(...initial);
        this.reaperInterval = setInterval(() => { this.reap(); }, Math.max(50, this.opts.idleShrinkMs / 2));
        this.reaperInterval.unref();
      })();
    }
    return this.readyPromise;
  }

  async acquire(): Promise<EngineHandle> {
    if (this.closed) throw new Error("EnginePool: closed");
    await this.ready();

    const free = this.entries.find((e) => !e.busy);
    if (free) {
      free.busy = true;
      return this.makeHandle(free);
    }

    if (this.entries.length < this.opts.maxParallel) {
      const fresh = await this.spawnEntry();
      fresh.busy = true;
      this.entries.push(fresh);
      return this.makeHandle(fresh);
    }

    return new Promise<EngineHandle>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const i = this.waiters.findIndex((w) => w.resolve === onResolve);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`EnginePool.acquire timed out after ${this.opts.acquireTimeoutMs}ms`));
      }, this.opts.acquireTimeoutMs);
      const onResolve = (entry: PoolEntry) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        entry.busy = true;
        resolve(this.makeHandle(entry));
      };
      this.waiters.push({ resolve: onResolve, reject });
    });
  }

  stats(): { warm: number; busy: number; total: number; max: number } {
    const busy = this.entries.filter((e) => e.busy).length;
    return {
      warm: this.entries.length - busy,
      busy,
      total: this.entries.length,
      max: this.opts.maxParallel,
    };
  }

  forceTickReaper(): void {
    this.reap();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.reaperInterval) clearInterval(this.reaperInterval);
    for (const w of this.waiters) w.reject(new Error("EnginePool: closed"));
    this.waiters.length = 0;
    await Promise.all(this.entries.map((e) => e.process.close().catch(() => {})));
    this.entries.length = 0;
  }

  private async spawnEntry(): Promise<PoolEntry> {
    const process = await this.opts.spawn();
    return { process, busy: false, lastReleasedAt: Date.now() };
  }

  private makeHandle(entry: PoolEntry): EngineHandle {
    let released = false;
    return {
      process: entry.process,
      release: async () => {
        if (released) return;
        released = true;
        entry.busy = false;
        entry.lastReleasedAt = Date.now();

        const waiter = this.waiters.shift();
        if (waiter) {
          waiter.resolve(entry);
          return;
        }

        const idleCount = this.entries.filter((e) => !e.busy).length;
        if (idleCount > this.opts.minWarm) {
          const i = this.entries.indexOf(entry);
          if (i >= 0) {
            this.entries.splice(i, 1);
            try { await entry.process.close(); } catch { /* ignore */ }
          }
        }
      },
    };
  }

  private reap(): void {
    if (this.closed) return;
    const now = Date.now();
    const idle = this.entries.filter((e) => !e.busy);
    if (idle.length <= this.opts.minWarm) return;
    const excess = idle
      .filter((e) => now - e.lastReleasedAt >= this.opts.idleShrinkMs)
      .slice(0, idle.length - this.opts.minWarm);
    for (const entry of excess) {
      const i = this.entries.indexOf(entry);
      if (i >= 0) {
        this.entries.splice(i, 1);
        void entry.process.close().catch(() => {});
      }
    }
  }
}
