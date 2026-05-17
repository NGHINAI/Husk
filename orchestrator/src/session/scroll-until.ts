import { runWaitFor, type WaitForCondition } from "./wait.js";

export interface ScrollUntilOpts {
  until: WaitForCondition;
  max_scrolls?: number;
  scroll_amount_px?: number;
}

export interface ScrollUntilResult {
  ok: boolean;
  scrolls: number;
  condition_met?: "text" | "role_name" | "url_matches" | "network_idle" | "selector_visible";
  reason?: "max_scrolls";
}

interface ScrollSessionLike {
  snapshot(opts?: { force?: boolean }): Promise<{ url: string; nodes: Array<{ i: string; r: string; n: string }> }>;
  runtimeEval(expr: string): Promise<unknown>;
  scroll(target: null, direction: "down", amount: number): Promise<unknown>;
}

const DEFAULT_MAX_SCROLLS = 20;
const DEFAULT_AMOUNT_PX = 800;

export async function runScrollUntil(s: ScrollSessionLike, opts: ScrollUntilOpts): Promise<ScrollUntilResult> {
  if (!opts.until) throw new Error("husk_scroll requires `until` when used in scroll-until mode");
  const max = opts.max_scrolls ?? DEFAULT_MAX_SCROLLS;
  const amount = opts.scroll_amount_px ?? DEFAULT_AMOUNT_PX;
  let scrolls = 0;

  // Check before first scroll — condition might already be true.
  // Loop: check condition, if not met scroll and increment, stop at max.
  while (true) {
    const wait = await runWaitFor(
      { snapshot: (o) => s.snapshot(o), runtimeEval: (e) => s.runtimeEval(e) },
      { ...opts.until, timeout_ms: 50 },
    );
    if (wait.ok) {
      return {
        ok: true,
        scrolls,
        condition_met: wait.condition_met,
      };
    }
    if (scrolls >= max) {
      return { ok: false, scrolls, reason: "max_scrolls" };
    }
    await s.scroll(null, "down", amount);
    scrolls++;
  }
}
