"""JSON-RPC 2.0 client over HTTP for Husk SDK."""
from __future__ import annotations

import itertools
import json
from typing import Any, Mapping, Optional

import httpx


class JsonRpcTransportError(Exception):
    """Raised when the HTTP transport itself fails (non-200, bad JSON, etc.)."""


class HuskApiError(Exception):
    """Raised when the server returns a JSON-RPC error envelope."""

    def __init__(self, message: str, code: int, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


class JsonRpcClient:
    """Async JSON-RPC client. Reusable across many calls."""

    def __init__(
        self,
        base_url: str,
        *,
        http_client: Optional[httpx.AsyncClient] = None,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(timeout=timeout)
        self._ids = itertools.count(1)

    async def call(self, method: str, params: Mapping[str, Any]) -> Any:
        rpc_id = next(self._ids)
        url = f"{self._base_url}/v1/jsonrpc"
        try:
            res = await self._client.post(
                url,
                json={"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params},
            )
        except httpx.HTTPError as e:
            raise JsonRpcTransportError(f"HTTP transport failed: {e}") from e
        if res.status_code != 200:
            raise JsonRpcTransportError(f"HTTP {res.status_code} from {url}")
        try:
            body = res.json()
        except json.JSONDecodeError as e:
            raise JsonRpcTransportError("Response body was not valid JSON") from e
        if "error" in body:
            err = body["error"]
            raise HuskApiError(err["message"], err["code"], err.get("data"))
        return body["result"]

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> "JsonRpcClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()
