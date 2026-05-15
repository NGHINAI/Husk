from __future__ import annotations
import json
from typing import Callable
import pytest
import httpx
from husk import Husk
from husk._types import Cookie


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


async def test_create_session_forwards_profile() -> None:
    captured: dict = {}
    h = make_husk({
        "create_session": lambda p: (captured.update(p), {"session_id": "s1"})[1],
    })
    async with h:
        await h.create_session(profile="work")
    assert captured == {"profile": "work"}


async def test_create_session_no_profile() -> None:
    captured: dict = {}
    h = make_husk({
        "create_session": lambda p: (captured.update({"params": p}), {"session_id": "s1"})[1],
    })
    async with h:
        await h.create_session()
    assert captured["params"] == {}


async def test_vault_list_profiles() -> None:
    h = make_husk({
        "vault_list_profiles": lambda _: {"profiles": ["default", "work"]},
    })
    async with h:
        got = await h.vault.list_profiles()
    assert got == ["default", "work"]


async def test_vault_list_cookies_returns_cookie_dataclass() -> None:
    h = make_husk({
        "vault_list_cookies": lambda _: {"cookies": [
            {"name": "sid", "value": "x", "domain": "ex.test", "path": "/",
             "expires": -1, "size": 3, "httpOnly": False, "secure": False, "session": True,
             "sameSite": "Lax"}
        ]},
    })
    async with h:
        got = await h.vault.list_cookies("default")
    assert len(got) == 1
    assert isinstance(got[0], Cookie)
    assert got[0].name == "sid"
    assert got[0].same_site == "Lax"


async def test_vault_clear() -> None:
    calls: list[dict] = []
    h = make_husk({
        "vault_clear": lambda p: (calls.append(p), {"ok": True})[1],
    })
    async with h:
        await h.vault.clear("work")
    assert calls[0] == {"profile": "work"}
