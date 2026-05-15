"""Snapshot tree-walk helpers."""
from __future__ import annotations

from typing import Optional, Pattern

from ._types import Snapshot, SnapshotNode


def _matches(
    node: SnapshotNode,
    *,
    role: Optional[str],
    name: Optional[str],
    name_matches: Optional[Pattern[str]],
) -> bool:
    if role is not None and node.r != role:
        return False
    if name is not None and name.lower() not in node.n.lower():
        return False
    if name_matches is not None and not name_matches.search(node.n):
        return False
    return True


def find_in_snapshot(
    snapshot: Snapshot,
    *,
    role: Optional[str] = None,
    name: Optional[str] = None,
    name_matches: Optional[Pattern[str]] = None,
) -> Optional[SnapshotNode]:
    """Depth-first; returns the first matching node or None."""
    return _walk_find(snapshot.root, role=role, name=name, name_matches=name_matches)


def _walk_find(
    node: SnapshotNode,
    *,
    role: Optional[str],
    name: Optional[str],
    name_matches: Optional[Pattern[str]],
) -> Optional[SnapshotNode]:
    if _matches(node, role=role, name=name, name_matches=name_matches):
        return node
    for child in node.c:
        hit = _walk_find(child, role=role, name=name, name_matches=name_matches)
        if hit is not None:
            return hit
    return None


def find_all_in_snapshot(
    snapshot: Snapshot,
    *,
    role: Optional[str] = None,
    name: Optional[str] = None,
    name_matches: Optional[Pattern[str]] = None,
) -> list[SnapshotNode]:
    """Depth-first; returns all matching nodes in document order."""
    out: list[SnapshotNode] = []
    _walk_all(snapshot.root, out, role=role, name=name, name_matches=name_matches)
    return out


def _walk_all(
    node: SnapshotNode,
    out: list[SnapshotNode],
    *,
    role: Optional[str],
    name: Optional[str],
    name_matches: Optional[Pattern[str]],
) -> None:
    if _matches(node, role=role, name=name, name_matches=name_matches):
        out.append(node)
    for child in node.c:
        _walk_all(child, out, role=role, name=name, name_matches=name_matches)
