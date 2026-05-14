import type {
  JsonRpcMessage,
  JsonRpcSuccessResponse,
  JsonRpcRequest,
  McpToolsListResult,
  McpToolCallParams,
  McpTool,
} from "./types.js";
import { huskNameOf, upstreamNameOf } from "./tool-map.js";
import { HUSK_NATIVE_TOOLS } from "./husk-tools.js";

/** Detect a JSON-RPC success response carrying an MCP `tools/list` result. */
export function isToolsListResponse(
  msg: unknown
): msg is JsonRpcSuccessResponse & { result: McpToolsListResult } {
  if (!msg || typeof msg !== "object") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any;
  return (
    m.jsonrpc === "2.0" &&
    "result" in m &&
    m.result &&
    typeof m.result === "object" &&
    Array.isArray((m.result as { tools?: unknown }).tools)
  );
}

/** Detect a JSON-RPC request invoking the MCP `tools/call` method. */
export function isToolsCallRequest(
  msg: unknown
): msg is JsonRpcRequest & { params: McpToolCallParams } {
  if (!msg || typeof msg !== "object") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any;
  return (
    m.jsonrpc === "2.0" &&
    m.method === "tools/call" &&
    m.params &&
    typeof m.params.name === "string"
  );
}

/**
 * Rewrite a tools/list response so that:
 *   1. Each upstream tool's `name` is replaced with its `husk_*` equivalent.
 *   2. Each tool's `description` is prepended with "Husk — ".
 *   3. Husk-native tools (from husk-tools.ts) are appended to the list.
 */
export function rewriteToolsListResponse(
  msg: JsonRpcSuccessResponse & { result: McpToolsListResult }
): JsonRpcSuccessResponse {
  const upstreamTools = (msg.result as McpToolsListResult).tools.map((t: McpTool) => rebrandTool(t));
  const tools: McpTool[] = [...upstreamTools, ...HUSK_NATIVE_TOOLS];
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...msg.result, tools },
  };
}

function rebrandTool(t: McpTool): McpTool {
  return {
    ...t,
    name: huskNameOf(t.name),
    description: t.description
      ? `Husk — ${t.description}`
      : `Husk — (no upstream description for ${t.name})`,
  };
}

/**
 * Rewrite a tools/call request so that the tool name reaches lightpanda
 * in its upstream form. If the agent supplied a husk_* name, translate
 * it. Otherwise pass through.
 *
 * Note: callers should detect Husk-native tool names (`isHuskNativeTool`)
 * BEFORE calling this — native tools must not be forwarded to lightpanda.
 */
export function rewriteToolsCallRequest(
  msg: JsonRpcRequest & { params: McpToolCallParams }
): JsonRpcRequest & { params: McpToolCallParams } {
  const upstreamName = upstreamNameOf(msg.params.name);
  return {
    ...msg,
    params: { ...msg.params, name: upstreamName },
  };
}

// Re-export for callers that want to know the union type at the call site.
export type { JsonRpcMessage };
