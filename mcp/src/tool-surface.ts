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
    description: "Husk — Create a new browser session. Returns {session_id, watch_url}. Pass `profile` to bind cookies. SAFE TO CALL IN PARALLEL: Husk pre-warms a pool of engine processes and scales up to the system's memory limit when many sessions are requested concurrently — you can return many tool_use blocks in one turn for fan-out tasks. IMPORTANT: when watch_url is non-null, on your VERY NEXT message to the user (before any further tool calls), include one sentence like \"Want to watch what I'm seeing? Open <watch_url>\" with the literal URL pasted in. This is the only way the user learns the live viewer exists — do not skip it, do not summarize it, do not paraphrase the URL. The URL opens a live view of the AX tree, your actions, and rejections; it is local-only (127.0.0.1, no network exposure).",
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
    description: "husk_snapshot — Read the current page state.\n\nWHEN TO USE: Whenever you need fresh context — but note that click/type/scroll already return the post-action snapshot, so you usually don't need a separate call.\n\nWHAT YOU GET: {root, url, mode, signature, meta, forms, network, console, summary, session_history, image_b64?}. The snapshot is your one-stop context dump.\n\nModes: \"full\" (default; complete AX tree) | \"terse\" (drops nav/banner/footer subtrees; faster) | \"visible\" (only nodes whose bbox intersects the viewport; smallest payload, best for scrollable feeds).\n\nCACHED: if a snapshot was captured within the last 500ms, returns it from cache. Pass `max_age_ms: 0` to force a fresh capture. Each husk_goto auto-captures the snapshot so the first call after navigation is almost always a cache hit.\n\nDO NOT: Call husk_snapshot after a click/type/scroll — the action result already includes a `snapshot` field with the post-action state.\n\nPass `include_image: true` to attach a base64 PNG. Pass `max_age_ms` (default 500ms) to control cache freshness.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        max_age_ms: { type: "number", description: "Cache TTL in milliseconds. Default 500. Pass 0 to force." },
        mode: {
          type: "string",
          enum: ["full", "terse", "visible"],
          description: "Snapshot mode: \"full\" (default; complete AX tree), \"terse\" (drops nav/banner/footer subtrees), or \"visible\" (only nodes whose bbox intersects the viewport — smallest payload, best for long scrollable pages).",
        },
        include_image: { type: "boolean", description: "Attach a base64 PNG screenshot as `image_b64`. Forces a fresh capture (bypasses cache). Default false." },
        full_page: { type: "boolean", description: "When include_image is true, capture the full scrollable page rather than just the viewport. Default false." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "husk_click",
    description: "Husk — Click an element. STRONGLY PREFER {intent} (natural language like \"100PC Wings with Fries\" or \"sign in button\") over {stable_id} — intent is faster than re-snapshotting to find an id, and reads naturally from the user's request. Resolved via deterministic AX scoring (~1ms). DO NOT use husk_press_key as a substitute for clicking — keyboard-nav is unreliable on JS sites; always try husk_click({intent}) first. If the element name appeared in a recent snapshot, pass that name verbatim as the intent. On ambiguous intent (multiple matches within 0.05 score), returns {ok:false, reason:\"ambiguous_intent\", candidates:[{stable_id, role, name, score}]} — pick the right candidate by stable_id and retry. On no match, returns {ok:false, reason:\"no_match\"}. On disabled element, returns watchdog rejection {ok:false, reason:\"element_disabled\"} — tell the user the element is disabled rather than trying workarounds. Watchdog-protected. Result includes a `diff` field. For login forms specifically, use husk_login instead.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string", description: "Exact stable id from a snapshot. Use this when you have the id." },
        intent: { type: "string", description: "Natural language description of the element to click, e.g. \"sign in button\" or \"submit form\". Resolved via deterministic AX scoring. Pass either stable_id or intent, not both." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "husk_type",
    description: "Husk — Type into a text field. STRONGLY PREFER {intent} (e.g. \"search box\", \"email field\") over {stable_id}. Resolved via deterministic AX scoring; passes the snapshot field name verbatim if it appeared in a snapshot. On ambiguous/unresolved intent, returns {ok:false, reason:\"ambiguous_intent\"|\"no_match\", candidates:[...]}. Requires `text`. Watchdog-protected. Result includes a `diff` field. IMPORTANT: does NOT work for password inputs on the bundled lightpanda engine — for ANY login flow (username + password + submit), use `husk_login` instead.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string", description: "Exact stable id from a snapshot. Pass either stable_id or intent." },
        intent: { type: "string", description: "Natural language description of the field, e.g. \"email textbox\". Pass either stable_id or intent." },
        text: { type: "string", description: "Text to type into the field" },
      },
      required: ["session_id", "text"],
    },
  },
  {
    name: "husk_scroll",
    description: "Husk — Scroll the page or an element. Pass EITHER {stable_id} (exact, may be null for window scroll), {intent} (natural language like \"main content area\"), or omit both for a plain window scroll. On unresolved intent returns {ok:false, reason:\"no_match\"}. Result includes a `diff` field showing what's now visible.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: ["string", "null"], description: "Element stable id to scroll into view, or null for window scroll. Pass either stable_id or intent." },
        intent: { type: "string", description: "Natural language description of the element to scroll, e.g. \"comments section\". Pass either stable_id or intent." },
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
    description: "Husk — Extract text from the current page by CSS selector(s). EITHER pass {css} for a single selector (returns string|null), OR {selectors: {key: css, ...}} for multi-field extraction in ONE round-trip (returns {key: text|null}). Each selector is independently safe — one broken selector won't fail others. Use {selectors} when you need >1 field from a page; faster than N calls. ~100ms and a few hundred bytes vs ~1.5s and ~10-50KB for snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        css: { type: "string", description: "Mode A: CSS selector (single-selector mode). The first matching element's textContent is returned." },
        selectors: { type: "object", additionalProperties: { type: "string" }, description: "Mode B: Map of key to CSS selector (multi-selector mode). Returns {key: text|null}." },
      },
      required: ["session_id"],
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
  {
    name: "husk_wait_for",
    description: "Wait until a condition is true on the page. Conditions (pass at least one): text (substring in any visible node name), role+name (exact role + exact name), url_matches (regex against current URL), network_idle (ms of zero in-flight requests), selector_visible (CSS selector visible). Default timeout 10s. Returns {ok, condition_met, waited_ms, stable_id?}. Cheap to call — polls every 100ms locally.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        text: { type: "string" },
        role: { type: "string" },
        name: { type: "string" },
        url_matches: { type: "string" },
        network_idle: { type: "number" },
        selector_visible: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "husk_upload",
    description: "Upload a file to a <input type=\"file\"> element. Pass EITHER {stable_id} OR {intent} to target the input. File contents come from EITHER {file_path} (absolute or relative path) OR {content_base64, filename}. Routes through the watchdog (rejects if the element isn't found or is disabled). Returns {ok, reason?, candidates?}.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string" },
        intent: { type: "string" },
        file_path: { type: "string" },
        content_base64: { type: "string" },
        filename: { type: "string" },
      },
      required: ["session_id"],
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
  husk_wait_for: "wait_for",
  husk_upload: "upload",
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
