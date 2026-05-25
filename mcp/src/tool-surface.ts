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

/** Narrow helper to extract stable_id / intent from the `target` discriminated union. */
function resolveTarget(target: unknown): { stable_id?: string; intent?: string } {
  if (target === null || target === undefined || typeof target !== "object") return {};
  const t = target as Record<string, unknown>;
  const out: { stable_id?: string; intent?: string } = {};
  if (typeof t.stable_id === "string") out.stable_id = t.stable_id;
  if (typeof t.intent === "string") out.intent = t.intent;
  return out;
}

export const TOOL_SURFACE: ToolSpec[] = [
  // ── 1. husk_session ─────────────────────────────────────────────────────
  {
    name: "husk_session",
    description: `husk_session — Create, navigate, authenticate, and close sessions.

ACTIONS:
- "create"          → start a new session. Optional: profile, parent_session_id, capability, engine, watch_url.
                      Returns { session_id, watch_url?, engine }.
                      SAFE TO CALL IN PARALLEL: Husk pre-warms a pool of engine processes — you can return many tool_use blocks in one turn for fan-out tasks.
                      When watch_url is non-null, on your VERY NEXT message to the user include: "Want to watch what I'm seeing? Open <watch_url>" with the literal URL pasted in.
- "close"           → close a session by session_id. Frees engine resources.
- "goto"            → navigate to a URL. Returns {ok, snapshot?} — the snapshot contains the full post-navigation page state. DO NOT call husk_inspect after husk_session({action:"goto"}) — the snapshot is already included.
- "login"           → log in to a site. Pass {username, password, totp_secret?} for inline login or {profile, key} to look up stored credentials. Uses stored creds when omitted (set via action="set_credentials").
- "set_credentials" → store username/password/TOTP for a site (encrypted vault). Params: site, username, password, totp_secret?.
- "list_profiles"   → list stored cookie-jar profile names.
- "clear_vault"     → delete a stored profile. Param: profile_name.

ENGINE SELECTION:
- engine: "auto" (DEFAULT) — tries lightpanda first (~10ms, ~50MB), falls back to Chrome on rendering failure.
- engine: "lightpanda" — force fast headless engine (server-rendered sites).
- engine: "chrome" — force real Chrome (~1.5s, ~500MB; needs Chrome/Chromium/Brave/Edge/Arc installed).

Each action takes the params it needs; unused fields are ignored.

Examples:
husk_session({action: "create", engine: "auto"})
husk_session({action: "goto", session_id, url: "https://x.com/"})
husk_session({action: "login", session_id, site: "linkedin.com"})
husk_session({action: "set_credentials", site: "linkedin.com", username: "...", password: "..."})
husk_session({action: "clear_vault", profile_name: "myprofile"})
`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["create", "close", "goto", "login", "set_credentials", "list_profiles", "clear_vault"],
          description: "The session operation to perform.",
        },
        session_id: { type: "string", description: "Required for: close, goto, login." },
        url: { type: "string", description: "For action=goto. Absolute URL." },
        profile_name: { type: "string", description: "For action=clear_vault. The profile to delete." },
        profile: { type: "string", description: "For action=create (restore cookies) or action=login (mode B lookup)." },
        parent_session_id: { type: "string", description: "For action=create. Open a sibling tab in an existing tab group." },
        capability: { type: "object", description: "For action=create. CapabilityRequirement for engine selection." },
        engine: {
          type: "string",
          enum: ["lightpanda", "chrome", "auto"],
          description: "For action=create. Engine selection. Default 'auto'.",
        },
        include_snapshot: { type: "boolean", description: "For action=goto or action=login. Include post-action snapshot. Default true." },
        site: { type: "string", description: "For action=set_credentials. Hostname/key for the credential entry." },
        username: { type: "string", description: "For action=set_credentials or action=login (inline mode)." },
        password: { type: "string", description: "For action=set_credentials or action=login (inline mode)." },
        totp_secret: { type: "string", description: "For action=set_credentials or action=login. Base32-encoded TOTP secret." },
        key: { type: "string", description: "For action=login (mode B). Credential key, typically hostname." },
      },
    },
  },

  // ── 2. husk_intend ───────────────────────────────────────────────────────
  {
    name: "husk_intend",
    description: `husk_intend — Single primitive for ALL page actions.

TWO USAGE MODES:

(1) Named intention (preferred — uses the per-site cognition layer):
   husk_intend({session_id, intention_name: "send_connect", args: {person: "..."}})
   → executes a YAML-defined intention; returns Outcome envelope with ok/evidence/reason

(2) Raw verb (for sites without intentions yet):
   husk_intend({session_id, verb: "click", target: {intent: "Sign in button"}})
   husk_intend({session_id, verb: "type", target: {intent: "Email"}, text: "..."})
   husk_intend({session_id, verb: "scroll", direction: "down", amount_px: 800})
   husk_intend({session_id, verb: "press_key", key: "Enter"})
   husk_intend({session_id, verb: "wait_for", predicate: {type: "url_pattern", regex: "/feed"}, timeout_ms: 5000})
   husk_intend({session_id, verb: "upload", target: {intent: "Resume upload"}, file_path: "..."})

Verb mode runs through the watchdog (M5) — same safety guarantees as the old husk_click/type/etc.
Intention mode adds state-graph BFS + verify + failure-mode classification on top.

PREFER intention mode when possible — it's the higher-level contract (you describe what; Husk figures out how).

OUTCOME (intention mode):
{ ok, intention, state_before, state_after, evidence[], reason?, recovery_options?[], steps_observed[] }

REJECTION (verb mode):
{ ok:false, reason, stable_id_attempted?, candidates?[] }
`,
    inputSchema: {
      type: "object",
      required: ["session_id"],
      properties: {
        session_id: { type: "string" },
        intention_name: { type: "string", description: "When set, runs intention via cognition layer." },
        args: { type: "object", description: "Args for the intention (when intention_name set)." },
        capability: { type: "object", description: "CapabilityRequirement override for this call." },
        verb: {
          type: "string",
          enum: ["click", "type", "scroll", "press_key", "wait_for", "upload"],
          description: "When set, runs raw verb via watchdog.",
        },
        target: { description: "IntentRef or {stable_id} (verb mode)" },
        text: { type: "string", description: "For verb=type." },
        direction: { type: "string", enum: ["up", "down", "into_view"], description: "For verb=scroll." },
        amount_px: { type: "integer", description: "For verb=scroll." },
        key: { type: "string", description: "For verb=press_key." },
        predicate: { type: "object", description: "For verb=wait_for." },
        timeout_ms: { type: "integer", description: "For verb=wait_for." },
        file_path: { type: "string", description: "For verb=upload." },
        file_base64: { type: "string", description: "For verb=upload (alternative to file_path)." },
      },
    },
  },

  // ── 3. husk_extract ──────────────────────────────────────────────────────
  {
    name: "husk_extract",
    description: `husk_extract — Read text content from the page.

WHEN TO USE:
- {css}: single selector → returns string|null. Use when you need ONE field.
- {selectors}: map of name→css → returns {name: text|null}. ONE round-trip per call. Use when you need multiple fields from one page.
- {selectors OR css} + {paginate: {next: {intent|stable_id}, max_pages?: 10, stop_when?: <wait_for_condition>}}: extracts the same fields ACROSS multiple pages — clicks the \`next\` element between pages and waits for the next page to settle. ONE tool call replaces a 10-turn extract+click loop.
- {urls}: batch mode — visit many URLs in parallel and extract content. Returns {results: [{url, ...}]}.

WHAT YOU GET:
- Single mode: string|null
- Multi mode: {key: text|null}
- Paginate mode: {pages: [results_per_page], total_pages, stopped_reason: "max_pages"|"stop_when"|"next_disappeared"|"click_failed"}
- Batch mode: {results: [{url, text?|result?|error?}]}

DO NOT manually loop extract + click — pass paginate instead.
For parallel URL processing, use the urls parameter instead of calling this tool repeatedly.

Example:
husk_extract({session_id, selectors: {title: "h2.title", price: ".price"}, paginate: {next: {intent: "Next page"}, max_pages: 5}})
→ returns all titles+prices across up to 5 pages in one call.

husk_extract({urls: ["https://a.com", "https://b.com"], extract: {css: ".price"}})
→ visits both URLs in parallel and returns the price from each.
`,
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
              description: "Optional condition to stop pagination early. Checked after each click.",
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
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Mode D (batch): Visit many URLs in parallel and return results as one array. Pass extract.css to get just the matched text per URL (much smaller payload). Without extract, returns a terse snapshot per URL.",
        },
        extract: {
          type: "object",
          description: "For batch mode (urls): instead of returning a full snapshot per URL, run document.querySelector(css).textContent and return just that string.",
          properties: { css: { type: "string" } },
          required: ["css"],
        },
      },
    },
  },

  // ── 4. husk_inspect ──────────────────────────────────────────────────────
  {
    name: "husk_inspect",
    description: `husk_inspect — Read-only introspection of the current page.

MODES:
- "full"     → returns a complete snapshot envelope (AX tree, network buffer, forms, metadata, page summary). Use when you need everything.
- "diff"     → returns the change since the previous snapshot for this session (cheaper for incremental observation).

This tool never mutates the page. Pairs with husk_intend (which acts) and husk_subscribe (which pushes events).

To resolve an intent to a stable_id, use husk_intend with verb mode — it internally calls the find layer. There is no standalone find tool in v0.1.

Example:
husk_inspect({session_id, mode: "full"})
husk_inspect({session_id, mode: "diff", since_signature: "<prev>"})
`,
    inputSchema: {
      type: "object",
      required: ["session_id", "mode"],
      properties: {
        session_id: { type: "string" },
        mode: { type: "string", enum: ["full", "diff"] },
        since_signature: { type: "string", description: "Required when mode=diff. Snapshot signature from a previous full snapshot." },
        include_image: { type: "boolean", description: "When mode=full, include screenshot bytes (base64)." },
        visible_only: { type: "boolean", description: "When mode=full, restrict AX tree to in-viewport nodes." },
      },
    },
  },

  // ── 5. husk_subscribe ────────────────────────────────────────────────────
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

  // ── 6. husk_ask_human ────────────────────────────────────────────────────
  {
    name: "husk_ask_human",
    description: "husk_ask_human — Ask the human a question (non-blocking; broadcasts to chat AND the Watch UI).\n\nWHEN TO USE: When you genuinely need a human decision — multiple matches with no clear winner, missing context the user has but you don't (which receipt? which address?), confirmation before a destructive action. NOT for things you can figure out yourself.\n\nWHAT YOU GET: Returns IMMEDIATELY with {pending: true, token, watch_url, surface: {question, options?}}. Your job: take the `surface` fields and ask the user in your NEXT chat message naturally. The Watch UI also shows the question with answer buttons. Whichever surface answers first wins.\n\nAFTER THE USER ANSWERS:\n- If they answer in CHAT: you already have the answer — just proceed with it. Optional: call husk_handoff({action: \"resume\", token, answer}) to record it in session_history for audit.\n- If they answer in the WATCH UI: their answer is recorded server-side. You can pick it up in the next snapshot's session_history if you need to.\n\nDO NOT: Use as a fallback for 'I'm confused' — try harder first. Every question costs the user attention. Don't ask consecutively when one question covers it.\n\nParams: session_id (string), question (string — write it as you'd say it), options? (string[] — for multiple choice; omit for free-form text), timeout_ms? (default 300000).",
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

  // ── 7. husk_handoff ──────────────────────────────────────────────────────
  {
    name: "husk_handoff",
    description: `husk_handoff — Pause the session and ask the human to take over, OR resume a paused handoff/question.

ACTIONS:
- "open" (default) — Pause the session and hand off to the human. Use when automation has actually failed (captcha, 2FA, OAuth, payment, etc.). DO NOT default to handoff just because a site "might" have captchas — try automation first, observe the failure, THEN escalate.
- "resume" — Resume a paused handoff or record a human answer (when the human responded in chat rather than the Watch UI). Pass the token from the original husk_handoff({action:"open"}) or husk_ask_human call.

SEAMLESS MODE (action=open, recommended for login walls): pass mode:"seamless" + need_cookies_back:true + target_url. Husk launches the user's real Chrome at the URL. The user logs in natively. Cookies fly back automatically. BLOCKS until completion or timeout (default 10 min).

PASTE MODE (action=open, fallback): returns immediately with {pending, token, handoff_url, surface}. User pastes cookies via bookmarklet. Use when seamless isn't available.

ORDER OF OPERATIONS: 1) For login flows, use husk_session({action:"login"}) first. 2) For other actions, try husk_intend first. 3) ONLY call husk_handoff when automation has actually failed.

DO NOT refuse a task or say "use a different tool" when hitting an engine wall, auth requirement, captcha, 2FA, or OAuth consent. Those are EXACTLY what action=open is for.

Examples:
husk_handoff({action: "open", session_id, reason: "captcha", need_cookies_back: true, mode: "seamless", target_url: "https://linkedin.com/login"})
husk_handoff({action: "resume", token: "tok-abc"})
husk_handoff({action: "resume", token: "tok-abc", answer: "yes"})
`,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["open", "resume"],
          description: "\"open\" (default) pauses the session for human handoff. \"resume\" records a human answer or unpauses a handoff (when human responded in chat).",
        },
        session_id: { type: "string", description: "Required for action=open." },
        reason: { type: "string", description: "For action=open. Short label for why a human is needed (e.g. 'captcha', '2FA required')." },
        suggested_action: { type: "string", description: "For action=open. Optional longer description of what the user should do." },
        need_cookies_back: { type: "boolean", description: "For action=open. When true, shows cookie-capture options. Default false." },
        mode: { type: "string", enum: ["seamless", "paste"], description: "For action=open. \"seamless\" spawns the user's real Chrome (blocking). \"paste\" returns immediately with a handoff URL." },
        target_url: { type: "string", description: "For action=open mode=seamless. URL the user's Chrome opens to." },
        timeout_ms: { type: "number", description: "For action=open. How long to stay paused before auto-resuming. Default 600000 (10 min)." },
        token: { type: "string", description: "For action=resume. Token from the original husk_handoff({action:\"open\"}) or husk_ask_human call." },
        answer: { type: "string", description: "For action=resume (questions). The answer string." },
        index: { type: "number", description: "For action=resume (questions with options). The selected option index." },
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
          description: "For action=resume (handoffs). Cookies to import (usually not needed for chat-resumed handoffs).",
        },
        note: { type: "string", description: "For action=resume. Audit trail note." },
      },
    },
  },

  // ── 8. husk_set_policy ───────────────────────────────────────────────────
  {
    name: "husk_set_policy",
    description: "husk_set_policy — Set or clear the watchdog security policy for a session. Pass policy_yaml: null to clear. Returns {ok: true}.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        policy_yaml: { type: ["string", "null"], description: "YAML policy string, or null to clear the current policy." },
      },
      required: ["session_id", "policy_yaml"],
    },
  },
];

// RPC_MAP for tools that pass through directly (no special dispatch logic)
const RPC_MAP: Record<string, string> = {
  husk_extract:    "extract",
  husk_subscribe:  "subscribe",
  husk_ask_human:  "ask_human",
  husk_set_policy: "set_policy",
};

export async function handleToolCall(
  client: HuskRpcClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {

  // ── husk_session: action discriminator ──────────────────────────────────
  if (toolName === "husk_session") {
    switch (args.action) {
      case "create":
        return await client.call("create_session", {
          ...(args.profile !== undefined ? { profile: args.profile } : {}),
          ...(args.parent_session_id !== undefined ? { parent_session_id: args.parent_session_id } : {}),
          ...(args.engine !== undefined ? { engine: args.engine } : {}),
          ...(args.capability !== undefined ? { capability: args.capability } : {}),
        });
      case "close":
        return await client.call("close_session", { session_id: args.session_id });
      case "goto":
        return await client.call("goto", {
          session_id: args.session_id,
          url: args.url,
          ...(args.include_snapshot !== undefined ? { include_snapshot: args.include_snapshot } : {}),
        });
      case "login":
        return await client.call("login", {
          session_id: args.session_id,
          ...(args.username !== undefined ? { username: args.username } : {}),
          ...(args.password !== undefined ? { password: args.password } : {}),
          ...(args.totp_secret !== undefined ? { totp_secret: args.totp_secret } : {}),
          ...(args.profile !== undefined ? { profile: args.profile } : {}),
          ...(args.key !== undefined ? { key: args.key } : {}),
          ...(args.include_snapshot !== undefined ? { include_snapshot: args.include_snapshot } : {}),
        });
      case "set_credentials":
        return await client.call("credentials_set", {
          // Use site as both profile and key (site-keyed credentials)
          profile: args.site,
          key: args.site,
          username: args.username,
          password: args.password,
          ...(args.totp_secret !== undefined ? { totp_secret: args.totp_secret } : {}),
        });
      case "list_profiles":
        return await client.call("vault_list_profiles", {});
      case "clear_vault":
        return await client.call("vault_clear", { profile: args.profile_name });
      default:
        throw new Error(`husk_session: invalid action "${String(args.action)}"`);
    }
  }

  // ── husk_intend: intention_name OR verb dispatch ─────────────────────────
  if (toolName === "husk_intend") {
    if (args.intention_name) {
      return await client.call("intend", {
        session_id: args.session_id,
        intention_name: args.intention_name,
        args: args.args ?? {},
        ...(args.capability !== undefined ? { capability: args.capability } : {}),
      });
    }
    // Raw-verb mode: spread target into stable_id/intent for verbs that support element targeting
    const targetFields = resolveTarget(args.target);
    switch (args.verb) {
      case "click":
        return await client.call("click", {
          session_id: args.session_id,
          ...targetFields,
        });
      case "type":
        return await client.call("type", {
          session_id: args.session_id,
          ...targetFields,
          text: args.text,
        });
      case "scroll":
        return await client.call("scroll", {
          session_id: args.session_id,
          ...targetFields,
          direction: args.direction,
          amount: args.amount_px,
        });
      case "press_key":
        return await client.call("press_key", {
          session_id: args.session_id,
          key: args.key,
        });
      case "wait_for": {
        // Spread predicate fields directly — wait_for RPC takes them at the top level
        const predicate = (args.predicate !== null && typeof args.predicate === "object")
          ? (args.predicate as Record<string, unknown>)
          : {};
        return await client.call("wait_for", {
          session_id: args.session_id,
          ...predicate,
          ...(args.timeout_ms !== undefined ? { timeout_ms: args.timeout_ms } : {}),
        });
      }
      case "upload":
        return await client.call("upload", {
          session_id: args.session_id,
          ...targetFields,
          ...(args.file_path !== undefined ? { file_path: args.file_path } : {}),
          ...(args.file_base64 !== undefined ? { content_base64: args.file_base64 } : {}),
        });
      default:
        throw new Error("husk_intend requires either intention_name or verb");
    }
  }

  // ── husk_inspect: mode dispatch ──────────────────────────────────────────
  if (toolName === "husk_inspect") {
    switch (args.mode) {
      case "full":
        return await client.call("snapshot", {
          session_id: args.session_id,
          include_image: args.include_image,
          visible_only: args.visible_only,
        });
      case "diff":
        if (!args.since_signature) {
          throw new Error("husk_inspect mode=diff requires since_signature");
        }
        return await client.call("snapshot_diff", {
          session_id: args.session_id,
          since_signature: args.since_signature,
        });
      default:
        throw new Error(`husk_inspect: invalid mode "${String(args.mode)}"`);
    }
  }

  // ── husk_extract: batch mode (urls) OR single/multi/paginate ────────────
  if (toolName === "husk_extract") {
    if (args.urls !== undefined) {
      return await client.call("batch_visit", {
        urls: args.urls,
        ...(args.extract !== undefined ? { extract: args.extract } : {}),
      });
    }
    // Single/multi/paginate modes — pass through to extract RPC
    return await client.call("extract", args);
  }

  // ── husk_handoff: action dispatch (open / resume) ────────────────────────
  if (toolName === "husk_handoff") {
    const action = (args.action as string | undefined) ?? "open";
    if (action === "open") {
      // Pass all handoff params through, excluding the action discriminator
      const { action: _a, ...handoffArgs } = args;
      return await client.call("handoff", handoffArgs);
    }
    if (action === "resume") {
      return await client.call("resume", {
        token: args.token,
        ...(args.answer !== undefined ? { answer: args.answer } : {}),
        ...(args.index !== undefined ? { index: args.index } : {}),
        ...(args.cookies !== undefined ? { cookies: args.cookies } : {}),
        ...(args.note !== undefined ? { note: args.note } : {}),
      });
    }
    throw new Error(`husk_handoff: invalid action "${action}"`);
  }

  // ── Simple pass-through tools ────────────────────────────────────────────
  const method = RPC_MAP[toolName];
  if (!method) throw new Error(`Unknown tool: ${toolName}`);
  return await client.call(method, args);
}
