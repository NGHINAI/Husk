import type { Hono } from "hono";
import type { HumanIOBus } from "../hitl/bus.js";
import type { WatchBus } from "../watch/sse.js";

export interface HitlRoutesContext {
  humanIO: HumanIOBus;
  watchBus?: WatchBus;
}

/**
 * Register HITL answer routes on the Hono app.
 *
 * POST /ask/:token/answer
 *   Body: { answer?: string; index?: number }
 *   Resolves the pending question identified by `token` in the HumanIOBus and
 *   emits a `resolved` event to the WatchBus so the Watch UI updates.
 *
 * Only call this when the server is bound to 127.0.0.1 (loopback-only guard).
 */
export function registerHitlRoutes(app: Hono, ctx: HitlRoutesContext): void {
  app.post("/ask/:token/answer", async (c) => {
    const token = c.req.param("token");
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const answer = typeof body.answer === "string" ? body.answer : undefined;
    const index = typeof body.index === "number" ? body.index : undefined;

    const pending = ctx.humanIO.getQuestion(token);
    if (!pending) {
      return c.json({ ok: false, error: "unknown_or_expired_token" }, 404);
    }

    ctx.humanIO.answerQuestion(token, { answer, index });

    // Emit resolved event so Watch UI can clear the pending question widget.
    if (ctx.watchBus) {
      ctx.watchBus.emit(pending.session_id, {
        kind: "resolved",
        ts: Date.now(),
        token,
        kind_resolved: "question",
      });
    }

    return c.json({ ok: true });
  });
}
