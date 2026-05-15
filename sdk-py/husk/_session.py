"""Per-session async API for Husk."""
from __future__ import annotations

from typing import Any, Literal, Optional

from ._transport import JsonRpcClient
from ._types import ActionResult, Snapshot, parse_action_result, parse_snapshot


ScrollDirection = Literal["up", "down", "left", "right", "into_view"]


class Session:
    """One Husk session. Use via Husk.create_session()."""

    def __init__(self, client: JsonRpcClient, session_id: str) -> None:
        self._client = client
        self._id = session_id

    @property
    def id(self) -> str:
        return self._id

    async def goto(self, url: str) -> None:
        await self._client.call("goto", {"session_id": self._id, "url": url})

    async def snapshot(self) -> Snapshot:
        raw = await self._client.call("snapshot", {"session_id": self._id})
        return parse_snapshot(raw)

    async def click(self, stable_id: str) -> ActionResult:
        raw = await self._client.call("click", {"session_id": self._id, "stable_id": stable_id})
        return parse_action_result(raw)

    async def type(self, stable_id: str, text: str) -> ActionResult:
        raw = await self._client.call("type", {"session_id": self._id, "stable_id": stable_id, "text": text})
        return parse_action_result(raw)

    async def scroll(self, stable_id: Optional[str], direction: ScrollDirection, amount: int) -> ActionResult:
        raw = await self._client.call(
            "scroll",
            {"session_id": self._id, "stable_id": stable_id, "direction": direction, "amount": amount},
        )
        return parse_action_result(raw)

    async def press_key(self, key: str) -> ActionResult:
        raw = await self._client.call("press_key", {"session_id": self._id, "key": key})
        return parse_action_result(raw)

    async def set_policy(self, policy_yaml: Optional[str]) -> None:
        await self._client.call("set_policy", {"session_id": self._id, "policy_yaml": policy_yaml})

    async def login(
        self,
        *,
        profile: Optional[str] = None,
        key: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        totp_secret: Optional[str] = None,
    ) -> dict[str, Any]:
        """Log into a website. Two modes:

        - Inline (ephemeral): pass ``username`` + ``password`` (and optional
          ``totp_secret``) directly. Credentials are not persisted.
        - Stored lookup: pass ``profile`` + ``key`` to read previously-stored
          credentials from the credentials vault.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if username is not None and password is not None:
            params["username"] = username
            params["password"] = password
            if totp_secret is not None:
                params["totp_secret"] = totp_secret
        elif profile is not None and key is not None:
            params["profile"] = profile
            params["key"] = key
        else:
            raise ValueError(
                "Session.login requires either (username, password) "
                "or (profile, key)"
            )
        return await self._client.call("login", params)

    async def close(self) -> None:
        await self._client.call("close_session", {"session_id": self._id})
