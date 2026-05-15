/**
 * Map from snapshot stable_id to the backing CDP `backendDOMNodeId`.
 * Used by action primitives to resolve a stable_id to DOM coordinates
 * without re-walking the AX tree.
 */
export class SelectorResolver {
  private readonly map = new Map<string, number>();

  set(stableId: string, backendNodeId: number): void {
    this.map.set(stableId, backendNodeId);
  }

  get(stableId: string): number | undefined {
    return this.map.get(stableId);
  }

  has(stableId: string): boolean {
    return this.map.has(stableId);
  }

  size(): number {
    return this.map.size;
  }
}
