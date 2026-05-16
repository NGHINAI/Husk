"""Per-session async API for Husk."""
from __future__ import annotations

from typing import Any, Literal, Optional

from ._transport import JsonRpcClient
from ._types import ActionResult, Snapshot, parse_action_result, parse_snapshot

WaitForResult = dict[str, Any]


ScrollDirection = Literal["up", "down", "left", "right", "into_view"]


class Session:
    """One Husk session. Use via Husk.create_session()."""

    def __init__(self, client: JsonRpcClient, session_id: str) -> None:
        self._client = client
        self._id = session_id
        self.watch_url: Optional[str] = None

    @property
    def id(self) -> str:
        return self._id

    async def goto(self, url: str) -> None:
        await self._client.call("goto", {"session_id": self._id, "url": url})

    async def snapshot(self) -> Snapshot:
        raw = await self._client.call("snapshot", {"session_id": self._id})
        return parse_snapshot(raw)

    async def click(
        self,
        stable_id: Optional[str] = None,
        *,
        intent: Optional[str] = None,
    ) -> ActionResult:
        """Click an element. Pass either ``stable_id`` (exact, from snapshot) or
        ``intent`` (natural language, e.g. ``"sign in button"``).

        On ambiguous intent returns ``{ok: False, reason: "ambiguous_intent"}``.
        On no match returns ``{ok: False, reason: "no_match"}``.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if stable_id is not None:
            params["stable_id"] = stable_id
        if intent is not None:
            params["intent"] = intent
        raw = await self._client.call("click", params)
        return parse_action_result(raw)

    async def type(
        self,
        stable_id: Optional[str],
        text: str,
        *,
        intent: Optional[str] = None,
    ) -> ActionResult:
        """Type into a text field. Pass ``stable_id`` (or ``None`` for
        intent-based targeting) and ``text`` to type.

        On ambiguous or unresolved intent returns an error envelope.
        """
        params: dict[str, Any] = {"session_id": self._id, "text": text}
        if stable_id is not None:
            params["stable_id"] = stable_id
        if intent is not None:
            params["intent"] = intent
        raw = await self._client.call("type", params)
        return parse_action_result(raw)

    async def scroll(
        self,
        stable_id: Optional[str],
        direction: ScrollDirection,
        amount: int,
        *,
        intent: Optional[str] = None,
    ) -> ActionResult:
        """Scroll the page or an element. Pass ``stable_id`` (may be ``None``
        for window scroll), ``direction``, and ``amount``.
        """
        params: dict[str, Any] = {
            "session_id": self._id,
            "stable_id": stable_id,
            "direction": direction,
            "amount": amount,
        }
        if intent is not None:
            params["intent"] = intent
        raw = await self._client.call("scroll", params)
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

    async def wait_for(
        self,
        *,
        text: Optional[str] = None,
        role: Optional[str] = None,
        name: Optional[str] = None,
        url_matches: Optional[str] = None,
        network_idle: Optional[int] = None,
        selector_visible: Optional[str] = None,
        timeout_ms: Optional[int] = None,
    ) -> WaitForResult:
        """Wait until a condition is true on the page.

        Pass at least one condition:
        - ``text``: substring present in any visible node name.
        - ``role`` + ``name``: exact role + exact accessible name.
        - ``url_matches``: regex matched against the current URL.
        - ``network_idle``: milliseconds of zero in-flight network requests.
        - ``selector_visible``: CSS selector whose element is visible.

        Default timeout is 10 seconds. Returns a dict with ``ok``,
        ``condition_met``, ``waited_ms``, and optional ``stable_id``.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if text is not None:
            params["text"] = text
        if role is not None:
            params["role"] = role
        if name is not None:
            params["name"] = name
        if url_matches is not None:
            params["url_matches"] = url_matches
        if network_idle is not None:
            params["network_idle"] = network_idle
        if selector_visible is not None:
            params["selector_visible"] = selector_visible
        if timeout_ms is not None:
            params["timeout_ms"] = timeout_ms
        return await self._client.call("wait_for", params)

    async def upload(
        self,
        *,
        stable_id: Optional[str] = None,
        intent: Optional[str] = None,
        file_path: Optional[str] = None,
        content_base64: Optional[str] = None,
        filename: Optional[str] = None,
    ) -> dict:
        """Upload a file to an ``<input type="file">`` element.

        Pass either ``stable_id`` (exact, from snapshot) or ``intent``
        (natural language) to target the input. File contents come from
        EITHER ``file_path`` (path on disk) OR ``content_base64`` + ``filename``.

        Returns a dict with ``ok`` and optional ``reason``/``candidates``.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if stable_id is not None:
            params["stable_id"] = stable_id
        if intent is not None:
            params["intent"] = intent
        if file_path is not None:
            params["file_path"] = file_path
        if content_base64 is not None:
            params["content_base64"] = content_base64
        if filename is not None:
            params["filename"] = filename
        return await self._client.call("upload", params)

    async def extract(
        self,
        *,
        css: Optional[str] = None,
        selectors: Optional[dict[str, str]] = None,
    ) -> Optional[str] | dict[str, Optional[str]]:
        """Extract text from the page.

        Pass EITHER ``css`` for single selector (returns string|None),
        OR ``selectors`` dict for multi-field extraction (returns {key: text|None}).
        Multi-selector mode completes in one round-trip.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if css is not None:
            params["css"] = css
        if selectors is not None:
            params["selectors"] = selectors
        if css is None and selectors is None:
            raise ValueError("extract requires either 'css' or 'selectors'")
        result = await self._client.call("extract", params)
        if "result" in result:
            return result["result"]
        if "text" in result:
            return result["text"]
        return result

    async def close(self) -> None:
        await self._client.call("close_session", {"session_id": self._id})
