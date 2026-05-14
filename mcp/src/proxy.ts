import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  isToolsListResponse,
  isToolsCallRequest,
  rewriteToolsListResponse,
  rewriteToolsCallRequest,
} from "./transform.js";
import { isHuskNativeTool, callHuskNativeTool, type HuskNativeContext } from "./husk-tools.js";
import type { JsonRpcMessage, JsonRpcSuccessResponse } from "./types.js";

export interface ProxyOptions {
  /** Version string for the upstream lightpanda binary. Surfaced via husk_version. */
  lightpandaVersion: string;
  /** Optional logger for proxy-level events (errors, malformed input). Defaults to no-op. */
  log?: (line: string) => void;
}

/**
 * Run the Husk MCP proxy.
 *
 * Pipes JSON-RPC newline-delimited messages between an "agent" pair of
 * streams (the MCP client) and an "upstream" pair (the lightpanda mcp
 * subprocess), applying our transformations:
 *
 *   - tools/call requests with husk_* names → translated to upstream
 *   - tools/call requests with husk_version → handled locally
 *   - tools/list responses → rebranded with husk_* names + Husk-native tools appended
 *   - Everything else → pass-through
 *
 * Resolves when the agent input stream ends (EOF).
 */
export async function runProxy(
  agentIn: Readable,
  agentOut: Writable,
  upstreamIn: Writable,
  upstreamOut: Readable,
  opts: ProxyOptions
): Promise<void> {
  const log = opts.log ?? (() => {});
  const ctx: HuskNativeContext = { lightpandaVersion: opts.lightpandaVersion };

  // --- Agent → Upstream (or local) ---
  const agentRl = createInterface({ input: agentIn, crlfDelay: Infinity });
  const agentDone = new Promise<void>((resolve) => {
    agentRl.on("close", () => resolve());
  });

  agentRl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch (err) {
      log(`[husk-mcp] malformed agent message: ${(err as Error).message}`);
      return;
    }

    if (isToolsCallRequest(msg) && isHuskNativeTool(msg.params.name)) {
      // Husk-native tool: handle locally, never forward upstream.
      void callHuskNativeTool(msg.params.name, msg.params.arguments, ctx).then((result) => {
        const response: JsonRpcSuccessResponse = {
          jsonrpc: "2.0",
          id: msg.id,
          result,
        };
        agentOut.write(JSON.stringify(response) + "\n");
      });
      return;
    }

    if (isToolsCallRequest(msg)) {
      // Translate husk_* → upstream name, then forward.
      const rewritten = rewriteToolsCallRequest(msg);
      upstreamIn.write(JSON.stringify(rewritten) + "\n");
      return;
    }

    // Default: forward unchanged.
    upstreamIn.write(line + "\n");
  });

  // --- Upstream → Agent ---
  const upstreamRl = createInterface({ input: upstreamOut, crlfDelay: Infinity });
  upstreamRl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch (err) {
      log(`[husk-mcp] malformed upstream message: ${(err as Error).message}`);
      return;
    }

    if (isToolsListResponse(msg)) {
      const rewritten = rewriteToolsListResponse(msg);
      agentOut.write(JSON.stringify(rewritten) + "\n");
      return;
    }

    // Default: forward unchanged.
    agentOut.write(line + "\n");
  });

  await agentDone;
}
