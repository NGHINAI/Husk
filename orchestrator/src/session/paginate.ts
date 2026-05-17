import type { WaitForCondition } from "./wait.js";

export interface PaginateOpts {
  next: { stable_id?: string; intent?: string };
  max_pages?: number;
  stop_when?: WaitForCondition;
}

export type StoppedReason = "max_pages" | "stop_when" | "next_disappeared" | "click_failed";

export interface PaginateResult<T = unknown> {
  pages: T[];
  total_pages: number;
  stopped_reason: StoppedReason;
}

interface PaginateSessionLike<T> {
  extractOnce(): Promise<T>;
  click(target: { stable_id?: string; intent?: string }): Promise<{ ok: boolean }>;
  waitFor(c: WaitForCondition): Promise<{ ok: boolean }>;
}

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_SETTLE: WaitForCondition = { network_idle: 300, timeout_ms: 5000 };

export async function runPaginate<T>(
  s: PaginateSessionLike<T>,
  opts: PaginateOpts
): Promise<PaginateResult<T>> {
  const max = opts.max_pages ?? DEFAULT_MAX_PAGES;
  const pages: T[] = [];

  if (max <= 0) {
    return { pages, total_pages: 0, stopped_reason: "max_pages" };
  }

  for (let i = 0; i < max; i++) {
    pages.push(await s.extractOnce());

    if (i === max - 1) {
      // Reached max_pages — done
      return { pages, total_pages: pages.length, stopped_reason: "max_pages" };
    }

    // Click the next-page element
    const clicked = await s.click(opts.next);
    if (!clicked.ok) {
      return { pages, total_pages: pages.length, stopped_reason: "next_disappeared" };
    }

    // After clicking, either check the stop_when condition (which also acts as a
    // settle check), or do a default network-idle settle if no stop_when is given.
    if (opts.stop_when) {
      const stop = await s.waitFor({ ...opts.stop_when, timeout_ms: 100 });
      if (stop.ok) {
        // stop_when matched — the pages extracted so far are the result.
        return { pages, total_pages: pages.length, stopped_reason: "stop_when" };
      }
    } else {
      // No stop_when: settle with a default network-idle wait.
      await s.waitFor(DEFAULT_SETTLE);
    }
  }

  return { pages, total_pages: pages.length, stopped_reason: "max_pages" };
}
