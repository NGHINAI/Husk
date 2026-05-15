import type { MethodContext } from "./methods.js";
import type { Snapshot } from "../snapshot/types.js";

export interface BatchVisitParams {
  urls: string[];
  extract?: { css: string };
}

export interface BatchVisitItem {
  url: string;
  ok: boolean;
  snapshot?: Snapshot;
  text?: string | null;
  error?: string;
}

/**
 * Fan-out fetch: spawn one session per URL (via SessionManager → engine pool),
 * navigate, optionally extract by CSS selector, close. All URLs proceed in
 * parallel via Promise.all; per-URL errors don't break the batch.
 *
 * Returns results in input URL order regardless of completion order.
 */
export async function batchVisit(
  ctx: MethodContext,
  params: BatchVisitParams
): Promise<BatchVisitItem[]> {
  return Promise.all(
    params.urls.map(async (url): Promise<BatchVisitItem> => {
      let sessionId: string | undefined;
      try {
        sessionId = await ctx.sessions.create();
        const session = ctx.sessions.get(sessionId);
        await session.goto(url);
        if (params.extract?.css) {
          const text = await session.extract({ css: params.extract.css });
          return { url, ok: true, text };
        }
        const snapshot = await session.snapshot({ mode: "terse" });
        return { url, ok: true, snapshot };
      } catch (e) {
        return { url, ok: false, error: (e as Error).message };
      } finally {
        if (sessionId !== undefined) {
          await ctx.sessions.close(sessionId).catch(() => { /* idempotent */ });
        }
      }
    })
  );
}
