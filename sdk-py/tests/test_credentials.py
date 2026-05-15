from __future__ import annotations
import json
from typing import Callable
import pytest
import httpx
from husk import Husk


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


async def test_credentials_set_forwards_all_fields() -> None:
    captured: list[dict] = []
    h = make_husk({"credentials_set": lambda p: (captured.append(p), {"ok": True})[1]})
    async with h:
        await h.credentials.set("default", key="github.com", username="demo", password="secret", totp_secret="ABCD1234")
    assert captured[0] == {"profile": "default", "key": "github.com", "username": "demo", "password": "secret", "totp_secret": "ABCD1234"}


async def test_credentials_set_omits_totp_when_unspecified() -> None:
    captured: list[dict] = []
    h = make_husk({"credentials_set": lambda p: (captured.append(p), {"ok": True})[1]})
    async with h:
        await h.credentials.set("default", key="github.com", username="demo", password="secret")
    assert captured[0].get("totp_secret") is None


async def test_credentials_list() -> None:
    h = make_husk({"credentials_list": lambda _: {"credentials": [{"key": "a", "username": "ua"}, {"key": "b", "username": "ub"}]}})
    async with h:
        got = await h.credentials.list("default")
    assert [c["key"] for c in got] == ["a", "b"]


async def test_credentials_remove() -> None:
    captured: list[dict] = []
    h = make_husk({"credentials_remove": lambda p: (captured.append(p), {"ok": True})[1]})
    async with h:
        await h.credentials.remove("default", "github.com")
    assert captured[0] == {"profile": "default", "key": "github.com"}


async def test_session_login_success() -> None:
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "login": lambda _: {"ok": True, "url_before": "https://x/login", "url_after": "https://x/dash"},
    })
    async with h:
        s = await h.create_session()
        r = await s.login(profile="default", key="github.com")
    assert r["ok"] is True
    assert r["url_after"] == "https://x/dash"


async def test_session_login_credential_not_found() -> None:
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "login": lambda _: {"ok": False, "reason": "credential_not_found", "key": "missing"},
    })
    async with h:
        s = await h.create_session()
        r = await s.login(profile="default", key="missing")
    assert r["ok"] is False
    assert r["reason"] == "credential_not_found"
