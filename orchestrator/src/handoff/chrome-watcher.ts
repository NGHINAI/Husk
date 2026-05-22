/**
 * chrome-watcher.ts
 *
 * CDP client wrapper for a spawned Chrome instance.
 *
 * Wraps a CdpLike client to expose:
 *   - Page.frameNavigated event stream (main-frame only, subframes filtered)
 *   - injectOverlayScript: Page.addScriptToEvaluateOnNewDocument
 *   - getAllCookies: Network.getAllCookies
 *
 * Use the `connectToChrome(port)` factory to produce a ready ChromeWatcher
 * that reuses the orchestrator's existing CdpClient pointed at Chrome's debug
 * port instead of lightpanda.
 */

export interface CdpLike {
  on(event: string, fn: (params: unknown) => void): void;
  off(event: string, fn: (params: unknown) => void): void;
  send(method: string, params?: unknown): Promise<unknown>;
  close(): Promise<void> | void;
}

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

type NavCallback = (url: string) => void;

/**
 * Wraps a CDP client connected to a spawned Chrome instance.
 *
 * Construct with a CdpLike (e.g. an existing CdpClient or the fake from
 * tests). Call `start()` to enable Page + Network domains and subscribe to
 * navigation events. Call `close()` to cleanly tear down.
 */
export class ChromeWatcher {
  private navHandlers = new Set<NavCallback>();
  private cdpNavHandler?: (params: unknown) => void;
  private closed = false;

  constructor(private cdp: CdpLike) {}

  /** Enable Page + Network domains and start listening for frame navigations. */
  async start(): Promise<void> {
    await this.cdp.send("Page.enable");
    await this.cdp.send("Network.enable");

    this.cdpNavHandler = (params: unknown) => {
      if (this.closed) return;
      const p = params as { frame?: { url?: string; parentId?: string } };
      // Main-frame only: parentId must be undefined / null / absent
      if (!p?.frame?.url) return;
      if (p.frame.parentId) return;
      for (const fn of this.navHandlers) {
        try {
          fn(p.frame.url);
        } catch {
          // Isolate — one bad listener must not block others
        }
      }
    };

    this.cdp.on("Page.frameNavigated", this.cdpNavHandler);
  }

  /**
   * Subscribe to main-frame navigation events.
   * Returns an unsubscribe function.
   */
  onNavigation(fn: NavCallback): () => void {
    this.navHandlers.add(fn);
    return () => this.navHandlers.delete(fn);
  }

  /**
   * Inject a JS script that runs at the start of every new document.
   * Uses Page.addScriptToEvaluateOnNewDocument so the script persists across
   * navigations until the watcher is closed.
   */
  async injectOverlayScript(source: string): Promise<void> {
    await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  /**
   * Retrieve all cookies from the Chrome session via Network.getAllCookies.
   */
  async getAllCookies(): Promise<CdpCookie[]> {
    const r = (await this.cdp.send("Network.getAllCookies")) as {
      cookies?: CdpCookie[];
    } | null;
    return r?.cookies ?? [];
  }

  /**
   * Tear down: unregister CDP event handlers, clear nav subscribers, close socket.
   * After close(), navigation events are no longer dispatched even if new
   * subscribers are added.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.cdpNavHandler) {
      this.cdp.off("Page.frameNavigated", this.cdpNavHandler);
      this.cdpNavHandler = undefined;
    }
    this.navHandlers.clear();
    await this.cdp.close();
  }
}

/**
 * Connect to a Chrome instance running with --remote-debugging-port=<port>.
 *
 * 1. Fetches http://127.0.0.1:<port>/json/list to discover the first page target.
 * 2. Opens the orchestrator's existing CdpClient to that target's WebSocket URL.
 * 3. Waits for the socket to open (CdpClient.ready).
 * 4. Constructs and starts a ChromeWatcher, then returns it.
 *
 * No new npm dependencies — reuses the same CdpClient that drives lightpanda.
 */
export async function connectToChrome(port: number): Promise<ChromeWatcher> {
  // Discover page targets via Chrome's DevTools list endpoint
  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!listRes.ok) {
    throw new Error(`Chrome /json/list failed: ${listRes.status}`);
  }
  const targets = (await listRes.json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
    url?: string;
  }>;

  // Pick the first 'page' target that has a WS debugger URL
  const pageTarget = targets.find(
    (t) => t.type === "page" && t.webSocketDebuggerUrl,
  );
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("Chrome has no page target with a WS debugger URL");
  }

  // Reuse the orchestrator's existing CdpClient — just point it at Chrome instead of lightpanda.
  // CdpClient(wsUrl) auto-opens the socket; await .ready before using.
  const { CdpClient } = await import("../engine/cdp-client.js");
  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.ready;

  const watcher = new ChromeWatcher(cdp as unknown as CdpLike);
  await watcher.start();
  return watcher;
}
