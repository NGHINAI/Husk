from __future__ import annotations
import re
import pytest
from husk import find_in_snapshot, find_all_in_snapshot
from husk._types import parse_snapshot


SNAP = parse_snapshot({
    "v": 1, "url": "https://x.test", "count": 4,
    "root": {
        "i": "RootWebArea:r", "r": "RootWebArea", "n": "Page", "s": ["v"],
        "c": [
            {"i": "heading:h", "r": "heading", "n": "Hello Husk", "s": ["v"]},
            {"i": "button:submit", "r": "button", "n": "Submit Application", "s": ["v", "e"]},
            {"i": "button:disabled", "r": "button", "n": "Disabled Button", "s": ["v", "d"]},
            {"i": "textbox:email", "r": "textbox", "n": "Email", "s": ["v", "e"]},
        ],
    },
})


def test_find_by_role_and_name_regex() -> None:
    hit = find_in_snapshot(SNAP, role="button", name_matches=re.compile("submit", re.IGNORECASE))
    assert hit is not None and hit.i == "button:submit"


def test_find_returns_none_on_no_match() -> None:
    assert find_in_snapshot(SNAP, role="link") is None


def test_find_by_substring() -> None:
    hit = find_in_snapshot(SNAP, name="hello")
    assert hit is not None and hit.i == "heading:h"


def test_find_all_returns_in_document_order() -> None:
    all_ = find_all_in_snapshot(SNAP, role="button")
    assert [n.i for n in all_] == ["button:submit", "button:disabled"]


def test_find_without_role_matches_by_name_only() -> None:
    hit = find_in_snapshot(SNAP, name_matches=re.compile("email", re.IGNORECASE))
    assert hit is not None and hit.i == "textbox:email"
