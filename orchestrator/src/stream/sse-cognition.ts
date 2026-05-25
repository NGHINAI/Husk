import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { CognitionBus } from "../cognition/cognition-bus.js";

/**
 * Hono handler for GET /stream/cognition?subscription_id=<id>
 *
 * Looks up the subscription on the CognitionBus, replaces its handler with one
 * that writes SSE lines to the HTTP response, and keeps the stream alive until
 * the client disconnects.  On disconnect the subscription is removed from the
 * bus.
 */
export function handleCognitionSse(bus: CognitionBus, c: Context): Response {
  const subId = c.req.query("subscription_id");
  if (!subId) {
    return c.text("missing subscription_id", 400);
  }

  const subs = bus.listSubscriptions();
  if (!subs.find((s) => s.id === subId)) {
    return c.text("subscription not found", 404);
  }

  return streamSSE(c, async (stream) => {
    // Wire the bus handler to write SSE data frames.
    const ok = bus.setHandler(subId, (event) => {
      stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {
        // Stream closed — ignore write errors.
      });
    });

    if (!ok) {
      // Subscription disappeared between the lookup and setHandler (race).
      return;
    }

    // Keep the stream alive with comment-only keep-alive frames every 30s.
    // Using the stream pipe pattern: write raw keep-alive comments.
    let alive = true;
    const keepAlive = setInterval(() => {
      if (!alive) return;
      stream.write(": keep-alive\n\n").catch(() => {
        alive = false;
      });
    }, 30000);
    // Don't keep the process alive solely for keep-alive ticks.
    keepAlive.unref?.();

    // Hold the SSE stream open until the client disconnects.
    await new Promise<void>((resolve) => {
      // Hono/node-server surfaces client disconnect via the request's AbortSignal.
      c.req.raw.signal.addEventListener("abort", () => {
        alive = false;
        clearInterval(keepAlive);
        bus.unsubscribe(subId);
        resolve();
      });
    });
  });
}
