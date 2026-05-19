import type { Hono } from "hono";
import type { HumanIOBus } from "../hitl/bus.js";
import type { WatchBus } from "../watch/sse.js";
import { HANDOFF_HTML, bookmarkletFor } from "./handoff-page.html.js";

export interface HitlRoutesContext {
  humanIO: HumanIOBus;
  watchBus?: WatchBus;
  host?: string;
  portRef?: { value: number };
}

/**
 * Register HITL answer routes on the Hono app.
 *
 * POST /ask/:token/answer
 *   Body: { answer?: string; index?: number }
 *   Resolves the pending question identified by `token` in the HumanIOBus and
 *   emits a `resolved` event to the WatchBus so the Watch UI updates.
 *
 * GET /handoff/:token
 *   Serves the handoff HTML page (with token/reason/bookmarklet substituted).
 *
 * POST /handoff/:token/resume
 *   Body: { cookies?: Array<{name, value, domain?}>; note?: string }
 *   Resolves the pending handoff, triggering importCookies + session.resume.
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

  app.get("/handoff/:token", (c) => {
    const token = c.req.param("token");
    const pending = ctx.humanIO.getHandoff(token);
    if (!pending) {
      return c.html("<h1>Handoff not found or already resolved</h1>", 404);
    }
    const host = ctx.host ?? "127.0.0.1";
    const port = ctx.portRef?.value ?? 7777;
    const origin = `http://${host}:${port}`;
    const html = HANDOFF_HTML
      .replace(/__TOKEN__/g, token)
      .replace("__REASON__", escapeHtml(pending.reason))
      .replace("__SUGGESTED__", escapeHtml(pending.suggested_action ?? "(no additional instructions)"))
      .replace(/__CURRENT_URL__/g, escapeHtml(pending.current_url ?? ""))
      .replace("__BOOKMARKLET__", bookmarkletFor(token, origin).replace(/'/g, "&#39;"));
    return c.html(html);
  });

  app.post("/handoff/:token/resume", async (c) => {
    const token = c.req.param("token");
    const pending = ctx.humanIO.getHandoff(token);
    if (!pending) {
      return c.json({ ok: false, error: "unknown_or_expired_token" }, 404);
    }
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const cookies = Array.isArray(body.cookies)
      ? (body.cookies as Array<{ name: string; value: string; domain?: string }>)
      : undefined;
    const note = typeof body.note === "string" ? body.note : undefined;
    ctx.humanIO.resumeHandoff(token, { cookies, note });
    return c.json({ ok: true });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c] ?? c
  ));
}
