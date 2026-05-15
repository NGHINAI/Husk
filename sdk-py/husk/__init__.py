"""Husk — open-source browser engine for AI agents (Python SDK)."""
from __future__ import annotations

from typing import Any, Optional

import httpx

from ._session import Session, ScrollDirection
from ._transport import JsonRpcClient, JsonRpcTransportError, HuskApiError
from ._types import (
    ActionResult,
    Candidate,
    RejectionEnvelope,
    Snapshot,
    SnapshotDiff,
    SnapshotNode,
    SuccessResult,
    Warning_ as Warning,
    parse_action_result,
    parse_snapshot,
)


__version__ = "0.0.0"
DEFAULT_BASE_URL = "http://localhost:7777"


class Husk:
    """Husk SDK client.

    >>> async with Husk(base_url="http://localhost:7777") as h:
    ...     s = await h.create_session()
    ...     await s.goto("https://example.com")
    ...     snap = await s.snapshot()
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        _http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.base_url = base_url
        self._client = JsonRpcClient(base_url=base_url, http_client=_http_client)

    async def create_session(self) -> Session:
        r = await self._client.call("create_session", {})
        return Session(self._client, r["session_id"])

    async def health(self) -> dict[str, Any]:
        return await self._client.call("health", {})

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "Husk":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()


__all__ = [
    "Husk",
    "Session",
    "ScrollDirection",
    "Snapshot",
    "SnapshotNode",
    "SnapshotDiff",
    "ActionResult",
    "SuccessResult",
    "RejectionEnvelope",
    "Warning",
    "Candidate",
    "JsonRpcTransportError",
    "HuskApiError",
    "parse_snapshot",
    "parse_action_result",
    "__version__",
    "DEFAULT_BASE_URL",
]
