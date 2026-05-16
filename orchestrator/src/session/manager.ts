import { randomUUID } from "node:crypto";
import { Session } from "./session.js";
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
export type SessionFactory = (opts?: { profile?: string; watchBus?: WatchBus; watchSessionId?: string }) => Promise<Session>;

/**
 * Owns the lifecycle of all live sessions. Each session has a unique id
 * (UUID v4). v0 has no eviction or auto-close — leaked ids leak engine
 * processes. v0.3 cloud milestone adds timeouts + LRU.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly factory: SessionFactory,
    /** Optional watch event bus. When present, each new session gets wired to it. */
    private readonly watchBus?: WatchBus
  ) {}

  async create(opts: { profile?: string } = {}): Promise<string> {
    const id = randomUUID();
    const session = await this.factory({
      ...opts,
      watchBus: this.watchBus,
      watchSessionId: id,
    });
    this.sessions.set(id, session);
    return id;
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new SessionNotFoundError(id);
    return s;
  }

  /**
   * Close and remove a session. No-op if the id is unknown (idempotent
   * close — agents may call this defensively).
   */
  async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    await s.close();
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.close(id)));
  }

  activeCount(): number {
    return this.sessions.size;
  }
}
