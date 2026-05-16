export interface CdpLike {
  on(event: string, fn: (p: unknown) => void): void;
  off(event: string, fn: (p: unknown) => void): void;
  /** Optional: return current number of in-flight network requests (used in tests). */
  inflightCount?(): number;
}

export interface PageReadyOpts {
  /** How long (ms) with zero in-flight requests after load to consider idle. Default: 500. */
  networkIdleMs?: number;
  /** Hard cap (ms) before giving up waiting. Default: 8000. */
  maxWaitMs?: number;
}

export interface PageReadyResult {
  ok: true;
  reason: "network_idle" | "max_wait";
  waitedMs: number;
}

/**
 * Wait for the page to reach a "ready" state.
 *
 * Resolution order:
 *   1. Page.loadEventFired fires AND in-flight network requests drop to zero
 *      for `networkIdleMs` continuous milliseconds → resolves "network_idle".
 *   2. `maxWaitMs` elapses regardless → resolves "max_wait".
 *
 * The CDP client must have had `Page.enable` and `Network.enable` sent before
 * this function is called; otherwise the events will never arrive and the
 * function will fall through to the "max_wait" path.
 */
export async function waitForPageReady(
  cdp: CdpLike,
  opts: PageReadyOpts = {}
): Promise<PageReadyResult> {
  const networkIdleMs = opts.networkIdleMs ?? 500;
  const maxWaitMs = opts.maxWaitMs ?? 8000;
  const start = Date.now();

  // Seed in-flight count from current state if the cdp object supports it.
  // This handles the case where requests were already in-flight before the
  // listener was registered (common in tests and in re-entrant call sites).
  let inflight = cdp.inflightCount?.() ?? 0;
  // Treat any pre-existing in-flight requests as evidence that a navigation
  // has started (i.e. Page.loadEventFired may have already fired before we
  // registered our listener). This lets the idle-window logic work correctly
  // when waitForPageReady is called after navigation has begun.
  let loadFired = inflight > 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<PageReadyResult>((resolve) => {
    let settled = false;

    const finish = (reason: "network_idle" | "max_wait") => {
      if (settled) return;
      settled = true;
      cdp.off("Network.requestWillBeSent", onReqStart);
      cdp.off("Network.loadingFinished", onReqEnd);
      cdp.off("Network.loadingFailed", onReqEnd);
      cdp.off("Page.loadEventFired", onLoad);
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(hardCap);
      resolve({ ok: true, reason, waitedMs: Date.now() - start });
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (loadFired && inflight === 0) {
        idleTimer = setTimeout(() => finish("network_idle"), networkIdleMs);
      }
    };

    const onReqStart = () => {
      inflight++;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const onReqEnd = () => {
      inflight = Math.max(0, inflight - 1);
      armIdle();
    };

    const onLoad = () => {
      loadFired = true;
      armIdle();
    };

    cdp.on("Network.requestWillBeSent", onReqStart);
    cdp.on("Network.loadingFinished", onReqEnd);
    cdp.on("Network.loadingFailed", onReqEnd);
    cdp.on("Page.loadEventFired", onLoad);

    const hardCap = setTimeout(() => finish("max_wait"), maxWaitMs);
  });
}
