"""Husk — open-source browser engine for AI agents (Python SDK)."""
from __future__ import annotations

from typing import Any, Optional

import httpx

from ._session import Session, ScrollDirection
from ._snapshot import find_in_snapshot, find_all_in_snapshot
from ._transport import JsonRpcClient, JsonRpcTransportError, HuskApiError
from ._types import (
    ActionResult,
    Candidate,
    Cookie,
    Evidence,
    Outcome,
    RejectionEnvelope,
    Snapshot,
    SnapshotDiff,
    SnapshotNode,
    SuccessResult,
    Warning_ as Warning,
    parse_action_result,
    parse_cookie,
    parse_snapshot,
)
from ._credentials import CredentialsApi
from ._vault import VaultApi


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
        self.vault = VaultApi(self._client)
        self.credentials = CredentialsApi(self._client)

    async def create_session(
        self,
        *,
        profile: Optional[str] = None,
        parent_session_id: Optional[str] = None,
        engine: Optional[str] = None,  # "lightpanda" | "chrome" | "auto"
    ) -> Session:
        params: dict[str, Any] = {}
        if profile is not None:
            params["profile"] = profile
        if parent_session_id is not None:
            params["parent_session_id"] = parent_session_id
        if engine is not None:
            params["engine"] = engine
        r = await self._client.call("create_session", params)
        session = Session(self._client, r["session_id"])
        session.watch_url = r.get("watch_url")
        return session

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
    "Cookie",
    "Evidence",
    "Outcome",
    "VaultApi",
    "CredentialsApi",
    "JsonRpcTransportError",
    "HuskApiError",
    "parse_snapshot",
    "parse_action_result",
    "parse_cookie",
    "find_in_snapshot",
    "find_all_in_snapshot",
    "__version__",
    "DEFAULT_BASE_URL",
]
