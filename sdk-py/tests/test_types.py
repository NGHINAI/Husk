"""Wire-type round-trip tests."""
from __future__ import annotations
import pytest
from husk._types import (
    Snapshot,
    SnapshotNode,
    RejectionEnvelope,
    parse_action_result,
    parse_snapshot,
)


def test_snapshot_parses_basic_payload() -> None:
    payload = {
        "v": 1,
        "url": "https://x.test",
        "count": 1,
        "root": {"i": "RootWebArea:r", "r": "RootWebArea", "n": "Page", "s": ["v"]},
    }
    snap = parse_snapshot(payload)
    assert snap.v == 1
    assert snap.root.i == "RootWebArea:r"
    assert snap.root.s == ("v",)
    assert snap.root.c == ()


def test_snapshot_walks_nested_children() -> None:
    payload = {
        "v": 1, "url": "", "count": 2,
        "root": {
            "i": "r:1", "r": "r", "n": "", "s": [],
            "c": [{"i": "b:1", "r": "button", "n": "OK", "s": ["v", "e"]}],
        },
    }
    snap = parse_snapshot(payload)
    assert len(snap.root.c) == 1
    assert snap.root.c[0].r == "button"


def test_parse_action_result_success_path() -> None:
    r = parse_action_result({"ok": True, "warnings": []})
    assert r.ok is True
    assert r.warnings == ()


def test_parse_action_result_rejection_path() -> None:
    payload = {
        "ok": False, "reason": "element_not_found", "verb": "click",
        "stable_id_attempted": "button:ghost", "candidates": [],
        "snapshot_at_attempt": {
            "v": 1, "url": "", "count": 0,
            "root": {"i": "x", "r": "x", "n": "", "s": []},
        },
    }
    r = parse_action_result(payload)
    assert r.ok is False
    assert isinstance(r, RejectionEnvelope)
    assert r.reason == "element_not_found"
    assert r.candidates == ()
