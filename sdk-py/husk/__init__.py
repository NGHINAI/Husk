"""Husk — open-source browser engine for AI agents (Python SDK)."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Optional

import httpx

from ._session import Session, ScrollDirection
from ._snapshot import find_in_snapshot, find_all_in_snapshot
from ._transport import JsonRpcClient, JsonRpcTransportError, HuskApiError
from ._types import (
    ActionResult,
    Candidate,
    CognitionEvent,
    Cookie,
    EventType,
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

    async def subscribe(
        self,
        event_type: EventType,
        *,
        session_id: Optional[str] = None,
        site: Optional[str] = None,
        debounce_ms: Optional[int] = None,
    ) -> AsyncIterator[CognitionEvent]:
        """Subscribe to orchestrator cognition events over SSE.

        Yields :class:`CognitionEvent` dicts as they arrive from the
        ``/stream/cognition`` SSE endpoint. Calls the server-side
        ``unsubscribe`` JSON-RPC method in a ``try/finally`` block when the
        async generator is closed (normal exit, break, or exception).

        Usage::

            async for event in await husk.subscribe("state_change", session_id=s_id):
                print(event["type"], event["payload"])
        """
        return self._subscribe_gen(
            event_type,
            session_id=session_id,
            site=site,
            debounce_ms=debounce_ms,
        )

    async def _subscribe_gen(
        self,
        event_type: EventType,
        *,
        session_id: Optional[str] = None,
        site: Optional[str] = None,
        debounce_ms: Optional[int] = None,
    ) -> AsyncIterator[CognitionEvent]:
        params: dict[str, Any] = {"event_type": event_type}
        if session_id is not None:
            params["session_id"] = session_id
        if site is not None:
            params["site"] = site
        if debounce_ms is not None:
            params["debounce_ms"] = debounce_ms

        resp = await self._client.call("subscribe", params)
        subscription_id: str = resp["subscription_id"]
        stream_url = f"{self._client._base_url.rstrip('/')}{resp['stream_url']}"

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("GET", stream_url) as r:
                    async for line in r.aiter_lines():
                        if line.startswith("data: "):
                            try:
                                yield json.loads(line[6:])  # type: ignore[misc]
                            except json.JSONDecodeError:
                                continue
        finally:
            try:
                await self._client.call("unsubscribe", {"subscription_id": subscription_id})
            except Exception:  # noqa: BLE001
                pass

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
    "CognitionEvent",
    "EventType",
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
