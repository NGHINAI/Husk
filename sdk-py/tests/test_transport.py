from __future__ import annotations
import json
import pytest
import httpx
from husk._transport import JsonRpcClient, JsonRpcTransportError, HuskApiError


@pytest.mark.asyncio
async def test_call_returns_result_on_success() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": body["id"], "result": {"ok": True, "version": "0.0.0", "activeSessions": 0}},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        r = await rpc.call("health", {})
        assert r["ok"] is True


@pytest.mark.asyncio
async def test_call_increments_request_ids() -> None:
    ids: list[int] = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        ids.append(body["id"])
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": None})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        await rpc.call("health", {})
        await rpc.call("health", {})
    assert ids[0] != ids[1]


@pytest.mark.asyncio
async def test_call_raises_transport_error_on_500() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"oops")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        with pytest.raises(JsonRpcTransportError):
            await rpc.call("health", {})


@pytest.mark.asyncio
async def test_call_raises_husk_api_error_on_error_envelope() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32001, "message": "Session not found: x"}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        with pytest.raises(HuskApiError) as e:
            await rpc.call("goto", {})
        assert "Session not found" in str(e.value)
        assert e.value.code == -32001


@pytest.mark.asyncio
async def test_strips_trailing_slash_in_base_url() -> None:
    seen_urls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen_urls.append(str(req.url))
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": None})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test/", http_client=client)
        await rpc.call("health", {})
    assert seen_urls[0] == "http://x.test/v1/jsonrpc"


@pytest.mark.asyncio
async def test_call_raises_transport_error_on_invalid_json() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rpc = JsonRpcClient(base_url="http://x.test", http_client=client)
        with pytest.raises(JsonRpcTransportError):
            await rpc.call("health", {})
