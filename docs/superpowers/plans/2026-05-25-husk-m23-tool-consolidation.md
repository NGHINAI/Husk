# Husk M23 — Phase F: Tool Surface Consolidation (Final v0.1 Milestone)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Consolidate the 23 MCP tools shipped across M5-M22 down to **8 cognition-aligned primitives**: `husk_session`, `husk_intend`, `husk_extract`, `husk_inspect`, `husk_subscribe`, `husk_ask_human`, `husk_handoff`, `husk_set_policy`. JSON-RPC keeps all primitives (per spec — "deprecated for advanced users only"); MCP becomes the high-leverage surface.

**Architecture:** Three new MCP tools (`husk_intend`, `husk_inspect`, `husk_subscribe`), one major consolidation (`husk_session` with `action` discriminator), retention of three existing tools (`husk_extract`, `husk_ask_human`, `husk_handoff`, `husk_set_policy`), and removal of 14+ deprecated tools from the MCP surface. All consolidations route to existing JSON-RPC methods; no orchestrator-level changes needed for the consolidation itself.

**Tech Stack:** TypeScript MCP package (`mcp/`) + SDK type mirrors. No new dependencies.

**Mapping (current → consolidated):**

| Current Tool                       | Goes Into          | Form                                                 |
| ---------------------------------- | ------------------ | ---------------------------------------------------- |
| husk_create_session                | husk_session       | action="create"                                      |
| husk_close_session                 | husk_session       | action="close"                                       |
| husk_goto                          | husk_session       | action="goto"                                        |
| husk_login                         | husk_session       | action="login"                                       |
| husk_credentials_set               | husk_session       | action="set_credentials"                             |
| husk_vault_list_profiles           | husk_session       | action="list_profiles"                               |
| husk_vault_clear                   | husk_session       | action="clear_vault"                                 |
| husk_click / type / scroll / press_key / wait_for | husk_intend | new primitive — cognition-driven           |
| husk_upload                        | husk_intend        | new primitive — verb="upload"                        |
| husk_snapshot                      | husk_inspect       | mode="full"                                          |
| husk_snapshot_diff                 | husk_inspect       | mode="diff"                                          |
| husk_find                          | husk_inspect       | mode="find"                                          |
| husk_extract                       | husk_extract       | (unchanged)                                          |
| husk_batch_visit                   | husk_extract       | batch mode (already mostly there — keep tool name)   |
| husk_set_policy                    | husk_set_policy    | (unchanged)                                          |
| husk_ask_human                     | husk_ask_human     | (unchanged)                                          |
| husk_handoff                       | husk_handoff       | (unchanged)                                          |
| husk_resume                        | husk_handoff       | action="resume"                                      |
| (new) subscribe (M22)              | husk_subscribe     | new tool — wraps JSON-RPC subscribe + returns stream URL |
| husk_version                       | (removed from MCP surface; kept in JSON-RPC) | — |

Result: **8 MCP tools.**

**Locked decisions (v0.1 spec §16):**
- Phase F is the final v0.1 milestone — after this, MCP surface freezes for the v0.1 release
- JSON-RPC stays as the wide-surface escape hatch; advanced users / internal tooling use it directly
- Backward compat: existing JSON-RPC clients keep working; only MCP tool list shrinks
- Each consolidated tool's description explicitly explains its modes so agents discover via the schema

**Explicitly deferred (post-v0.1):**
- Subscription-bus tool variants for replay / late-subscriber buffering
- `husk_intend` with built-in retry policy (beyond what verify retry already provides)
- MCP tool versioning / deprecation warnings to old MCP consumers (none exist yet)

**Spec references:** v0.1 design doc §5 (tool surface table, line 510 region).

---

## File Structure

### Modified

```
mcp/src/tool-surface.ts         # major rewrite — collapse 23 entries to 8
mcp/src/proxy.ts                # update tool→JSON-RPC routing to handle new tools (action/mode discrimination)
mcp/src/index.ts                # ensure entry point still exports the new surface
```

### Test files

```
mcp/tests/tool-surface.test.ts  # asserts exactly 8 tools, names correct, schemas valid
mcp/tests/proxy-routing.test.ts # action/mode dispatch unit tests for each new tool
orchestrator/tests/integration/mcp-consolidated.test.ts  # real-MCP integration: exercise all 8 tools
```

---

## Task 1 — Inventory + plan the proxy routing layer

**Model:** Haiku — pure analysis + commit a routing-spec doc.

### Files

- Create: `mcp/src/routing-plan.md` (internal design doc — markdown in source tree for living reference)

### Goal

Before any code change, write a routing-plan.md that lists every CURRENT MCP tool, the consolidated tool it maps to, the new `action` or `mode` discriminator, and which JSON-RPC method it calls. This doc gives subsequent T2-T6 implementers a clear contract.

### Process

1. Read `mcp/src/tool-surface.ts` end-to-end. Enumerate every `name:` entry.
2. Read `mcp/src/proxy.ts` (or `mcp/src/handler.ts` — whichever has the JSON-RPC dispatch). Note how each current tool maps to an orchestrator JSON-RPC method.
3. Read `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/http/methods.ts` to confirm available JSON-RPC method names (`create_session`, `goto`, `click`, `intend`, `subscribe`, `extract`, `snapshot`, `snapshot_diff`, `set_policy`, etc.).
4. Write the routing-plan.md with this exact structure:

```markdown
# MCP Tool Routing Plan (Phase F — M23)

## husk_session
| Action | JSON-RPC method | Notes |
|--------|-----------------|-------|
| create | create_session  | + profile, capability, engine, watch_url params |
| close  | close_session   | session_id |
| goto   | goto            | session_id, url |
| login  | login           | session_id, site, username?, password? (uses stored creds when omitted) |
| set_credentials | credentials_set | site, username, password, totp_secret? |
| list_profiles  | vault_list_profiles | (no args) |
| clear_vault | vault_clear     | profile_name |
| load_profile | vault_load    | session_id, profile_name |

## husk_intend
Single primitive that covers click/type/scroll/press_key/wait_for/upload by mode of intent.
Routes to: intend (when intention_name provided) OR a chain of legacy primitives (when raw verbs requested).

| Mode | When | JSON-RPC method |
|------|------|-----------------|
| intention | { intention_name, args? } | intend |
| click     | { verb: "click", target } | click |
| type      | { verb: "type", target, text } | type |
| scroll    | { verb: "scroll", direction, target?, amount_px? } | scroll |
| press_key | { verb: "press_key", key } | press_key |
| wait_for  | { verb: "wait_for", predicate, timeout_ms? } | wait_for |
| upload    | { verb: "upload", target, file_path? OR base64? } | upload |

## husk_inspect
Read-only introspection of the current page.

| Mode | JSON-RPC method |
|------|-----------------|
| snapshot | snapshot |
| diff     | snapshot_diff |
| find     | find |

## husk_extract
(unchanged — keep description; routes to extract / batch_visit by presence of `urls` array)

## husk_subscribe
| JSON-RPC method | Notes |
|-----------------|-------|
| subscribe       | returns subscription_id + stream_url; agent opens SSE separately (or via SDK) |

## husk_ask_human
(unchanged)

## husk_handoff
| Action | JSON-RPC method |
|--------|-----------------|
| open   | handoff |
| resume | resume  |

## husk_set_policy
(unchanged)

## Removed from MCP surface (kept in JSON-RPC)
- husk_version → JSON-RPC `version`
- All renamed/folded tools above
```

5. Commit:

```bash
git add mcp/src/routing-plan.md
git commit -m "docs(mcp): Phase F routing plan — 23 → 8 tool consolidation"
```

### Constraints

- DO NOT modify tool-surface.ts or proxy.ts in T1.
- DO NOT use `--no-verify`, `--amend`. DO NOT push.
- The routing plan must be specific enough that T2-T6 implementers don't need to re-research.

### Report

- **DONE**: "T1 done. Routing plan committed at <sha>. Current tool count: <N>. Target tools detailed: 8."

---

## Task 2 — husk_subscribe MCP tool

**Model:** Haiku — small new tool, wraps M22's subscribe JSON-RPC.

### Files

- Modify: `mcp/src/tool-surface.ts` — add husk_subscribe entry (don't remove anything yet)
- Modify: `mcp/src/proxy.ts` (or handler) — route `husk_subscribe` to JSON-RPC `subscribe`
- Create: `mcp/tests/subscribe-tool.test.ts` — 2 tests

### Tool spec

```typescript
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
}
```

### Routing

In proxy.ts, when `tool_name === "husk_subscribe"`, call JSON-RPC `subscribe` with the params verbatim (event_type, session_id?, site?, debounce_ms?). Return the response as MCP content.

### Tests

1. tool-surface includes `husk_subscribe` with the right schema.
2. Calling `husk_subscribe({event_type: "state_change"})` via proxy routes to JSON-RPC `subscribe` and returns the wire shape (use a mocked JSON-RPC client or the real in-process orchestrator).

### TDD process

1. Read routing-plan.md.
2. Write tests → FAIL.
3. Add husk_subscribe entry.
4. Add proxy routing.
5. Re-run → PASS.
6. Full suite green.
7. Build clean.
8. Commit:

```bash
git add mcp/src/tool-surface.ts mcp/src/proxy.ts \
        mcp/tests/subscribe-tool.test.ts
git commit -m "feat(mcp): husk_subscribe tool (wraps M22 subscribe JSON-RPC)"
```

### Constraints

- DO NOT remove any existing tool yet. Removal is T5.
- DO NOT use `any`. Strict TS.
- DO NOT push.

---

## Task 3 — husk_inspect MCP tool

**Model:** Sonnet — multi-mode dispatch.

### Files

- Modify: `mcp/src/tool-surface.ts` — add husk_inspect
- Modify: `mcp/src/proxy.ts` — route by `mode`
- Create: `mcp/tests/inspect-tool.test.ts` — 4 tests

### Tool spec

```typescript
{
  name: "husk_inspect",
  description: `husk_inspect — Read-only introspection of the current page.

MODES:
- "full"     → returns a complete snapshot envelope (AX tree, network buffer, forms, metadata, page summary). Use when you need everything.
- "diff"     → returns the change since the previous snapshot for this session (cheaper for incremental observation).
- "find"     → resolves an intent string to candidate stable_ids (role+name fuzzy matching against the current snapshot).

This tool never mutates the page. Pairs with husk_intend (which acts) and husk_subscribe (which pushes events).

Example:
husk_inspect({session_id, mode: "full"})
husk_inspect({session_id, mode: "find", intent: "Sign in button"})
husk_inspect({session_id, mode: "diff", since_signature: "<prev snapshot signature>"})
`,
  inputSchema: {
    type: "object",
    required: ["session_id", "mode"],
    properties: {
      session_id: { type: "string" },
      mode: { type: "string", enum: ["full", "diff", "find"] },
      intent: { type: "string", description: "Required when mode=find. Natural-language target (e.g. 'Sign in button')." },
      since_signature: { type: "string", description: "Required when mode=diff. Snapshot signature from a previous full snapshot." },
      include_image: { type: "boolean", description: "When mode=full, include screenshot bytes (base64)." },
      visible_only: { type: "boolean", description: "When mode=full, restrict AX tree to in-viewport nodes." },
    },
  },
}
```

### Routing

```typescript
if (toolName === "husk_inspect") {
  switch (params.mode) {
    case "full": return await rpc("snapshot", { session_id, include_image, visible_only });
    case "diff": return await rpc("snapshot_diff", { session_id, since_signature });
    case "find": return await rpc("find", { session_id, intent: params.intent });
    default: throw new Error(`invalid mode: ${params.mode}`);
  }
}
```

Validate that `mode=find` requires `intent`, `mode=diff` requires `since_signature`, otherwise throw with clear message.

### Tests

1. mode=full routes to snapshot
2. mode=diff routes to snapshot_diff
3. mode=find routes to find
4. mode=find without intent throws clearly
5. invalid mode throws

### TDD process

Standard. Full suite green after commit:

```bash
git add mcp/src/tool-surface.ts mcp/src/proxy.ts \
        mcp/tests/inspect-tool.test.ts
git commit -m "feat(mcp): husk_inspect tool (snapshot/diff/find consolidated)"
```

### Constraints

Same as T2 — additive only, no removal.

---

## Task 4 — husk_intend MCP tool

**Model:** Sonnet — load-bearing primitive.

### Files

- Modify: `mcp/src/tool-surface.ts` — add husk_intend
- Modify: `mcp/src/proxy.ts` — route by `verb` or `intention_name`
- Create: `mcp/tests/intend-tool.test.ts` — 8+ tests

### Tool spec

```typescript
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
      verb: { type: "string", enum: ["click", "type", "scroll", "press_key", "wait_for", "upload"], description: "When set, runs raw verb via watchdog." },
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
}
```

### Routing

```typescript
if (toolName === "husk_intend") {
  if (params.intention_name) {
    return await rpc("intend", {
      session_id, intention_name: params.intention_name,
      args: params.args ?? {}, capability: params.capability,
    });
  }
  // Raw-verb mode
  switch (params.verb) {
    case "click":    return await rpc("click",    { session_id, target: params.target });
    case "type":     return await rpc("type",     { session_id, target: params.target, text: params.text });
    case "scroll":   return await rpc("scroll",   { session_id, target: params.target, direction: params.direction, amount_px: params.amount_px });
    case "press_key": return await rpc("press_key", { session_id, key: params.key });
    case "wait_for": return await rpc("wait_for", { session_id, predicate: params.predicate, timeout_ms: params.timeout_ms });
    case "upload":   return await rpc("upload",   { session_id, target: params.target, file_path: params.file_path, file_base64: params.file_base64 });
    default: throw new Error("husk_intend requires either intention_name or verb");
  }
}
```

### Tests

8+ cases:
1. intention_name routes to intend RPC
2. verb=click routes to click RPC
3. verb=type routes to type RPC with text
4. verb=scroll routes to scroll RPC
5. verb=press_key routes to press_key RPC
6. verb=wait_for routes to wait_for RPC
7. verb=upload routes to upload RPC
8. neither intention_name nor verb → clear error
9. invalid verb → clear error

### TDD process

Standard. Commit:

```bash
git add mcp/src/tool-surface.ts mcp/src/proxy.ts \
        mcp/tests/intend-tool.test.ts
git commit -m "feat(mcp): husk_intend tool (intention + 6 raw verbs)"
```

---

## Task 5 — husk_session MCP tool + remove deprecated tools

**Model:** Sonnet — biggest scope change. The session tool consolidates 7-8 existing tools.

### Files

- Modify: `mcp/src/tool-surface.ts` — add husk_session; **REMOVE all consolidated/deprecated tools** (per the routing-plan.md from T1)
- Modify: `mcp/src/proxy.ts` — route by `action`
- Create: `mcp/tests/session-tool.test.ts` — 10+ tests (one per action)

### Tool spec

```typescript
{
  name: "husk_session",
  description: `husk_session — Create, navigate, authenticate, and close sessions.

ACTIONS:
- "create"          → start a new session. Optional: profile, capability, engine, watch_url.
                      Returns { session_id, watch_url?, engine }.
- "close"           → close a session by session_id.
- "goto"            → navigate to a URL.
- "login"           → log in to a site. Uses stored creds when omitted (set via action="set_credentials").
- "set_credentials" → store username/password/TOTP for a site (encrypted vault).
- "list_profiles"   → list stored cookie-jar profile names.
- "clear_vault"     → delete a stored profile.
- "load_profile"    → attach a previously saved cookie-jar profile to a session.

Each action takes the params it needs; unused fields are ignored. The schema lists everything.

Examples:
husk_session({action: "create", capability: {features: ["webrtc"]}})
husk_session({action: "goto", session_id, url: "https://x.com/"})
husk_session({action: "login", session_id, site: "linkedin.com"})
husk_session({action: "set_credentials", site: "linkedin.com", username: "...", password: "...", totp_secret: "..."})
`,
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["create", "close", "goto", "login", "set_credentials", "list_profiles", "clear_vault", "load_profile"] },
      session_id: { type: "string" },
      url: { type: "string" },
      profile_name: { type: "string" },
      capability: { type: "object" },
      engine: { type: "string", enum: ["lightpanda", "chrome", "auto"] },
      watch_url: { type: "boolean" },
      site: { type: "string" },
      username: { type: "string" },
      password: { type: "string" },
      totp_secret: { type: "string" },
    },
  },
}
```

### Routing

Switch on action; map each to the corresponding JSON-RPC method (see T1's routing-plan.md).

### Removed tools

After husk_session is in place, REMOVE from tool-surface.ts (delete the array entries):
- husk_create_session
- husk_close_session
- husk_goto
- husk_login
- husk_credentials_set
- husk_vault_list_profiles
- husk_vault_clear
- (any husk_vault_load equivalent)
- husk_version

Also remove deprecated tools folded into husk_intend / husk_inspect / husk_handoff:
- husk_click
- husk_type
- husk_scroll
- husk_press_key
- husk_wait_for
- husk_upload
- husk_snapshot
- husk_snapshot_diff
- husk_find (if present)
- husk_resume (folded into husk_handoff with action="resume")

Final tool list must be EXACTLY 8 names:
1. husk_session
2. husk_intend
3. husk_inspect
4. husk_extract
5. husk_subscribe
6. husk_ask_human
7. husk_handoff
8. husk_set_policy

### husk_handoff resume integration

Update husk_handoff's description + schema to add an optional `action: "resume"` mode. When action=resume, route to JSON-RPC `resume`. When action="open" or unset, route to existing `handoff` method.

```typescript
// husk_handoff schema additions
{
  // ...existing...
  action: { type: "string", enum: ["open", "resume"], default: "open" },
}
```

### Tests

10+ tests per action, plus:
- assert exactly 8 tools in tool-surface
- assert tool names match the canonical list
- removed tools throw or don't exist

```typescript
// mcp/tests/tool-surface.test.ts (NEW)
it("exposes exactly 8 tools", () => {
  expect(TOOLS).toHaveLength(8);
});
it("tool names match v0.1 spec", () => {
  expect(TOOLS.map(t => t.name).sort()).toEqual([
    "husk_ask_human", "husk_extract", "husk_handoff",
    "husk_inspect", "husk_intend", "husk_session",
    "husk_set_policy", "husk_subscribe",
  ]);
});
```

### TDD process

1. Read T1's routing-plan + every prior task's changes.
2. Write tool-surface.test.ts asserting 8 tools.
3. Write session-tool.test.ts with each action case → FAIL.
4. Add husk_session.
5. Add proxy routing for each action.
6. Update husk_handoff for action="resume".
7. REMOVE the 14+ deprecated tools from tool-surface.ts.
8. Update proxy.ts to remove (or stub-with-error) routing for removed tools.
9. Re-run → all PASS.
10. Run full MCP test suite — anything that referenced old tool names by string must be updated.
11. Run orchestrator suite (no changes expected — MCP is a thin layer).
12. Build clean.
13. Commit:

```bash
git add mcp/src/tool-surface.ts mcp/src/proxy.ts \
        mcp/tests/session-tool.test.ts mcp/tests/tool-surface.test.ts
git commit -m "feat(mcp): husk_session tool + remove deprecated tools — final 8-tool surface"
```

### Constraints

- The final tool list MUST be EXACTLY 8 names (validated by test).
- All previously-shipped behavior must still be reachable via the new tool list.
- JSON-RPC methods are UNCHANGED — only the MCP tool surface shrinks.
- DO NOT use `any`. Strict TS.
- DO NOT use `--no-verify`, `--amend`, `--no-gpg-sign`. DO NOT push.

### Self-review

- Exactly 8 tools? (test asserts)
- Every action of husk_session correctly routes?
- husk_handoff action="resume" still works?
- Old tools are gone from the MCP surface BUT JSON-RPC methods still exist on the orchestrator?
- Build clean?

---

## Task 6 — Real-MCP integration test

**Model:** Sonnet — exercise the consolidated surface end-to-end.

### File

- Create: `orchestrator/tests/integration/mcp-consolidated.test.ts`

### Test plan

Skip when LIGHTPANDA_BIN unset. Spin up the orchestrator + MCP proxy in-process. Drive a small flow via the new 8-tool surface.

Test cases:

1. **Tool discovery returns 8** — query MCP `tools/list`, assert exact names + count.
2. **End-to-end flow with new tools:**
   - `husk_session({action: "create"})` → session_id
   - `husk_session({action: "goto", session_id, url: <fixture>/page-a})` → ok
   - `husk_inspect({session_id, mode: "full"})` → snapshot envelope returned
   - `husk_inspect({session_id, mode: "find", intent: "Go to B link"})` → candidates returned
   - `husk_intend({session_id, verb: "click", target: {intent: "Go to B link"}})` → ok (or graceful failure)
   - `husk_session({action: "close", session_id})` → ok
3. **husk_subscribe smoke** — call `husk_subscribe({event_type: "state_change", session_id: "*"})` → returns subscription_id + stream_url; unsubscribe via the same tool (if surfaced) or via JSON-RPC; assert no errors.

For test 3, opening the SSE stream isn't required (M22 T10 already covers that path); we just verify the subscribe tool returns the right wire shape.

### TDD process

1. Pattern-match `orchestrator/tests/integration/mcp-e2e.test.ts` (if exists from M6 T13) for the spawn-MCP setup.
2. Write the 3 cases.
3. Run with lightpanda:
   `LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda pnpm --filter husk-orchestrator test integration/mcp-consolidated`
4. Run full suite without lightpanda — test skips cleanly.
5. Commit:

```bash
git add orchestrator/tests/integration/mcp-consolidated.test.ts
git commit -m "test(integration): MCP consolidated 8-tool surface e2e"
```

### Constraints

- DO NOT modify mcp/ or orchestrator source files.
- Skip cleanly without lightpanda.
- Clean up: close session, kill MCP child process.

---

## Task 7 — Spec + memory + tag + merge + v0.1 completion

**Model:** Haiku.

### Spec amendment

Append Phase F block to `docs/superpowers/specs/2026-05-25-husk-v0.1-design.md`. Note: this is the FINAL phase — also mark v0.1 as feature-complete.

```markdown

### Phase F — Tool Surface Consolidation (M23 — shipped 2026-05-25) **— FINAL v0.1 PHASE**

Shipped:
- 8 consolidated MCP tools (down from 23): husk_session, husk_intend, husk_extract, husk_inspect, husk_subscribe, husk_ask_human, husk_handoff, husk_set_policy
- `husk_session` action discriminator: create / close / goto / login / set_credentials / list_profiles / clear_vault / load_profile
- `husk_intend` dual-mode: intention_name (cognition-driven) OR verb (raw click/type/scroll/press_key/wait_for/upload via watchdog)
- `husk_inspect` mode discriminator: full / diff / find
- `husk_handoff` action discriminator: open / resume
- `husk_subscribe` new tool wrapping M22's subscribe JSON-RPC
- 14+ deprecated MCP tools removed from the surface (JSON-RPC methods retained for advanced users)
- Real-MCP integration test exercises the consolidated surface end-to-end

**v0.1 IS NOW FEATURE-COMPLETE.** All six phases shipped:
- Phase A (M18) — State Graph Foundation
- Phase B (M19) — Intention Compiler
- Phase C (M20) — Outcome Verifier Expansion
- Phase D (M21) — Capability Router + ax_state + observation log
- Phase E (M22) — Streaming Protocol + Subscription Bus
- Phase F (M23) — Tool Surface Consolidation

**Test count after Phase F:** ~950+ passing.

**Architecture status:** All three v0.1 layers shipped — Cognition (intentions + state graph + verify + observations), Capability Router (engine selection by requirement), and Husk v0 substrate (lightpanda/chrome via CDP + watchdog + snapshot + vault + credentials).

**Post-v0.1 candidates** (not committed):
- `new_data` event type (Gmail/Slack-specific)
- `rate_limit_*` event types (per-site policy detection)
- Real-user engine target (third capability tier — needs Watch UI integration)
- Mid-intention engine swap (capability mismatch detected mid-execution)
- Event replay / late-subscriber buffering
- Compound recovery options (executable intention chains)
- Evidence weighting + intention confidence scoring
- AxTreeNode shape normalization across engines (lightpanda letter-flags → CDP AxProperty)
- Cross-orchestrator event federation
- Community sharing of state graphs / intentions
```

### Memory updates

- `husk-roadmap.md`: append `v0.0.22-m23 — Phase F of v0.1 (Tool Surface Consolidation) — v0.1 FEATURE-COMPLETE`
- `husk-architecture.md`: append "Cognition Layer — Phase F (Tool Consolidation)" subsection — small block summarizing the 8-tool surface
- `husk-overview.md`: update status to "v0.1 build COMPLETE — all 6 phases shipped (M18-M23)"

### Tag + merge

```bash
git tag -a v0.0.22-m23 -m "M23: v0.1 Phase F — Tool Surface Consolidation (FINAL v0.1)

- 8 consolidated MCP tools (down from 23)
- husk_session (action discriminator), husk_intend (intention + 6 verbs), husk_inspect (snapshot/diff/find)
- husk_subscribe (M22 wrapper), husk_handoff (open + resume)
- JSON-RPC methods retained for advanced consumers

v0.1 IS FEATURE-COMPLETE. All six phases shipped:
- A (M18) State Graph Foundation
- B (M19) Intention Compiler
- C (M20) Outcome Verifier Expansion
- D (M21) Capability Router
- E (M22) Streaming + Subscription Bus
- F (M23) Tool Surface Consolidation"

git checkout main
git merge --no-ff m23-tool-consolidation -m "Merge Milestone 23 (v0.1 Phase F: Tool Consolidation — v0.1 feature-complete)"
```

DO NOT push.

---

## Self-review

**Spec coverage:**
- §5 tool surface table (line 510) ✓ — 8 tools match exactly
- §3 architecture freeze for v0.1 ✓ — all 3 layers shipped
- Backward compat: JSON-RPC unchanged ✓

**Tool count:** 23 → 8 (a 65% reduction, matching the spec's "21 → 8" claim — actually 23 currently because of post-M5 additions).

**No placeholders:** every step has actual code, schemas, or commands.

**Backward compat:** JSON-RPC methods unchanged. Only the MCP-facing tool list shrinks. Existing JSON-RPC clients (SDKs already in place, advanced users) keep working.

---

## Execution

Subagent-driven:
- T1 → T7, fresh subagent per task
- Combined spec+code review for T1, T2, T7
- Separate spec then code review for T3, T4, T5 (substantive)
- Continuous execution; no checkpoints
- Tag + merge at end; no push.

Branch: `m23-tool-consolidation` (already cut from main).
