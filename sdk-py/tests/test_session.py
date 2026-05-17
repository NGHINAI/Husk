from __future__ import annotations
import json
from typing import Callable
import pytest
import httpx
from husk import Husk
from husk._types import RejectionEnvelope, SuccessResult


def make_router(routes: dict[str, Callable]) -> httpx.MockTransport:
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        h = routes.get(body["method"])
        if not h:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "error": {"code": -32601, "message": f"No: {body['method']}"}})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": h(body["params"])})
    return httpx.MockTransport(handler)


def make_husk(routes: dict[str, Callable]) -> Husk:
    client = httpx.AsyncClient(transport=make_router(routes))
    return Husk(base_url="http://x.test", _http_client=client)


async def test_create_session_returns_session_bound_to_id() -> None:
    h = make_husk({"create_session": lambda _: {"session_id": "abc"}})
    async with h:
        s = await h.create_session()
        assert s.id == "abc"


async def test_goto_forwards_params() -> None:
    calls: list[dict] = []
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "goto": lambda p: (calls.append(p), {"ok": True})[1],
    })
    async with h:
        s = await h.create_session()
        await s.goto("https://example.com")
    assert calls[0] == {"session_id": "s1", "url": "https://example.com"}


async def test_snapshot_returns_parsed_snapshot() -> None:
    snap = {"v": 1, "url": "https://x.test", "count": 1, "root": {"i": "r:1", "r": "x", "n": "", "s": []}}
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "snapshot": lambda _: snap,
    })
    async with h:
        s = await h.create_session()
        got = await s.snapshot()
        assert got.v == 1
        assert got.root.i == "r:1"


async def test_click_returns_success_or_rejection() -> None:
    snap_payload = {"v": 1, "url": "", "count": 0, "root": {"i": "x", "r": "x", "n": "", "s": []}}
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "click": lambda p: (
            {"ok": True, "warnings": []}
            if p["stable_id"] == "button:ok"
            else {"ok": False, "reason": "element_not_found", "verb": "click",
                  "stable_id_attempted": p["stable_id"], "candidates": [],
                  "snapshot_at_attempt": snap_payload}
        ),
    })
    async with h:
        s = await h.create_session()
        ok = await s.click("button:ok")
        rej = await s.click("button:ghost")
        assert isinstance(ok, SuccessResult) and ok.ok is True
        assert isinstance(rej, RejectionEnvelope) and rej.reason == "element_not_found"


async def test_type_scroll_press_close_forward_correctly() -> None:
    calls: list[tuple[str, dict]] = []
    routes = {
        "create_session": lambda _: {"session_id": "s1"},
        "type": lambda p: (calls.append(("type", p)), {"ok": True, "warnings": []})[1],
        "scroll": lambda p: (calls.append(("scroll", p)), {"ok": True, "warnings": []})[1],
        "press_key": lambda p: (calls.append(("press_key", p)), {"ok": True, "warnings": []})[1],
        "close_session": lambda p: (calls.append(("close_session", p)), {"ok": True})[1],
    }
    h = make_husk(routes)
    async with h:
        s = await h.create_session()
        await s.type("textbox:e", "hi")
        await s.scroll(None, "down", 300)
        await s.press_key("Enter")
        await s.close()
    assert [c[0] for c in calls] == ["type", "scroll", "press_key", "close_session"]
    assert calls[0][1] == {"session_id": "s1", "stable_id": "textbox:e", "text": "hi"}
    assert calls[1][1] == {"session_id": "s1", "direction": "down", "amount": 300}
    assert calls[2][1] == {"session_id": "s1", "key": "Enter"}


async def test_set_policy_sends_raw_yaml_or_null() -> None:
    calls: list[dict] = []
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "set_policy": lambda p: (calls.append(p), {"ok": True})[1],
    })
    async with h:
        s = await h.create_session()
        await s.set_policy("forbidden: []")
        await s.set_policy(None)
    assert calls[0] == {"session_id": "s1", "policy_yaml": "forbidden: []"}
    assert calls[1] == {"session_id": "s1", "policy_yaml": None}


async def test_health_method() -> None:
    h = make_husk({"health": lambda _: {"ok": True, "version": "0.0.0", "activeSessions": 0}})
    async with h:
        r = await h.health()
    assert r["ok"] is True


async def test_husk_async_context_manager_closes_client() -> None:
    h = make_husk({"health": lambda _: {"ok": True, "version": "0.0.0", "activeSessions": 0}})
    async with h:
        await h.health()
    # Context exits cleanly — test passes if aclose ran without error.
