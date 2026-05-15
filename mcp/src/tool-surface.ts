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
    description: "Husk — Create a new browser session. Returns { session_id }. Pass `profile` to bind cookies. SAFE TO CALL IN PARALLEL: Husk pre-warms a pool of engine processes and scales up to the system's memory limit when many sessions are requested concurrently — you can return many tool_use blocks in one turn for fan-out tasks.",
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
    description: "Husk — Return a semantic-tree snapshot of the current page. CACHED: if a snapshot was captured within the last 500ms, returns it from cache. Pass `max_age_ms: 0` to force a fresh capture. Each husk_goto auto-captures the snapshot so the first call after navigation is almost always a cache hit.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        max_age_ms: { type: "number", description: "Cache TTL in milliseconds. Default 500. Pass 0 to force." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "husk_click",
    description: "Husk — Click an element by stable_id. Watchdog-protected. The result INCLUDES a `diff` field showing what changed in the page after the action ({added, removed, changed} nodes), so you typically don't need a separate snapshot after a click. For login forms specifically, use husk_login instead — many engines don't reliably handle programmatic clicks on form submit buttons.",
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
    description: "Husk — Type into a text field by stable_id. Watchdog-protected. Result includes a `diff` field showing what changed after typing. IMPORTANT: This tool does NOT work for password inputs on the bundled lightpanda engine (the AX tree assigns role=none to <input type=password>). For ANY login flow (username + password + submit), use `husk_login` instead — it handles the engine quirks and submits the form correctly.",
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
    description: "Husk — Scroll the page or an element into view. Result includes a `diff` field showing what's now visible.",
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
    description: "Husk — Press a single key (Enter, Tab, Escape, ArrowUp/Down/Left/Right, Backspace, Space). Result includes a `diff` field showing what changed after the keypress.",
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
    description: "Husk — Log into a website. THIS IS THE TOOL TO USE FOR ANY LOGIN FORM. It locates username/password/submit fields, fills them, submits the form, and verifies. Two modes: (A) inline — pass {username, password, totp_secret?} directly (ephemeral, not stored); (B) lookup — pass {profile, key} to read previously-stored credentials. Use mode A when the user gives you credentials in chat; mode B when reusing saved ones. Returns { ok, url_before, url_after } on success or { ok: false, reason } on failure. Prefer this over husk_type/husk_click for login flows — those fail on password fields with the bundled engine.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        username: { type: "string", description: "Mode A: inline username (won't be stored)" },
        password: { type: "string", description: "Mode A: inline password (won't be stored)" },
        totp_secret: { type: "string", description: "Mode A: optional base32 TOTP secret for 2FA" },
        profile: { type: "string", description: "Mode B: credential profile name (used with `key`)" },
        key: { type: "string", description: "Mode B: credential key, typically a hostname (used with `profile`)" },
      },
      required: ["session_id"],
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
  {
    name: "husk_snapshot_diff",
    description: "Husk — Return the {added, removed, changed} diff against the previous snapshot in this session. Much cheaper than husk_snapshot when you just need to know what changed after an action. Returns null on the first call (no prior snapshot to compare against).",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "husk_extract",
    description: "Husk — Extract text from the current page by CSS selector. Runs document.querySelector and returns the matched element's textContent (trimmed), or null if no match. MUCH cheaper than husk_snapshot when you know what you want — ~100ms and a few hundred bytes vs ~1.5s and ~10-50KB. Use this after husk_goto when you need a specific value from the page.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        css: { type: "string", description: "CSS selector. The first matching element's textContent is returned." },
      },
      required: ["session_id", "css"],
    },
  },
  {
    name: "husk_batch_visit",
    description: "Husk — Visit MANY URLs in parallel and return results as one array. THE RIGHT TOOL FOR ANY LIST OF URLS YOU NEED TO PROCESS — instead of calling husk_goto + husk_snapshot 50 times sequentially, call husk_batch_visit once with all 50 URLs. Husk fans out across its engine pool automatically (~5-50 parallel sessions based on available memory). Pass `extract: { css: '...' }` to get JUST the matched text per URL (much smaller payload than full snapshots). Without extract, returns a terse snapshot per URL. Per-URL errors are isolated (one bad URL doesn't break the rest). Results array preserves input URL order.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "URLs to visit in parallel.",
        },
        extract: {
          type: "object",
          description: "Optional: instead of returning a full snapshot per URL, run document.querySelector(css).textContent and return just that string. Massively reduces token cost for batch reads.",
          properties: { css: { type: "string" } },
          required: ["css"],
        },
      },
      required: ["urls"],
    },
  },
];

const RPC_MAP: Record<string, string> = {
  husk_create_session: "create_session",
  husk_goto: "goto",
  husk_snapshot: "snapshot",
  husk_snapshot_diff: "snapshot_diff",
  husk_click: "click",
  husk_type: "type",
  husk_scroll: "scroll",
  husk_press_key: "press_key",
  husk_close_session: "close_session",
  husk_vault_list_profiles: "vault_list_profiles",
  husk_vault_clear: "vault_clear",
  husk_login: "login",
  husk_credentials_set: "credentials_set",
  husk_extract: "extract",
  husk_batch_visit: "batch_visit",
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
