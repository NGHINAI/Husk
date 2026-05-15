import { JSONRPC_ERROR_CODES, toJsonRpcError } from "./errors.js";
import { METHODS, type MethodContext, type MethodName } from "./methods.js";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

function isValidEnvelope(req: unknown): req is JsonRpcRequest {
  if (!req || typeof req !== "object") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = req as any;
  if (r.jsonrpc !== "2.0") return false;
  if (typeof r.method !== "string") return false;
  return true;
}

/**
 * Dispatch a single JSON-RPC request. Always resolves with a JSON-RPC
 * response envelope; never throws. Method-handler errors are caught and
 * mapped via toJsonRpcError.
 */
export async function dispatch(req: unknown, ctx: MethodContext): Promise<JsonRpcResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id: JsonRpcId = (req as any)?.id ?? null;

  if (!isValidEnvelope(req)) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
        message: "Invalid JSON-RPC envelope: requires jsonrpc='2.0' and method:string",
      },
    };
  }

  const handler = METHODS[req.method as MethodName];
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: `Method not found: ${req.method}`,
      },
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (handler as any)(req.params ?? {}, ctx);
    return { jsonrpc: "2.0", id: req.id, result };
  } catch (err) {
    return { jsonrpc: "2.0", id: req.id, error: toJsonRpcError(err) };
  }
}
