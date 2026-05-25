import type { AxTreeNode, AxState } from "./predicate.js";

/** Find the first AX node matching role + (optional) name. Case-insensitive on name. */
export function findAxNode(
  root: AxTreeNode | undefined,
  role: string,
  name?: string,
): AxTreeNode | null {
  if (!root) return null;
  const stack: AxTreeNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.r === role) {
      if (name === undefined || n.n.toLowerCase() === name.toLowerCase()) {
        return n;
      }
    }
    if (Array.isArray(n.c)) for (const c of n.c) stack.push(c);
  }
  return null;
}

/** Read the value of a named AX state property. Returns undefined when missing. */
export function readAxState(node: AxTreeNode, stateName: string): unknown {
  const states = node.s as AxState[] | undefined;
  if (!Array.isArray(states)) return undefined;
  const entry = states.find((s) => s?.name === stateName);
  if (!entry) return undefined;
  return entry.value?.value;
}

/** Convenience boolean reader — coerces present-but-non-boolean to true (presence === active). */
export function readAxBool(node: AxTreeNode, stateName: string): boolean {
  const v = readAxState(node, stateName);
  if (v === undefined) return false;
  if (typeof v === "boolean") return v;
  return Boolean(v);
}
