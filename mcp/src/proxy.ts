import { TOOL_SURFACE, handleToolCall } from "./tool-surface.js";
import type { HuskRpcClient } from "./client.js";

/**
 * Minimal MCP protocol handler.
 *
 * Speaks newline-delimited JSON-RPC 2.0 over stdin/stdout. Implements:
 *   - initialize         → returns server info
 *   - tools/list         → returns TOOL_SURFACE
 *   - tools/call         → routes to handleToolCall
 *   - notifications/*    → silently ignored
 *
 * v0 only — no resources, prompts, or completions. Add as needed.
 */
export async function runMcpStdio(
  client: HuskRpcClient,
  options: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream } = {}
): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  let buffer = "";

  const send = (msg: unknown): void => {
    stdout.write(JSON.stringify(msg) + "\n");
  };

  const handle = async (req: { id?: unknown; method?: string; params?: Record<string, unknown> }) => {
    if (req.id === undefined) return; // notification — no response
    try {
      switch (req.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "husk-mcp", version: "0.0.0" },
            },
          });
          break;
        case "tools/list":
          send({ jsonrpc: "2.0", id: req.id, result: { tools: TOOL_SURFACE } });
          break;
        case "tools/call": {
          const { name, arguments: args } = (req.params ?? {}) as {
            name: string; arguments: Record<string, unknown>;
          };
          const result = await handleToolCall(client, name, args ?? {});
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result) }],
            },
          });
          break;
        }
        default:
          send({
            jsonrpc: "2.0", id: req.id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          });
      }
    } catch (e) {
      send({
        jsonrpc: "2.0", id: req.id,
        error: { code: -32603, message: (e as Error).message },
      });
    }
  };

  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        void handle(msg);
      } catch {
        // Drop malformed lines silently per MCP convention
      }
    }
  });

  await new Promise<void>((resolve) => stdin.on("end", () => resolve()));
}
