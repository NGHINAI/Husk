/**
 * Tracks parent/child relationships between sessions. A "tab group" is the set
 * of all sessions sharing a common root. Sessions in a group share a cookie
 * profile but NOT JS/DOM state (each is its own engine process).
 *
 * Cookie sharing: in v1 this only works when the parent was created with an
 * explicit `profile` name (which routes through the VaultStore). If the parent
 * has no profile, siblings each get isolated cookie jars — that's a lightpanda
 * limitation, not a Husk bug. The cookie vault will address this in a later
 * milestone.
 */
export class TabGroup {
  /** session_id → root_id (the group's identifier; root maps to itself) */
  private rootOf = new Map<string, string>();
  /** root_id → set of all member session_ids in that group */
  private members = new Map<string, Set<string>>();

  /**
   * Register a session. Pass null for parent_session_id to start a new group
   * with this session as root; pass an existing session_id to join its group.
   */
  register(sessionId: string, parentSessionId: string | null): void {
    if (parentSessionId === null) {
      this.rootOf.set(sessionId, sessionId);
      this.members.set(sessionId, new Set([sessionId]));
      return;
    }
    const root = this.rootOf.get(parentSessionId);
    if (!root) throw new Error(`unknown parent session: ${parentSessionId}`);
    this.rootOf.set(sessionId, root);
    this.members.get(root)!.add(sessionId);
  }

  /** All other session ids in the same group as `sessionId`. */
  siblings(sessionId: string): string[] {
    const root = this.rootOf.get(sessionId);
    if (!root) return [];
    return [...this.members.get(root)!].filter((id) => id !== sessionId);
  }

  /**
   * Close semantics:
   *   - Closing the root: cascade — returns ALL session ids in the group;
   *     caller must close them all. Group state is torn down.
   *   - Closing a non-root: only that session — returns [sessionId]; group
   *     stays alive with remaining siblings.
   *   - Closing an unregistered session: idempotent, returns [sessionId].
   */
  closeGroup(sessionId: string): string[] {
    const root = this.rootOf.get(sessionId);
    if (!root) return [sessionId];
    if (root === sessionId) {
      const ids = [...this.members.get(root)!];
      for (const id of ids) this.rootOf.delete(id);
      this.members.delete(root);
      return ids;
    }
    this.members.get(root)!.delete(sessionId);
    this.rootOf.delete(sessionId);
    return [sessionId];
  }
}
