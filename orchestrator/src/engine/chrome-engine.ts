/**
 * chrome-engine.ts
 *
 * ChromeEngine factory — spawns a Chrome-family browser as a full Husk session
 * engine. Returns a ChromeEngineHandle with the same surface as a lightpanda
 * engine handle so engine-router (T3) can treat both interchangeably.
 *
 * Key differences from M16's seamless-handoff Chrome:
 *  - Headless by default  (handoff is always headed — user needs to see it)
 *  - Profile dir is cleaned up by release()  (handoff leaves it for the user)
 *  - Always starts on about:blank; Session.create calls Page.navigate next
 */

import { rm } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import {
  findChrome,
  findFreePort,
  createHandoffProfileDir,
  spawnChrome,
} from "../handoff/chrome-launcher.js";
import { CdpClient } from "./cdp-client.js";

export interface ChromeEngineHandle {
  cdp: CdpClient;
  port: number;
  profileDir: string;
  child: ChildProcess;
  /** Kill the Chrome process. Leaves the profile dir on disk for inspection. */
  kill(): Promise<void>;
  /**
   * Kill the Chrome process AND delete the profile dir.
   * This is the standard end-of-session cleanup path.
   */
  release(): Promise<void>;
}

export interface ChromeEngineOpts {
  /**
   * Whether to spawn Chrome in headless mode.
   * Default: true  (engine use case — no visible window needed).
   * Set false for headed mode, e.g. during manual debugging sessions.
   */
  headless?: boolean;
}

const PROFILE_PREFIX = "engine";

/**
 * Spawn a Chrome instance configured as a Husk session engine.
 *
 * @param sessionId  Unique session identifier used to name the temp profile dir.
 * @param opts       Optional engine configuration (headless, etc.).
 * @returns          A ChromeEngineHandle ready for CDP commands.
 *
 * @throws {Error}   If no Chrome-family browser is found on this machine.
 * @throws {Error}   If Chrome's CDP endpoint does not become ready within 15 s.
 */
export async function spawnChromeEngine(
  sessionId: string,
  opts: ChromeEngineOpts = {},
): Promise<ChromeEngineHandle> {
  // --- 1. Locate binary ---------------------------------------------------
  const binary = findChrome();
  if (!binary) {
    throw new Error(
      "Chrome-family browser not found on this machine " +
        "(looked for Chrome/Chromium/Brave/Edge/Arc)",
    );
  }

  // --- 2. Allocate resources ----------------------------------------------
  const headless = opts.headless !== false; // default true
  const port = await findFreePort();
  const profileDir = await createHandoffProfileDir(`${PROFILE_PREFIX}-${sessionId}`);

  // --- 3. Spawn -----------------------------------------------------------
  const extraArgs = headless ? ["--headless=new"] : [];
  const spawned = spawnChrome({
    binaryPath: binary,
    targetUrl: "about:blank",
    profileDir,
    port,
    extraArgs,
  });

  // --- 4. Wait for CDP to be ready ----------------------------------------
  await spawned.whenReady(15_000);

  // --- 5. Discover the page target ----------------------------------------
  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!listRes.ok) {
    spawned.child.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Chrome /json/list failed: ${listRes.status}`);
  }
  const targets = (await listRes.json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    spawned.child.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      "Chrome has no page target with a WebSocket debugger URL",
    );
  }

  // --- 6. Connect CDP client ----------------------------------------------
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.ready;

  // --- 7. Build and return handle -----------------------------------------
  const killProcess = () => {
    try { spawned.child.kill(); } catch { /* already dead */ }
    void cdp.close().catch(() => {});
  };

  return {
    cdp,
    port,
    profileDir,
    child: spawned.child,

    kill: async () => {
      killProcess();
    },

    release: async () => {
      killProcess();
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
