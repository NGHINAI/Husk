import type { HuskRpcClient } from "./client.js";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_SURFACE: ToolSpec[] = [
  {
    name: "husk_create_session",
    description: "Husk — Create a new browser session. Returns { session_id }. Always call this first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "husk_goto",
    description: "Husk — Navigate the session to a URL.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session id from husk_create_session" },
        url: { type: "string", description: "Absolute URL" },
      },
      required: ["session_id", "url"],
    },
  },
  {
    name: "husk_snapshot",
    description: "Husk — Return a compressed accessibility-tree snapshot of the current page.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "husk_click",
    description: "Husk — Click an element by stable_id. Watchdog-protected: returns a rejection envelope with candidates if the element doesn't exist or fails sanity checks.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string", description: "Stable id from a snapshot" },
      },
      required: ["session_id", "stable_id"],
    },
  },
  {
    name: "husk_type",
    description: "Husk — Type into an element by stable_id. Watchdog-protected.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["session_id", "stable_id", "text"],
    },
  },
  {
    name: "husk_scroll",
    description: "Husk — Scroll the page or an element into view.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: ["string", "null"], description: "Element to scroll into view, or null for window scroll" },
        direction: { type: "string", enum: ["up", "down", "left", "right", "into_view"] },
        amount: { type: "number", description: "Pixels to scroll (ignored for into_view)" },
      },
      required: ["session_id", "direction", "amount"],
    },
  },
  {
    name: "husk_press_key",
    description: "Husk — Press a single key (Enter, Tab, Escape, ArrowUp/Down/Left/Right, Backspace, Space).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        key: { type: "string" },
      },
      required: ["session_id", "key"],
    },
  },
  {
    name: "husk_close_session",
    description: "Husk — Close a session and free resources.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "husk_version",
    description: "Husk — Return Husk MCP server version info.",
    inputSchema: { type: "object", properties: {} },
  },
];

const RPC_MAP: Record<string, string> = {
  husk_create_session: "create_session",
  husk_goto: "goto",
  husk_snapshot: "snapshot",
  husk_click: "click",
  husk_type: "type",
  husk_scroll: "scroll",
  husk_press_key: "press_key",
  husk_close_session: "close_session",
};

const VERSION = "0.0.0";

export async function handleToolCall(
  client: HuskRpcClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (toolName === "husk_version") {
    return { name: "husk-mcp", version: VERSION };
  }
  const method = RPC_MAP[toolName];
  if (!method) throw new Error(`Unknown tool: ${toolName}`);
  return await client.call(method, args);
}
