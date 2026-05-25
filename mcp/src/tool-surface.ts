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
    description: "Husk — Create a new browser session. Returns {session_id, watch_url}. Pass `profile` to bind cookies. SAFE TO CALL IN PARALLEL: Husk pre-warms a pool of engine processes and scales up to the system's memory limit when many sessions are requested concurrently — you can return many tool_use blocks in one turn for fan-out tasks. IMPORTANT: when watch_url is non-null, on your VERY NEXT message to the user (before any further tool calls), include one sentence like \"Want to watch what I'm seeing? Open <watch_url>\" with the literal URL pasted in. This is the only way the user learns the live viewer exists — do not skip it, do not summarize it, do not paraphrase the URL. The URL opens a live view of the AX tree, your actions, and rejections; it is local-only (127.0.0.1, no network exposure).\n\nWHEN TO USE parent_session_id: To open another tab in the same browser context (shared cookies), pass {parent_session_id: existing_session_id}. The new session is a sibling — it has its own URL and JS state but shares the cookie profile, so authenticated state carries over. snapshot.sibling_sessions on every snapshot lists all tabs in the group. Use this for comparison shopping, multi-account workflows, or any task where two URLs share login state. husk_close_session on the root tears down the whole group; on a child, just closes that tab. NOTE: cookie sharing in v1 only works when the parent was created with an explicit `profile` name — if the parent has no profile, siblings get isolated cookie jars (lightpanda limitation).\n\nENGINE SELECTION (M17):\n- engine: \"auto\" (DEFAULT) — Husk tries lightpanda first (fast: ~10ms startup, ~50MB), then auto-falls-back to Chrome when the page can't render (BroadcastChannel-style polyfill gaps, empty AX on known-rich sites like LinkedIn/Gmail/Salesforce, hydration timeouts). Best general default for unknown sites.\n- engine: \"lightpanda\" — Force the fast headless engine. Use when you KNOW the site is server-rendered (Wikipedia, HN, simple checkouts). Saves the milliseconds spent on the page-health check.\n- engine: \"chrome\" — Force real Chrome (~1.5s spinup, ~500MB). Use when you KNOW you need full SPA compat from the start (skips the lightpanda-first round-trip). The user must have Chrome / Chromium / Brave / Edge / Arc installed.\n\nThe active engine appears on every snapshot.engine. If a fallback fired during goto, the response carries fellback_from + fallback_reasons. If the fallback failed (e.g., Chrome not installed), the response carries fallback_failed.{reason, attempted_reasons}.\n\nDefault to \"auto\" unless you have a specific reason to override.\n\nWHAT YOU GET: {session_id, watch_url}. (sibling_sessions is on each session's snapshot, not on the create_session response.)",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", description: "Optional profile name to restore cookies from" },
        parent_session_id: { type: "string", description: "Optional. To open a sibling tab in an existing tab group, pass the session_id of any session in the group. The new session shares the cookie profile but has independent URL/JS state." },
        engine: {
          type: "string",
          enum: ["lightpanda", "chrome", "auto"],
          description: "Engine selection. 'auto' (default) tries lightpanda first, falls back to Chrome on rendering failure. 'lightpanda' = fast headless only. 'chrome' = real Chrome only.",
        },
      },
    },
  },
  {
    name: "husk_goto",
    description: "Husk — Navigate the session to a URL.\n\nWHEN TO USE: Any navigation to a new page or URL change.\n\nWHAT YOU GET: {ok, snapshot?} — the `snapshot` field contains the FULL post-navigation page state (AX tree + signature + meta + forms + network + console + summary + session_history). DO NOT call husk_snapshot after husk_goto — this snapshot field already contains everything you need. Pass include_snapshot:false ONLY if you need to save tokens AND don't need the post-navigation state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session id from husk_create_session" },
        url: { type: "string", description: "Absolute URL" },
        include_snapshot: { type: "boolean", description: "Include post-navigation snapshot in result. Default true. Pass false to save tokens if you don't need the page state immediately." },
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
    description: "Husk — Click an element. STRONGLY PREFER {intent} (natural language like \"100PC Wings with Fries\" or \"sign in button\") over {stable_id} — intent is faster than re-snapshotting to find an id, and reads naturally from the user's request. Resolved via deterministic AX scoring (~1ms). DO NOT use husk_press_key as a substitute for clicking — keyboard-nav is unreliable on JS sites; always try husk_click({intent}) first. If the element name appeared in a recent snapshot, pass that name verbatim as the intent. On ambiguous intent (multiple matches within 0.05 score), returns {ok:false, reason:\"ambiguous_intent\", candidates:[{stable_id, role, name, score}]} — pick the right candidate by stable_id and retry. On no match, returns {ok:false, reason:\"no_match\"}. On disabled element, returns watchdog rejection {ok:false, reason:\"element_disabled\"} — tell the user the element is disabled rather than trying workarounds. Watchdog-protected. For login forms specifically, use husk_login instead.\n\nWHAT YOU GET: {ok, diff, warnings, snapshot} — the `snapshot` field contains the FULL post-click page state (AX tree + signature + meta + forms + network + console + summary + session_history). DO NOT call husk_snapshot after a successful click — this snapshot field already contains everything. Pass include_snapshot:false ONLY if you need to save tokens AND don't need the post-state.\n\nMODAL HANDLING: If the click opens a confirmation dialog (LinkedIn \"Add a note?\", Amazon \"Confirm order\", GitHub \"Delete repo\", Gmail \"Discard draft?\", GDPR consent banners, etc.), the response includes `opened_modal: { stable_id, role, title, buttons: [{stable_id, name}] }`. Your action is NOT complete — the page is waiting for a confirmation click inside that dialog.\n\nWhat to do: pick the right button from `opened_modal.buttons` (usually \"Send\", \"Confirm\", \"OK\", \"Yes\", or whatever the primary action is for your goal — NOT \"Cancel\" / \"Back\" / \"Discard\") and call husk_click with that button's stable_id. Then check the next response — sometimes one modal opens another.\n\nDO NOT treat a click with `opened_modal` set as complete. The connection request / payment / deletion / submission DID NOT GO THROUGH yet. The modal is sitting there waiting. If you skip the confirmation, the page eventually closes the modal without committing your action.\n\n`no_mutation_observed` warning + `opened_modal` set is a strong signal: the click landed on a button that triggers a confirmation modal, not an instant action.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string", description: "Exact stable id from a snapshot. Use this when you have the id." },
        intent: { type: "string", description: "Natural language description of the element to click, e.g. \"sign in button\" or \"submit form\". Resolved via deterministic AX scoring. Pass either stable_id or intent, not both." },
        include_snapshot: { type: "boolean", description: "Include post-action snapshot in result. Default true. Pass false to save tokens if you don't need the page state after clicking." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "husk_type",
    description: "Husk — Type into a text field. STRONGLY PREFER {intent} (e.g. \"search box\", \"email field\") over {stable_id}. Resolved via deterministic AX scoring; passes the snapshot field name verbatim if it appeared in a snapshot. On ambiguous/unresolved intent, returns {ok:false, reason:\"ambiguous_intent\"|\"no_match\", candidates:[...]}. Requires `text`. Watchdog-protected. IMPORTANT: does NOT work for password inputs on the bundled lightpanda engine — for ANY login flow (username + password + submit), use `husk_login` instead.\n\nWHAT YOU GET: {ok, diff, warnings, snapshot} — the `snapshot` field contains the FULL post-type page state (AX tree + signature + meta + forms + network + console + summary + session_history). DO NOT call husk_snapshot after typing — this snapshot field already contains everything. Pass include_snapshot:false ONLY if you need to save tokens AND don't need the post-state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string", description: "Exact stable id from a snapshot. Pass either stable_id or intent." },
        intent: { type: "string", description: "Natural language description of the field, e.g. \"email textbox\". Pass either stable_id or intent." },
        text: { type: "string", description: "Text to type into the field" },
        include_snapshot: { type: "boolean", description: "Include post-action snapshot in result. Default true. Pass false to save tokens if you don't need the page state after typing." },
      },
      required: ["session_id", "text"],
    },
  },
  {
    name: "husk_scroll",
    description: "husk_scroll — Scroll the page or an element.\n\nWHEN TO USE:\n- Pass `{until: <condition>}` to scroll until a condition is met. This is the modern AI use case — scroll an infinite feed (Twitter, Reddit, etc.) until \"Load more\" appears, or until network goes idle, or until a specific element becomes visible. Each call does up to max_scrolls (default 20) viewport-height scrolls and stops as soon as the condition is true.\n- Pass `{direction, amount}` for one-shot pixel-based scroll. Use this only when you know exactly how far to scroll.\n\nWHAT YOU GET: {ok, scrolls, condition_met?, reason?, snapshot}. With `until`, you also get the post-scroll snapshot — DO NOT call husk_snapshot after. Default include_snapshot:true.\n\nConditions (same set as husk_wait_for): {text, role+name, url_matches, network_idle, selector_visible}.\n\nDO NOT use a husk_scroll loop driven by your own polling — that's wasteful. The single husk_scroll({until: ...}) does the loop for you in one tool call.\n\nExample: husk_scroll({session_id, until: {text: \"Load more\"}, max_scrolls: 30}) — scrolls a feed until \"Load more\" appears, up to 30 viewports.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: ["string", "null"], description: "Element stable id to scroll into view, or null for window scroll. Pass either stable_id or intent." },
        intent: { type: "string", description: "Natural language description of the element to scroll, e.g. \"comments section\". Pass either stable_id or intent." },
        direction: { type: "string", enum: ["up", "down", "left", "right", "into_view"], description: "Scroll direction for pixel-based scroll. Defaults to \"down\" when `until` is provided." },
        amount: { type: "number", description: "Pixels to scroll per step (ignored for into_view). Defaults to 800 when `until` is provided." },
        until: {
          type: "object",
          description: "Condition to scroll until. When provided, husk_scroll loops internally (up to max_scrolls times) and stops when the condition is met. Same condition set as husk_wait_for.",
          properties: {
            text: { type: "string", description: "Substring to look for in any visible node name." },
            role: { type: "string", description: "Accessible role (used together with name)." },
            name: { type: "string", description: "Accessible name (used together with role)." },
            url_matches: { type: "string", description: "Regex matched against the current URL." },
            network_idle: { type: "number", description: "Milliseconds of zero in-flight network requests." },
            selector_visible: { type: "string", description: "CSS selector whose element must be visible." },
          },
        },
        max_scrolls: { type: "number", description: "Maximum number of scroll steps when `until` is provided. Default 20." },
        scroll_amount_px: { type: "number", description: "Pixels per scroll step when `until` is provided. Default 800." },
        include_snapshot: { type: "boolean", description: "Include post-action snapshot in result. Default true. Pass false to save tokens if you don't need the page state after scrolling." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "husk_press_key",
    description: "Husk — Press a single key (Enter, Tab, Escape, ArrowUp/Down/Left/Right, Backspace, Space).\n\nWHAT YOU GET: {ok, diff, warnings, snapshot} — the `snapshot` field contains the FULL post-keypress page state (AX tree + signature + meta + forms + network + console + summary + session_history). DO NOT call husk_snapshot after pressing a key — this snapshot field already contains everything. Pass include_snapshot:false ONLY if you need to save tokens AND don't need the post-state.\n\nMODAL HANDLING: Enter/Space can submit forms or trigger actions that open confirmation modals. If the response contains `opened_modal`, your action is NOT complete — follow the same confirmation flow as husk_click: pick the right button from `opened_modal.buttons` and call husk_click with its stable_id.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        key: { type: "string" },
        include_snapshot: { type: "boolean", description: "Include post-action snapshot in result. Default true. Pass false to save tokens if you don't need the page state after the keypress." },
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
    description: "Husk — Log into a website. THIS IS THE TOOL TO USE FOR ANY LOGIN FORM. ATTEMPT FIRST: Always try husk_login as your first move on a login form. It works on many sites even when you \"expect\" captcha — sites only trigger captcha on suspicious patterns. Pass through the credentials and observe the result.\n\nIt locates username/password/submit fields, fills them, submits the form, and verifies. Two modes: (A) inline — pass {username, password, totp_secret?} directly (ephemeral, not stored); (B) lookup — pass {profile, key} to read previously-stored credentials. Use mode A when the user gives you credentials in chat; mode B when reusing saved ones. Prefer this over husk_type/husk_click for login flows — those fail on password fields with the bundled engine.\n\nSELF-HEALING: If the automated login attempt fails because the site is bot-blocking (BroadcastChannel polyfill error, \"Ha habido un problema\" / \"try again\" error page, captcha challenge, login URL with no form), husk_login will INTERNALLY escalate to a seamless handoff — opening the user's real Chrome at the login URL so they complete login natively. The husk_login call may BLOCK for up to 10 minutes during this escalation. Just await the result.\n\nWhen self-healing fires, the response includes:\n  - ok: true (if escalation succeeded)\n  - escalated_via: \"seamless_handoff\"\n  - cookies_imported: N\n  - ms_paused: how long the escalation took\n  - escalation_reasons: which bot-block markers triggered the escalation\n  - engine_after: which engine the session is on now (often \"chrome\" after escalation, since lightpanda can't render the sites that bot-block in the first place)\n\nYour job is just to wait for the result. DO NOT call husk_handoff yourself after a login failure — husk_login handles it internally when bot-block is detected. The escalation only fires when bot-block markers are present; real credential failures (intact login form still on-page) return ok:false immediately without escalating.\n\nWHAT YOU GET: {ok, url_before, url_after, snapshot} on automated success; or {ok, escalated_via, cookies_imported, ms_paused, escalation_reasons, snapshot} on self-healed success; or {ok:false, reason} on genuine failure. The `snapshot` field contains the FULL post-login page state. DO NOT call husk_snapshot after login — this snapshot field already contains everything. Pass include_snapshot:false ONLY if you need to save tokens AND don't need the post-login state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        username: { type: "string", description: "Mode A: inline username (won't be stored)" },
        password: { type: "string", description: "Mode A: inline password (won't be stored)" },
        totp_secret: { type: "string", description: "Mode A: optional base32 TOTP secret for 2FA" },
        profile: { type: "string", description: "Mode B: credential profile name (used with `key`)" },
        key: { type: "string", description: "Mode B: credential key, typically a hostname (used with `profile`)" },
        include_snapshot: { type: "boolean", description: "Include post-login snapshot in result. Default true. Pass false to save tokens if you don't need the logged-in page state." },
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
    description: "husk_extract — Read text content from the page.\n\nWHEN TO USE:\n- {css}: single selector → returns string|null. Use when you need ONE field.\n- {selectors}: map of name→css → returns {name: text|null}. ONE round-trip per call. Use when you need multiple fields from one page.\n- {selectors OR css} + {paginate: {next: {intent|stable_id}, max_pages?: 10, stop_when?: <wait_for_condition>}}: extracts the same fields ACROSS multiple pages — clicks the `next` element between pages and waits for the next page to settle. ONE tool call replaces a 10-turn extract+click loop.\n\nWHAT YOU GET:\n- Single mode: string|null\n- Multi mode: {key: text|null}\n- Paginate mode: {pages: [results_per_page], total_pages, stopped_reason: \"max_pages\"|\"stop_when\"|\"next_disappeared\"|\"click_failed\"}\n\nDO NOT manually loop extract + click — pass paginate instead.\n\nExample:\nhusk_extract({session_id, selectors: {title: \"h2.title\", price: \".price\"}, paginate: {next: {intent: \"Next page\"}, max_pages: 5}})\n→ returns all titles+prices across up to 5 pages in one call.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        css: { type: "string", description: "Mode A: CSS selector (single-selector mode). The first matching element's textContent is returned." },
        selectors: { type: "object", additionalProperties: { type: "string" }, description: "Mode B: Map of key to CSS selector (multi-selector mode). Returns {key: text|null}." },
        paginate: {
          type: "object",
          description: "Mode C: Paginate across multiple pages. Clicks `next` between each extract and waits for the page to settle. Returns {pages, total_pages, stopped_reason}.",
          properties: {
            next: {
              type: "object",
              description: "Target for the next-page element. Pass either {intent} (natural language) or {stable_id} (exact id from snapshot).",
              properties: {
                intent: { type: "string", description: "Natural language description of the next-page button, e.g. \"Next page\"." },
                stable_id: { type: "string", description: "Exact stable id of the next-page element from a snapshot." },
              },
            },
            max_pages: { type: "number", description: "Maximum number of pages to collect. Default 10." },
            stop_when: {
              type: "object",
              description: "Optional condition to stop pagination early (same set as husk_wait_for). Checked after each click.",
              properties: {
                text: { type: "string" },
                role: { type: "string" },
                name: { type: "string" },
                url_matches: { type: "string" },
                network_idle: { type: "number" },
                selector_visible: { type: "string" },
                timeout_ms: { type: "number" },
              },
            },
          },
          required: ["next"],
        },
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
    description: "Upload a file to a <input type=\"file\"> element. Pass EITHER {stable_id} OR {intent} to target the input. File contents come from EITHER {file_path} (absolute or relative path) OR {content_base64, filename}. Routes through the watchdog (rejects if the element isn't found or is disabled).\n\nWHAT YOU GET: {ok, reason?, candidates?, snapshot} — the `snapshot` field contains the FULL post-upload page state (AX tree + signature + meta + forms + network + console + summary + session_history). DO NOT call husk_snapshot after uploading — this snapshot field already contains everything. Pass include_snapshot:false ONLY if you need to save tokens AND don't need the post-state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        stable_id: { type: "string" },
        intent: { type: "string" },
        file_path: { type: "string" },
        content_base64: { type: "string" },
        filename: { type: "string" },
        include_snapshot: { type: "boolean", description: "Include post-action snapshot in result. Default true. Pass false to save tokens if you don't need the page state after uploading." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "husk_subscribe",
    description: `husk_subscribe — Subscribe to events from a session or site.

Returns { subscription_id, stream_url }. Agent opens SSE at <orchestrator>/stream/cognition?subscription_id=... to receive events. SDK wraps this; MCP-only consumers must open the SSE stream themselves.

EVENT TYPES:
- state_change — fires when current page state transitions (cognition layer)
- network_idle — fires after the page has been quiet for debounce_ms (default 500)
- error_appeared — banner/console/dialog error detected
- captcha_detected — captcha or bot-challenge markers spotted
- user_intervention_required — session paused for ask_human or handoff

FILTERS:
- session_id (use "*" for all sessions)
- site (hostname)
- debounce_ms (per-subscription coalescing window)

Example:
husk_subscribe({event_type: "state_change", session_id: "abc", debounce_ms: 200})
→ {subscription_id: "...", stream_url: "/stream/cognition?subscription_id=..."}
`,
    inputSchema: {
      type: "object",
      required: ["event_type"],
      properties: {
        event_type: { type: "string", enum: ["state_change", "network_idle", "error_appeared", "captcha_detected", "user_intervention_required"] },
        session_id: { type: "string" },
        site: { type: "string" },
        debounce_ms: { type: "integer", minimum: 0 },
      },
    },
  },
  {
    name: "husk_ask_human",
    description: "husk_ask_human — Ask the human a question (non-blocking; broadcasts to chat AND the Watch UI).\n\nWHEN TO USE: When you genuinely need a human decision — multiple matches with no clear winner, missing context the user has but you don't (which receipt? which address?), confirmation before a destructive action. NOT for things you can figure out yourself.\n\nWHAT YOU GET: Returns IMMEDIATELY with {pending: true, token, watch_url, surface: {question, options?}}. Your job: take the `surface` fields and ask the user in your NEXT chat message naturally. The Watch UI also shows the question with answer buttons. Whichever surface answers first wins.\n\nAFTER THE USER ANSWERS:\n- If they answer in CHAT: you already have the answer — just proceed with it. Optional: call husk_resume({token, answer}) to record it in session_history for audit.\n- If they answer in the WATCH UI: their answer is recorded server-side. You can pick it up in the next snapshot's session_history if you need to.\n\nDO NOT: Use as a fallback for 'I'm confused' — try harder first. Every question costs the user attention. Don't ask consecutively when one question covers it.\n\nParams: session_id (string), question (string — write it as you'd say it), options? (string[] — for multiple choice; omit for free-form text), timeout_ms? (default 300000).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        question: { type: "string", description: "The question to ask the human." },
        options: { type: "array", items: { type: "string" }, description: "Optional multiple-choice options. If present, Watch UI shows buttons; omit for free-form textarea." },
        timeout_ms: { type: "number", description: "How long to keep the question alive server-side. Default 300000 (5 min)." },
      },
      required: ["session_id", "question"],
    },
  },
  {
    name: "husk_handoff",
    description: "husk_handoff — Pause the session and ask the human to take over (non-blocking; works for ANY case where a human is needed).\n\nORDER OF OPERATIONS — try automation FIRST: 1) For login flows, call husk_login first with the user's credentials. 2) For other actions, attempt them with husk_click / husk_type / husk_scroll first. 3) ONLY call husk_handoff when automation has actually failed — husk_login returned ok:false with a captcha/2FA-style reason, click was rejected as 'engine_unsupported', or repeated retries hit the same wall. Do NOT default to handoff just because a site is \"known\" to have captchas — many flows complete without one. Try automation, observe the actual failure, THEN escalate.\n\nDO NOT refuse a task or recommend a different tool when you hit an engine wall, an auth requirement, a captcha, 2FA, OAuth consent, payment confirmation, or any case where a human action is needed. Those are EXACTLY what this tool is for. NEVER say \"I can't do this on this engine\" or \"use a different tool like Claude in Chrome\" — instead, call husk_handoff so the user can complete the action in their own browser. Refusing the task or deferring to another tool is a failure mode.\n\nWHEN TO USE: When you cannot proceed without a human action. Examples: captcha challenge, 2FA email/SMS code, OAuth consent screen, account verification, destructive-action approval, identity (KYC) check, connecting an external account (Plaid/Stripe/Google), payment confirmation, unrecoverable engine error. The watchdog has rejected or the page is asking for something only a human can provide.\n\nSEAMLESS MODE (recommended for sites with login walls — LinkedIn, Gmail, GitHub, anything with HttpOnly cookies): pass mode:\"seamless\" + need_cookies_back:true + target_url:\"https://...\". Husk launches the user's real Chrome at that URL with CDP enabled. The user logs in normally (captcha, 2FA, OAuth — all just work natively in their Chrome). The moment Chrome navigates past the login page, Husk pulls the session cookies back into your session automatically. The tool call BLOCKS until completion or timeout (default 10 min) — when it returns ok:true, you're authenticated; just retry the action you wanted to do. Return shape: {ok, mode:\"seamless\", cookies_imported, ms_paused, reason?:\"timeout\"|\"chrome_not_found\"}.\n\nPASTE MODE (fallback): the original M15 paste flow — returns {pending, token, handoff_url, surface} immediately and the user pastes cookies via bookmarklet/devtools. Use only when seamless isn't available (Chrome not installed, orchestrator not on 127.0.0.1, or user explicitly requests).\n\nDEFAULT MODE: seamless when need_cookies_back:true and Husk is on 127.0.0.1; paste otherwise.\n\nIf mode:\"seamless\" returns {reason:\"chrome_not_found\"}, Chrome isn't installed on the user's machine — re-call with mode:\"paste\" as the fallback.\n\nWHAT YOU GET (paste mode): Returns IMMEDIATELY with {pending: true, token, handoff_url, surface: {reason, suggested_action?, current_url?}}. The session is paused server-side — any further husk_* calls on it return {ok:false, reason:'session_paused'} until resumed. Your job: relay the situation to the user in your NEXT chat message. IMPORTANT: In your chat reply, tell the user to open the actual target URL in their browser (from surface.current_url), NOT just the handoff_url. Phrasing example: \"I hit a captcha at LinkedIn. Please open https://linkedin.com/login in your browser, log in normally, then come back to the handoff page and click the bookmarklet to send your cookies back.\" Surface the target URL FIRST and PROMINENTLY — the handoff page is a secondary step. The Watch UI ALSO shows a banner.\n\nWHILE PAUSED (paste mode): User can resume from EITHER surface — chat or Watch UI. From chat: when user says done, call husk_resume({token, note?}). From Watch UI: user clicks Resume, server-side handles it. Whichever fires first wins.\n\nCOOKIE TRANSFER: Pass need_cookies_back: true ONLY when the human's browser will earn cookies you need (captcha cookies, anti-bot tokens, third-party auth state). Default false — for 'approve this purchase' / 'is this the right address' / decision points, cookies aren't needed.\n\nAFTER RESUME: Your next husk_* call succeeds. Retry whatever was blocked.\n\nDO NOT: Use for routine questions — use husk_ask_human instead (doesn't pause the session).\n\nParams: session_id, reason (short, e.g. 'captcha', '2FA required', 'needs human credential'), suggested_action? (longer prose for the user), need_cookies_back? (default false), mode? (\"seamless\"|\"paste\"), target_url? (URL for seamless mode), timeout_ms? (default 600000).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        reason: { type: "string", description: "Short label for why a human is needed. Surfaces to the user in the Watch UI banner." },
        suggested_action: { type: "string", description: "Optional longer description of what you want the user to do." },
        need_cookies_back: { type: "boolean", description: "When true, the handoff page shows cookie-capture options (bookmarklet, paste). Default false." },
        mode: { type: "string", enum: ["seamless", "paste"], description: "Handoff style. \"seamless\" (default when need_cookies_back) spawns the user's real Chrome and blocks until login completes — cookies fly back automatically. \"paste\" returns immediately with a handoff URL; user pastes cookies via bookmarklet or devtools." },
        target_url: { type: "string", description: "URL the user's Chrome opens to in seamless mode. Defaults to the session's current URL." },
        timeout_ms: { type: "number", description: "How long the session stays paused before auto-resuming with timeout. Default 600000 (10 min)." },
      },
      required: ["session_id", "reason"],
    },
  },
  {
    name: "husk_resume",
    description: "husk_resume — Record a human answer or resume a paused handoff (use when the user replied in CHAT instead of the Watch UI).\n\nWHEN TO USE: After husk_ask_human or husk_handoff, if the user answered/completed the action via your chat conversation (not by clicking in the Watch UI), call this to tell Husk. If the user answered in the Watch UI, you don't need to call this — Husk already knows. Whichever surface fires first wins.\n\nWHAT YOU GET: {ok: true, kind: 'question'|'handoff'} on success; {ok: false, reason: 'unknown_token'} if the token expired or doesn't exist.\n\nFOR QUESTIONS: Pass token + answer (string the user said) or index (if you offered options). Optional but recommended — it logs the answer in session_history for audit, even though you already have it in chat.\n\nFOR HANDOFFS: Pass token + optional cookies (if you have any to import — usually no for chat-resumed handoffs since cookies need bookmarklet/devtools capture). Pass note for an audit trail. After this call, the session is unpaused and your next husk_* call succeeds.\n\nParams: token (from the original husk_ask_human or husk_handoff call), answer? (for questions), index? (for questions with options), cookies? (for handoffs), note? (for handoffs).",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string" },
        answer: { type: "string" },
        index: { type: "number" },
        cookies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string" },
              domain: { type: "string" },
              raw: { type: "string" },
            },
          },
        },
        note: { type: "string" },
      },
      required: ["token"],
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
  husk_subscribe: "subscribe",
  husk_ask_human: "ask_human",
  husk_handoff: "handoff",
  husk_resume: "resume",
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
