/**
 * JSON-RPC 2.0 + MCP type definitions used by the Husk MCP shim.
 *
 * MCP protocol version: 2024-11-05. Stdio transport is newline-delimited
 * JSON-RPC 2.0; each message is one JSON object on its own line.
 */

// ----- JSON-RPC 2.0 envelopes -----

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

// ----- MCP-specific shapes (subset we care about) -----

export interface McpTool {
  name: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema?: any;
}

export interface McpToolsListResult {
  tools: McpTool[];
  nextCursor?: string;
}

export interface McpToolCallParams {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arguments?: any;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}
