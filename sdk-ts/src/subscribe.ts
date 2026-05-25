import type { CognitionEvent, EventFilter, EventType, SubscribeHandle } from "./types.js";

/**
 * Minimal shape the subscribe helper needs from the client.
 * JsonRpcClient satisfies this via the `baseUrl` getter added in transport.ts.
 */
export interface SubscribeClient {
  call: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  baseUrl: string;
}

/**
 * Register a subscription on the orchestrator, open an SSE connection, and
 * invoke `onEvent` for each event received.
 *
 * Uses fetch + manual ReadableStream parsing (no `eventsource` dep). Targets Node 18+.
 *
 * @returns A handle whose `unsubscribe()` aborts the SSE stream and calls the
 *          server-side unsubscribe JSON-RPC method.
 */
export async function subscribe(
  client: SubscribeClient,
  eventType: EventType,
  filter: EventFilter,
  onEvent: (e: CognitionEvent) => void,
): Promise<SubscribeHandle> {
  const params: Record<string, unknown> = { event_type: eventType };
  if (filter.session_id !== undefined) params["session_id"] = filter.session_id;
  if (filter.site !== undefined) params["site"] = filter.site;
  if (filter.debounce_ms !== undefined) params["debounce_ms"] = filter.debounce_ms;

  const { subscription_id, stream_url } = await client.call<{
    subscription_id: string;
    stream_url: string;
  }>("subscribe", params);

  const url = new URL(stream_url, client.baseUrl).toString();
  const controller = new AbortController();

  // Start the SSE read loop — fire-and-forget; errors are swallowed unless not AbortError.
  const streamDone = (async () => {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        // eslint-disable-next-line no-console
        console.warn("husk subscribe: fetch failed:", err);
      }
      return;
    }
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`husk subscribe: SSE endpoint returned ${res.status}`);
      return;
    }
    const body = res.body;
    if (!body) {
      // eslint-disable-next-line no-console
      console.warn("husk subscribe: SSE response has no body");
      return;
    }

    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE blocks are delimited by double newlines.
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          for (const line of block.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                onEvent(JSON.parse(line.slice(6)) as CognitionEvent);
              } catch {
                // Ignore malformed JSON lines.
              }
            }
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        // eslint-disable-next-line no-console
        console.warn("husk subscribe stream ended unexpectedly:", err);
      }
    } finally {
      reader.releaseLock();
    }
  })();

  return {
    unsubscribe: async () => {
      controller.abort();
      // Wait for the stream loop to settle before calling the server.
      await streamDone.catch(() => {});
      try {
        await client.call("unsubscribe", { subscription_id });
      } catch {
        // Server may have already cleaned up — ignore.
      }
    },
  };
}
