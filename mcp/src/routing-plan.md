# MCP Tool Routing Plan (Phase F — M23)

## Overview

This document maps every CURRENT MCP tool (20 tools as of Phase E) to its target consolidated tool in Phase F, including the action/mode discriminator and underlying JSON-RPC method.

**Current Tool Count:** 20 MCP tools  
**Target Tool Count:** 8 consolidated tools  
**Removal:** 12+ deprecated tools (husk_click, husk_type, husk_scroll, husk_press_key, husk_wait_for, husk_upload, husk_snapshot, husk_snapshot_diff, husk_version, husk_resume, plus others folded into new tools)

---

## Consolidated Tool Specs

### husk_session

**Purpose:** Create, navigate, authenticate, and close sessions. Consolidates 8 session-lifecycle tools.

| Action | JSON-RPC Method | Parameters |
|--------|-----------------|-----------|
| create | create_session | profile?, parent_session_id?, engine?, capability? |
| close | close_session | session_id |
| goto | goto | session_id, url, include_snapshot? |
| login | login | session_id, (username + password + totp_secret?) OR (profile + key) |
| set_credentials | credentials_set | profile, key, username, password, totp_secret? |
| list_profiles | vault_list_profiles | (no parameters) |
| clear_vault | vault_clear | profile |
| load_profile | vault_list_cookies | profile (retrieve list) / TBD: needs vault_load equivalent |

**Schema Discriminator:** `action` field (enum: "create", "close", "goto", "login", "set_credentials", "list_profiles", "clear_vault", "load_profile")

**Notes:**
- `load_profile` JSON-RPC method: `vault_list_cookies` returns the cookies, but there is no "load" method. The plan spec references `vault_load` but orchestrator/src/http/methods.ts does not expose this method. **CONCERN: Gap in JSON-RPC surface — vault_load may need to be added or load_profile mode deferred.**

---

### husk_intend

**Purpose:** Single primitive for ALL page actions — supports both named intentions (cognition-driven) and raw verbs (watchdog-based).

| Mode | When | JSON-RPC Method | Parameters |
|------|------|-----------------|-----------|
| intention | intention_name present | intend | session_id, intention_name, args?, capability? |
| click | verb="click" | click | session_id, stable_id?, intent? |
| type | verb="type" | type | session_id, stable_id?, intent?, text |
| scroll | verb="scroll" | scroll | session_id, stable_id?, intent?, direction?, amount?, until?, max_scrolls?, scroll_amount_px? |
| press_key | verb="press_key" | press_key | session_id, key |
| wait_for | verb="wait_for" | wait_for | session_id + condition (text, role+name, url_matches, network_idle, selector_visible), timeout_ms? |
| upload | verb="upload" | upload | session_id, stable_id?, intent?, file_path?, content_base64?, filename? |

**Schema Discriminator:** Either `intention_name` (intention mode) OR `verb` (raw verb mode, enum: "click", "type", "scroll", "press_key", "wait_for", "upload")

**Notes:**
- Intention mode routes directly to `intend` JSON-RPC method.
- Verb mode dispatches via watchdog to the corresponding low-level RPC method.
- All verbs support `include_snapshot` parameter (not shown in table).

---

### husk_inspect

**Purpose:** Read-only introspection of the current page. Consolidates 3 snapshot/find tools.

| Mode | JSON-RPC Method | Parameters |
|------|-----------------|-----------|
| full | snapshot | session_id, max_age_ms?, mode? ("full"|"terse"|"visible"), include_image?, full_page? |
| diff | snapshot_diff | session_id |
| find | (TBD: custom find method) | session_id, intent |

**Schema Discriminator:** `mode` field (enum: "full", "diff", "find")

**Notes:**
- `mode=full` routes to `snapshot` RPC with params verbatim.
- `mode=diff` routes to `snapshot_diff` RPC.
- `mode=find` requires a custom JSON-RPC method. Orchestrator/src/http/methods.ts does NOT currently expose a `find` method. **CONCERN: Find method is referenced in plan but missing from orchestrator. Likely needs to be added or find mode deferred.**

---

### husk_extract

**Purpose:** Read text content from the page. Unchanged from current implementation.

| Mode | JSON-RPC Method | Parameters |
|------|-----------------|-----------|
| single (css) | extract | session_id, css |
| multi (selectors) | extract | session_id, selectors (map) |
| paginate | extract | session_id, css OR selectors, paginate {next, max_pages?, stop_when?} |
| batch (URLs) | batch_visit | urls, extract? |

**Notes:**
- Single and multi modes route to `extract` JSON-RPC.
- Paginate mode also routes to `extract` with the paginate parameter.
- Batch mode routes to `batch_visit` JSON-RPC.
- Tool remains as `husk_extract` (no consolidation); routing is internal to the tool.

---

### husk_inspect (Subscription Variant)

**Purpose:** Subscribe to session/site events. New tool wrapping M22's subscribe JSON-RPC.

| Event Type | JSON-RPC Method | Parameters |
|------------|-----------------|-----------|
| state_change | subscribe | event_type, session_id?, site?, debounce_ms? |
| network_idle | subscribe | event_type, session_id?, site?, debounce_ms? |
| error_appeared | subscribe | event_type, session_id?, site?, debounce_ms? |
| captcha_detected | subscribe | event_type, session_id?, site?, debounce_ms? |
| user_intervention_required | subscribe | event_type, session_id?, site?, debounce_ms? |

**Notes:**
- All event types route to the same `subscribe` JSON-RPC method.
- Unsubscribe routes to `unsubscribe` JSON-RPC method (not exposed on MCP surface yet; reserved for JSON-RPC only).

---

### husk_ask_human

**Purpose:** Ask the human a question (non-blocking). Unchanged from current implementation.

| JSON-RPC Method | Parameters |
|-----------------|-----------|
| ask_human | session_id, question, options?, timeout_ms? |

**Notes:**
- No consolidation — tool remains as-is.
- Returns {pending, token, watch_url, surface}.

---

### husk_handoff

**Purpose:** Pause session and hand off to human. Updated to support action discriminator.

| Action | JSON-RPC Method | Parameters |
|--------|-----------------|-----------|
| open | handoff | session_id, reason, suggested_action?, need_cookies_back?, mode?, target_url?, timeout_ms? |
| resume | resume | token, answer?, index?, cookies?, note? |

**Schema Discriminator:** `action` field (optional; default "open", enum: "open", "resume")

**Notes:**
- `action=open` (or unset) routes to `handoff` JSON-RPC.
- `action=resume` routes to `resume` JSON-RPC.
- `husk_resume` tool is being folded into `husk_handoff` as an action mode.

---

### husk_set_policy

**Purpose:** Set or clear the watchdog security policy for a session. Unchanged from current implementation.

| JSON-RPC Method | Parameters |
|-----------------|-----------|
| set_policy | session_id, policy_yaml (string or null) |

**Notes:**
- No consolidation — tool remains as-is.
- Returns {ok: true} on success.

---

## Removed from MCP Surface (Kept in JSON-RPC)

The following 12+ tools are removed from the MCP tool-surface.ts TOOL_SURFACE array. Their underlying JSON-RPC methods remain available for advanced users / internal tooling:

| Old MCP Tool | Reason | JSON-RPC Method Still Available |
|--------------|--------|--------------------------------|
| husk_create_session | Folded into husk_session(action="create") | create_session ✓ |
| husk_goto | Folded into husk_session(action="goto") | goto ✓ |
| husk_login | Folded into husk_session(action="login") | login ✓ |
| husk_credentials_set | Folded into husk_session(action="set_credentials") | credentials_set ✓ |
| husk_vault_list_profiles | Folded into husk_session(action="list_profiles") | vault_list_profiles ✓ |
| husk_vault_clear | Folded into husk_session(action="clear_vault") | vault_clear ✓ |
| husk_close_session | Folded into husk_session(action="close") | close_session ✓ |
| husk_click | Folded into husk_intend(verb="click") | click ✓ |
| husk_type | Folded into husk_intend(verb="type") | type ✓ |
| husk_scroll | Folded into husk_intend(verb="scroll") | scroll ✓ |
| husk_press_key | Folded into husk_intend(verb="press_key") | press_key ✓ |
| husk_wait_for | Folded into husk_intend(verb="wait_for") | wait_for ✓ |
| husk_upload | Folded into husk_intend(verb="upload") | upload ✓ |
| husk_snapshot | Folded into husk_inspect(mode="full") | snapshot ✓ |
| husk_snapshot_diff | Folded into husk_inspect(mode="diff") | snapshot_diff ✓ |
| husk_resume | Folded into husk_handoff(action="resume") | resume ✓ |
| husk_version | Removed from MCP surface | (special case in handler, no dedicated RPC method) |

---

## JSON-RPC Methods Available (Orchestrator)

Full list of JSON-RPC methods in orchestrator/src/http/methods.ts:

### Session Lifecycle
- `health` — server status
- `create_session` — create a new session
- `goto` — navigate to URL
- `snapshot` — read current page state
- `snapshot_diff` — read changes since last snapshot
- `close_session` — close session
- `intend` — execute named intention (Phase B)

### Actions
- `click` — click element
- `type` — type text
- `scroll` — scroll page
- `press_key` — press key
- `wait_for` — wait for condition
- `upload` — upload file
- `dialog` — handle JS dialog (JSON-RPC only; not exposed in MCP)

### Vault & Credentials
- `vault_list_profiles` — list cookie profiles
- `vault_list_cookies` — list cookies in profile
- `vault_clear` — clear profile
- `vault_remove_cookie` — remove single cookie
- `credentials_set` — store credential
- `credentials_remove` — remove credential
- `credentials_list` — list credentials
- `credentials_list_profiles` — list credential profiles

### Extraction
- `extract` — extract text/fields (single page or paginate)
- `batch_visit` — visit many URLs in parallel

### Human I/O
- `ask_human` — ask human a question
- `handoff` — pause and hand off to human
- `resume` — resume from human interaction

### Subscriptions (M22)
- `subscribe` — register event subscription
- `unsubscribe` — unregister subscription

### Policy
- `set_policy` — set watchdog policy

---

## Concerns & Gaps

### 1. `husk_inspect(mode="find")` — Missing `find` JSON-RPC Method

**Issue:** The routing plan spec (Phase F, Task 3) specifies `husk_inspect({mode: "find", intent: "..."})` routing to a `find` JSON-RPC method. However, orchestrator/src/http/methods.ts does NOT define a `find` method.

**Status:** This is likely a placeholder for Phase F post-v0.1 work or a method that needs to be added. Current code does not implement it.

**Impact:** Tasks T3 (husk_inspect) and T4 (husk_intend with find integration) will need clarification or deferred implementation.

### 2. `husk_session(action="load_profile")` — Missing `vault_load` JSON-RPC Method

**Issue:** The routing plan spec (Phase F, Task 5) specifies `husk_session({action: "load_profile", session_id, profile_name})`. The plan references a `vault_load` JSON-RPC method, but orchestrator/src/http/methods.ts does NOT define it.

**Status:** Current vault interface exposes list + clear + remove_cookie, but no "load" operation. Cookie loading may be implicit (handled during session creation with `profile` parameter) or needs a new method.

**Impact:** Task 5 (husk_session) will need to clarify how load_profile maps to existing vault RPC methods or if this action should be deferred.

---

## Task-to-Implementation Mapping

| Task | MCP Tool(s) | Scope | Affected Current Tools |
|------|-------------|-------|----------------------|
| T1 (This) | N/A | Routing plan document | (all) |
| T2 | husk_subscribe | New tool wrapper | (new) |
| T3 | husk_inspect | New tool (snapshot/diff/find) | husk_snapshot, husk_snapshot_diff, (husk_find) |
| T4 | husk_intend | New tool (intention + verbs) | husk_click, husk_type, husk_scroll, husk_press_key, husk_wait_for, husk_upload |
| T5 | husk_session + husk_handoff | Consolidate 8 tools + add action modes | husk_create_session, husk_goto, husk_login, husk_credentials_set, husk_vault_list_profiles, husk_vault_clear, husk_close_session, husk_resume, husk_version |
| T6 | (integration test) | Exercise all 8 tools end-to-end | (all) |

---

## Verification Checklist

- [x] All 20 current MCP tools accounted for (listed in either a target consolidation or the "Removed" section)
- [x] Each tool maps to at least one JSON-RPC method
- [x] 8 target consolidated tools named: husk_session, husk_intend, husk_inspect, husk_extract, husk_subscribe, husk_ask_human, husk_handoff, husk_set_policy
- [ ] All JSON-RPC methods for husk_inspect(mode="find") exist (CONCERN: missing `find` method)
- [ ] All JSON-RPC methods for husk_session(action="load_profile") exist (CONCERN: missing `vault_load` method)
- [x] JSON-RPC methods remain available after MCP surface consolidation (backward compat)
- [x] No gaps in action/mode dispatch logic for any consolidated tool

---

## References

- Plan: `/Users/nirmalghinaiya/Desktop/husk/docs/superpowers/plans/2026-05-25-husk-m23-tool-consolidation.md`
- Current tool surface: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/tool-surface.ts`
- Current proxy/handler: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/proxy.ts`
- JSON-RPC methods: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/methods.ts`
