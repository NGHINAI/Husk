# Husk M24 — v0.1.1 Patch: Session Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Close the LinkedIn-loop gap that real-world testing exposed. Today: handoff captures cookies → session memory → lost on close. Patch: cookies auto-persist to the encrypted vault when a profile is set, so "log in once, use forever" works.

**Architecture:** All primitives exist (M8a vault, M16 handoff cookie sync). Patch wires three missing hooks: explicit `vault_save` JSON-RPC method, auto-save after handoff, auto-save on close. Plus auto-route known-rich sites to Chrome so LinkedIn-style flows don't half-run on lightpanda.

**Scope:** 6 tasks. Backward-compatible. No new tables, no SDK breaking changes.

---

## Tasks

### Task 1 — `vault_save` JSON-RPC method

**Model:** Haiku.

**Files:**
- Modify: `orchestrator/src/http/methods.ts` — add `vault_save({session_id})` that calls `session.captureToVault()`.
- Test: `orchestrator/tests/http/vault-save.test.ts` — 3 tests.

```typescript
// In methods.ts
async vault_save(params: { session_id: string }, ctx: MethodContext) {
  const session = ctx.sessions.get(params.session_id);
  if (!session) throw new Error(`session not found: ${params.session_id}`);
  const profile = session.getProfile();
  if (!profile) {
    return { saved: false, reason: "session has no profile attached" };
  }
  await session.captureToVault();
  const cookies = ctx.vault.list(profile);
  return { saved: true, profile, cookie_count: cookies.length };
}
```

**Tests:**
1. With profile set + cookies in session → vault_save returns `{saved: true, cookie_count: N}`
2. With no profile set → returns `{saved: false, reason}`
3. Bogus session_id → throws

**Commit:** `feat(vault): vault_save JSON-RPC method (manual capture-to-vault)`

---

### Task 2 — Auto-save on Session.close + after handoff

**Model:** Haiku.

**Files:**
- Modify: `orchestrator/src/session/session.ts` — `close()` calls `captureToVault()` when profile is set (best-effort, never throws).
- Modify: `orchestrator/src/handoff/seamless-orchestrator.ts` — after `syncCookies` completes successfully, if the session has a profile set, call `captureToVault()`.
- Test: `orchestrator/tests/session/auto-save.test.ts` — 4 tests.

**Implementation:**

In `Session.close()`:
```typescript
async close(): Promise<void> {
  if (this.vault && this.profile) {
    try { await this.captureToVault(); } catch { /* never fail close on save error */ }
  }
  // … existing close logic …
}
```

In `seamless-orchestrator.ts`, after `cookies_imported = await syncCookies(...)`:
```typescript
if (cookies_imported > 0 && session.getProfile()) {
  try { await session.captureToVault(); } catch { /* best-effort */ }
}
```

**Tests:**
1. `Session.close()` with profile set + cookies → vault has the cookies after close
2. `Session.close()` without profile → no save, no error
3. `Session.close()` with vault save erroring → close still succeeds
4. After seamless handoff → vault has imported cookies (use stub seamless flow)

**Commit:** `feat(vault): auto-save on Session.close + after handoff cookie sync`

---

### Task 3 — `husk_session({action: "save_profile"})` + `profile` on create

**Model:** Haiku.

**Files:**
- Modify: `mcp/src/tool-surface.ts` — add `save_profile` to the action enum + dispatch; ensure `profile` field is documented on `action: "create"`.
- Test: `mcp/tests/session-tool.test.ts` — 2 new tests.

**Schema additions** to husk_session's inputSchema.properties:
```typescript
// Already present (verify): profile_name field for clear_vault.
// Add explicit "profile" field for create + save_profile actions.
profile: { type: "string", description: "Named vault profile. Set on create to restore; required for save_profile." },
```

**Action enum:** add `"save_profile"`.

**Dispatch:**
```typescript
case "save_profile":
  return await client.call("vault_save", { session_id: args.session_id });
case "create":
  return await client.call("create_session", {
    profile: args.profile,            // ← thread through
    capability: args.capability,
    engine: args.engine,
    watch_url: args.watch_url,
    parent_session_id: args.parent_session_id,
  });
```

Verify by reading current husk_session dispatch in tool-surface.ts — `profile` may or may not be threaded already; if it is, just add save_profile.

**Tests:**
1. `action: "save_profile"` routes to `vault_save` RPC.
2. `action: "create"` with `profile: "linkedin"` calls create_session with profile.

**Commit:** `feat(mcp): husk_session save_profile action + profile field on create`

---

### Task 4 — Auto-route known-rich sites to Chrome

**Model:** Sonnet.

**Files:**
- Modify: `orchestrator/src/http/methods.ts` — in `create_session`, when `engine` is unset or `"auto"` AND the call carries a hint URL (none yet — see below), resolve engine via `KNOWN_RICH_SITES`. Alternatively, do this in `goto()` after the first navigation.
- Modify: `orchestrator/src/session/session.ts` — `goto()` checks if URL hostname is in `KNOWN_RICH_SITES` AND current engine is lightpanda → triggers M17's existing fallback to swap to chrome BEFORE attempting the goto on lightpanda.
- Test: `orchestrator/tests/session/auto-chrome-routing.test.ts` — 4 tests.

**The simpler hook:** modify `Session.goto(url)`:

```typescript
async goto(url: string): Promise<void> {
  // NEW: pre-flight check
  if (this.engineHandle.kind === "lightpanda") {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "");
      if (KNOWN_RICH_SITES.has(host) || [...KNOWN_RICH_SITES].some(s => host.endsWith("." + s))) {
        // Swap engine BEFORE navigation
        await this.swapEngine("chrome");
      }
    } catch { /* malformed URL — let the actual goto throw cleanly */ }
  }
  // … existing goto logic …
}
```

The `swapEngine` infrastructure already exists from M17 T5 (`engine/fallback.ts`). Confirm by reading session.ts and fallback.ts — the existing M17 fallback runs AFTER navigation when page-health detects a problem. T4 adds a pre-flight check that uses the same swap mechanism.

**Tests:**
1. goto("https://linkedin.com/...") on lightpanda → engine swaps to chrome BEFORE navigation
2. goto("https://example.com") (not in rich list) → no swap
3. goto on a session already on chrome → no-op (no swap)
4. goto with malformed URL → no swap (graceful), original error propagates

Use stub engine handles to verify the swap was called.

**Commit:** `feat(engine): pre-flight chrome routing for KNOWN_RICH_SITES`

---

### Task 5 — Real-lightpanda + chrome e2e

**Model:** Sonnet.

**File:** Create `orchestrator/tests/integration/session-persistence.test.ts`.

**Skip when LIGHTPANDA_BIN unset.**

**Test cases:**
1. **Auto-save on close** — create session with profile "test_profile", set cookies via importCookies, close session, open a new session with the same profile, verify cookies present.
2. **vault_save explicit** — same setup, call vault_save mid-session, then close abruptly (kill engine), open new session, verify cookies persisted.
3. **Auto-chrome routing** — `create_session({engine: "auto"})` then `goto("https://linkedin.com/")` → assert session is now on chrome (or assert no rendering error vs the comparison goto on a non-rich site).

For test 3, "chrome required" can be checked via `session.engineKind()` or similar accessor — read session.ts to find the right method.

**Commit:** `test(integration): session persistence + auto-chrome routing e2e`

---

### Task 6 — Docs + tag + merge

**Model:** Haiku.

**Spec amendment:** Append to v0.1 design doc Implementation Progress section:

```markdown

### v0.1.1 Patch — Session Persistence (M24 — shipped 2026-05-25)

Real-world LinkedIn testing exposed two gaps in the v0.1 surface:
1. Cookies captured via seamless handoff lived in session memory only — lost on close.
2. Known-rich sites (LinkedIn, etc.) needed explicit `engine: "chrome"` on session create, instead of auto-routing.

Patched:
- `vault_save` JSON-RPC method (manual capture-to-vault)
- Auto-save on Session.close when profile is set (best-effort, never breaks close)
- Auto-save after seamless handoff cookie sync (best-effort)
- `husk_session({action: "save_profile"})` MCP action + explicit `profile` field on `action: "create"`
- Pre-flight chrome routing in `Session.goto()` — when navigating to a KNOWN_RICH_SITES host on lightpanda, swap to chrome BEFORE the navigation

**Result:** "Log in once, use forever" works end-to-end. After a seamless handoff, cookies persist to the encrypted vault and rehydrate on the next session creation with the same profile.

**MCP surface unchanged at 8 tools** — `save_profile` is an action discriminator on the existing husk_session tool.
```

**Memory updates:** husk-roadmap.md adds `v0.0.23-m24 — Session Persistence patch`. husk-architecture.md gets a short patch-note subsection. husk-overview.md updates the status line.

**Tag + merge:**
```bash
git tag -a v0.0.23-m24 -m "M24: v0.1.1 patch — Session Persistence

- vault_save JSON-RPC method
- Auto-save on Session.close + after handoff
- husk_session save_profile action + profile on create
- Pre-flight chrome routing for KNOWN_RICH_SITES (linkedin.com etc.)

Closes the 'log in once, never log in again' loop exposed by real-world LinkedIn testing."

git checkout main
git merge --no-ff m24-session-persistence -m "Merge Milestone 24 (v0.1.1 patch: Session Persistence)"
```

DO NOT push (user controls push timing).

**Commit:** `docs(spec): M24 v0.1.1 session persistence patch shipped`

---

## Self-review

- Backward-compatible? Yes — every new method/field is additive.
- MCP tool count stays at 8? Yes — save_profile is an action on husk_session.
- Test coverage hits both the persistence path AND the auto-routing path? Yes (T5).
- LinkedIn end-to-end loop closes? Yes — first session does handoff + auto-save → next session restores cookies → goto auto-routes to chrome.

---

## Execution

Subagent-driven. Continuous. No checkpoints. Branch `m24-session-persistence` (already cut).
