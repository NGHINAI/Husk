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
    description: "Husk — Create a new browser session. Returns { session_id }. Pass `profile` to bind the session to a named cookie vault (cookies persist across sessions).",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", description: "Optional profile name to restore cookies from" },
      },
    },
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
    name: "husk_vault_list_profiles",
    description: "Husk — List all named profiles in the cookie vault.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "husk_vault_clear",
    description: "Husk — Clear every cookie stored for a profile.",
    inputSchema: {
      type: "object",
      properties: { profile: { type: "string" } },
      required: ["profile"],
    },
  },
  {
    name: "husk_version",
    description: "Husk — Return Husk MCP server version info.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "husk_login",
    description: "Husk — Log into a website using stored credentials. Reads username/password (and optional TOTP secret) from the credentials store for the given profile + key. Returns { ok, url_before, url_after } on success or { ok: false, reason } on failure.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        profile: { type: "string", description: "Credential profile name" },
        key: { type: "string", description: "Credential key (typically a hostname)" },
      },
      required: ["session_id", "profile", "key"],
    },
  },
  {
    name: "husk_credentials_set",
    description: "Husk — Store a credential (username + password, optionally totp_secret) under a profile + key. The credentials store is AES-encrypted if HUSK_VAULT_KEY is set.",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string" },
        key: { type: "string" },
        username: { type: "string" },
        password: { type: "string" },
        totp_secret: { type: "string", description: "Base32-encoded TOTP secret for 2FA-protected sites" },
      },
      required: ["profile", "key", "username", "password"],
    },
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
  husk_vault_list_profiles: "vault_list_profiles",
  husk_vault_clear: "vault_clear",
  husk_login: "login",
  husk_credentials_set: "credentials_set",
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
