/**
 * chrome-launcher.ts
 *
 * Cross-platform Chrome/Chromium detection and CDP-enabled spawn.
 *
 * Residual race: findFreePort() releases the port before Chrome binds it.
 * Another process could grab it in that window. This is a known OS-level
 * race that cannot be solved cleanly without retry logic at a higher level
 * (e.g. spawnChrome caller retries with a new port if whenReady() rejects).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const CHROME_CANDIDATES: Record<NodeJS.Platform, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Arc.app/Contents/MacOS/Arc",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ],
  aix: [],
  android: [],
  freebsd: [],
  haiku: [],
  openbsd: [],
  sunos: [],
  cygwin: [],
  netbsd: [],
};

/**
 * Find a Chrome-family browser binary on this OS.
 * Returns null if none found — never throws.
 */
export function findChrome(): string | null {
  const candidates = CHROME_CANDIDATES[process.platform] ?? [];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Allocate a free TCP port by binding to :0 and reading the assigned port.
 *
 * Note: there is an inherent race between this function releasing the port
 * and the caller binding it. See module-level comment for mitigation strategy.
 */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("could not resolve free port"));
      }
    });
    server.on("error", reject);
  });
}

export interface SpawnChromeOpts {
  binaryPath: string;
  targetUrl: string;
  profileDir: string;
  port: number;
  /** Extra CLI flags inserted before the target URL. Backwards-compatible — defaults to []. */
  extraArgs?: string[];
}

export interface SpawnedChrome {
  child: ChildProcess;
  port: number;
  profileDir: string;
  /** Resolves once Chrome's CDP port responds to /json/version. */
  whenReady(timeoutMs?: number): Promise<void>;
}

/** Spawn Chrome with CDP enabled and an isolated profile. */
export function spawnChrome(opts: SpawnChromeOpts): SpawnedChrome {
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(opts.extraArgs ?? []),
    opts.targetUrl,
  ];
  const child = spawn(opts.binaryPath, args, {
    detached: false,
    stdio: ["ignore", "ignore", "pipe"],
  });
  return {
    child,
    port: opts.port,
    profileDir: opts.profileDir,
    whenReady: async (timeoutMs = 10_000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await fetch(`http://127.0.0.1:${opts.port}/json/version`);
          if (res.ok) return;
        } catch {
          /* not ready yet */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(
        `Chrome CDP did not become ready on port ${opts.port} within ${timeoutMs}ms`,
      );
    },
  };
}

/**
 * Make a per-handoff temp profile directory.
 * Caller is responsible for cleanup (rm -rf profileDir when done).
 */
export async function createHandoffProfileDir(token: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `husk-handoff-${token}-`));
}
