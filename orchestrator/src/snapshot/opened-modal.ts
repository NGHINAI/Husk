import type { SnapshotNode } from "./types.js";

const MODAL_ROLES = new Set(["dialog", "alertdialog", "menu"]);

export interface OpenedModal {
  stable_id: string;
  role: "dialog" | "alertdialog" | "menu";
  title: string | null;
  buttons: Array<{ stable_id: string; name: string }>;
}

/**
 * Detect if the post-action snapshot contains a newly-visible modal that the
 * agent must address. We look at ANY modal in the current snapshot — the diff
 * isn't reliable here because LinkedIn-style overlays often appear via JS that
 * doesn't fire the AX tree's mutation hooks consistently.
 *
 * Returns the first modal found (highest in tree-walk order). Returns null if
 * no modal is open.
 */
export function detectOpenedModal(snapshot: { root?: SnapshotNode }): OpenedModal | null {
  if (!snapshot.root) return null;
  const modal = findFirstModal(snapshot.root);
  if (!modal) return null;
  return {
    stable_id: modal.i,
    role: modal.r as "dialog" | "alertdialog" | "menu",
    title: extractModalTitle(modal),
    buttons: collectButtons(modal),
  };
}

function findFirstModal(node: SnapshotNode): SnapshotNode | null {
  if (MODAL_ROLES.has(node.r)) return node;
  if (!node.c) return null;
  for (const child of node.c) {
    const found = findFirstModal(child);
    if (found) return found;
  }
  return null;
}

function extractModalTitle(modal: SnapshotNode): string | null {
  // Prefer the dialog's own accessible name (n field)
  if (modal.n && modal.n.trim()) return modal.n.trim();
  // Otherwise look for a heading child
  if (modal.c) {
    for (const child of modal.c) {
      if (child.r === "heading" && child.n) return child.n.trim();
    }
  }
  return null;
}

function collectButtons(node: SnapshotNode): Array<{ stable_id: string; name: string }> {
  const buttons: Array<{ stable_id: string; name: string }> = [];
  const walk = (n: SnapshotNode): void => {
    if ((n.r === "button" || n.r === "link") && n.n && n.n.trim()) {
      buttons.push({ stable_id: n.i, name: n.n.trim() });
    }
    if (n.c) for (const child of n.c) walk(child);
  };
  if (node.c) for (const child of node.c) walk(child);
  return buttons;
}
