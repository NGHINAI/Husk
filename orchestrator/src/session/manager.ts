import { randomUUID } from "node:crypto";
import { Session } from "./session.js";
import { TabGroup } from "./tab-group.js";
import type { WatchBus } from "../watch/sse.js";

/**
 * Thrown when an operation references a session_id that doesn't exist
 * in the manager (either never created, or already closed).
 */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

/**
 * A factory function the manager uses to create new sessions. In
 * production this is `Session.create.bind(Session, opts)`. In tests we
 * pass a function returning a fake.
 */
export type SessionFactory = (opts?: { profile?: string; watchBus?: WatchBus; watchSessionId?: string; getSiblings?: () => string[] }) => Promise<Session>;

/**
 * Owns the lifecycle of all live sessions. Each session has a unique id
 * (UUID v4). v0 has no eviction or auto-close — leaked ids leak engine
 * processes. v0.3 cloud milestone adds timeouts + LRU.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly tabGroup = new TabGroup();

  constructor(
    private readonly factory: SessionFactory,
    /** Optional watch event bus. When present, each new session gets wired to it. */
    private readonly watchBus?: WatchBus
  ) {}

  async create(opts: { profile?: string; parent_session_id?: string } = {}): Promise<string> {
    const { parent_session_id, profile: explicitProfile, ...rest } = opts;

    // Validate parent exists if specified
    if (parent_session_id !== undefined && !this.sessions.has(parent_session_id)) {
      throw new Error(`unknown parent session: ${parent_session_id}`);
    }

    // Inherit the parent's profile (cookie sharing only works when profile matches)
    let profile = explicitProfile;
    if (parent_session_id !== undefined && profile === undefined) {
      const parentSession = this.sessions.get(parent_session_id)!;
      // Real Session exposes getProfile(); stubs may not — fall back gracefully
      if (typeof (parentSession as unknown as { getProfile?: () => string | null }).getProfile === "function") {
        profile = (parentSession as unknown as { getProfile: () => string | null }).getProfile() ?? undefined;
      }
    }

    const id = randomUUID();

    // Register in tab group before creating session (getSiblings thunk captures id)
    this.tabGroup.register(id, parent_session_id ?? null);

    const getSiblings = () => this.tabGroup.siblings(id);

    const session = await this.factory({
      ...rest,
      profile,
      watchBus: this.watchBus,
      watchSessionId: id,
      getSiblings,
    });

    // Wrap snapshot() so sibling_sessions is always present and always up-to-date.
    // Real Session instances receive getSiblings via factory opts and set the field
    // themselves; for stub sessions in tests (which don't go through Session.create),
    // this wrapper is the only thing that injects sibling_sessions. Wrapping both
    // is harmless — the override wins, giving a single authoritative source.
    // Guard: some test stubs don't expose snapshot() — skip wrapping for those.
    if (typeof (session as unknown as { snapshot?: unknown }).snapshot === "function") {
      const origSnapshot = (session as unknown as { snapshot: (...args: unknown[]) => Promise<unknown> }).snapshot.bind(session);
      (session as unknown as { snapshot: (...args: unknown[]) => Promise<unknown> }).snapshot = async (...args: unknown[]) => {
        const snap = await origSnapshot(...args);
        if (snap && typeof snap === "object") {
          (snap as Record<string, unknown>).sibling_sessions = getSiblings();
        }
        return snap;
      };
    }

    this.sessions.set(id, session);
    return id;
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new SessionNotFoundError(id);
    return s;
  }

  /**
   * Close and remove a session. When closing the root of a tab group, cascade-
   * closes all sibling sessions in the group. When closing a child, only that
   * session is removed. Idempotent for unknown ids.
   */
  async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    // Determine which sessions need to be closed (cascade if root, single if child)
    const toClose = this.tabGroup.closeGroup(id);
    // Close all affected sessions
    await Promise.all(
      toClose.map(async (sid) => {
        const sess = this.sessions.get(sid);
        if (sess) {
          this.sessions.delete(sid);
          await sess.close();
        }
      })
    );
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.close(id)));
  }

  activeCount(): number {
    return this.sessions.size;
  }
}
