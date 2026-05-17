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

    async def goto(self, url: str, *, include_snapshot: Optional[bool] = None) -> dict[str, Any]:
        """Navigate to a URL. Returns {ok, snapshot?}.

        The ``snapshot`` field contains the full post-navigation page state (AX tree +
        signature + meta + forms + network + console + summary + session_history).
        DO NOT call snapshot() after goto — the snapshot is already in the result.
        Pass ``include_snapshot=False`` to opt out and save tokens.
        """
        params: dict[str, Any] = {"session_id": self._id, "url": url}
        if include_snapshot is not None:
            params["include_snapshot"] = include_snapshot
        return await self._client.call("goto", params)

    async def snapshot(self) -> Snapshot:
        raw = await self._client.call("snapshot", {"session_id": self._id})
        return parse_snapshot(raw)

    async def click(
        self,
        stable_id: Optional[str] = None,
        *,
        intent: Optional[str] = None,
        include_snapshot: Optional[bool] = None,
    ) -> ActionResult:
        """Click an element. Pass either ``stable_id`` (exact, from snapshot) or
        ``intent`` (natural language, e.g. ``"sign in button"``).

        On ambiguous intent returns ``{ok: False, reason: "ambiguous_intent"}``.
        On no match returns ``{ok: False, reason: "no_match"}``.

        Returns a dict with ``ok``, ``diff``, ``warnings``, and ``snapshot``.
        The ``snapshot`` field contains the full post-click page state.
        DO NOT call snapshot() after click — the snapshot is already in the result.
        Pass ``include_snapshot=False`` to opt out and save tokens.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if stable_id is not None:
            params["stable_id"] = stable_id
        if intent is not None:
            params["intent"] = intent
        if include_snapshot is not None:
            params["include_snapshot"] = include_snapshot
        raw = await self._client.call("click", params)
        return parse_action_result(raw)

    async def type(
        self,
        stable_id: Optional[str],
        text: str,
        *,
        intent: Optional[str] = None,
        include_snapshot: Optional[bool] = None,
    ) -> ActionResult:
        """Type into a text field. Pass ``stable_id`` (or ``None`` for
        intent-based targeting) and ``text`` to type.

        On ambiguous or unresolved intent returns an error envelope.

        Returns a dict with ``ok``, ``diff``, ``warnings``, and ``snapshot``.
        The ``snapshot`` field contains the full post-type page state.
        DO NOT call snapshot() after type — the snapshot is already in the result.
        Pass ``include_snapshot=False`` to opt out and save tokens.
        """
        params: dict[str, Any] = {"session_id": self._id, "text": text}
        if stable_id is not None:
            params["stable_id"] = stable_id
        if intent is not None:
            params["intent"] = intent
        if include_snapshot is not None:
            params["include_snapshot"] = include_snapshot
        raw = await self._client.call("type", params)
        return parse_action_result(raw)

    async def scroll(
        self,
        stable_id: Optional[str] = None,
        direction: Optional[ScrollDirection] = None,
        amount: Optional[int] = None,
        *,
        intent: Optional[str] = None,
        include_snapshot: Optional[bool] = None,
        until: Optional[dict] = None,
        max_scrolls: Optional[int] = None,
        scroll_amount_px: Optional[int] = None,
    ) -> ActionResult:
        """Scroll the page or an element.

        Two modes:

        **Scroll-until** (modern AI use case): pass ``until`` dict with a condition
        (``text``, ``role``+``name``, ``url_matches``, ``network_idle``,
        ``selector_visible``). The call loops internally up to ``max_scrolls``
        (default 20) times and returns ``{ok, scrolls, condition_met?, snapshot}``.
        DO NOT call scroll in a loop yourself — the single call does the loop.

        **Pixel-based**: pass ``direction`` and ``amount`` for a one-shot scroll.

        Returns a dict with ``ok``, ``diff``/``scrolls``, ``warnings``, and ``snapshot``.
        The ``snapshot`` field contains the full post-scroll page state.
        DO NOT call snapshot() after scroll — the snapshot is already in the result.
        Pass ``include_snapshot=False`` to opt out and save tokens.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if stable_id is not None:
            params["stable_id"] = stable_id
        if direction is not None:
            params["direction"] = direction
        if amount is not None:
            params["amount"] = amount
        if intent is not None:
            params["intent"] = intent
        if include_snapshot is not None:
            params["include_snapshot"] = include_snapshot
        if until is not None:
            params["until"] = until
        if max_scrolls is not None:
            params["max_scrolls"] = max_scrolls
        if scroll_amount_px is not None:
            params["scroll_amount_px"] = scroll_amount_px
        raw = await self._client.call("scroll", params)
        return parse_action_result(raw)

    async def press_key(self, key: str, *, include_snapshot: Optional[bool] = None) -> ActionResult:
        """Press a single key (Enter, Tab, Escape, ArrowUp/Down, etc.).

        Returns a dict with ``ok``, ``diff``, ``warnings``, and ``snapshot``.
        The ``snapshot`` field contains the full post-keypress page state.
        DO NOT call snapshot() after press_key — the snapshot is already in the result.
        Pass ``include_snapshot=False`` to opt out and save tokens.
        """
        params: dict[str, Any] = {"session_id": self._id, "key": key}
        if include_snapshot is not None:
            params["include_snapshot"] = include_snapshot
        raw = await self._client.call("press_key", params)
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
        include_snapshot: Optional[bool] = None,
    ) -> dict[str, Any]:
        """Log into a website. Two modes:

        - Inline (ephemeral): pass ``username`` + ``password`` (and optional
          ``totp_secret``) directly. Credentials are not persisted.
        - Stored lookup: pass ``profile`` + ``key`` to read previously-stored
          credentials from the credentials vault.

        Returns a dict with ``ok``, ``url_before``, ``url_after``, and ``snapshot``.
        The ``snapshot`` field contains the full post-login page state (logged-in view).
        DO NOT call snapshot() after login — the snapshot is already in the result.
        Pass ``include_snapshot=False`` to opt out and save tokens.
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
        if include_snapshot is not None:
            params["include_snapshot"] = include_snapshot
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
        include_snapshot: Optional[bool] = None,
    ) -> dict:
        """Upload a file to an ``<input type="file">`` element.

        Pass either ``stable_id`` (exact, from snapshot) or ``intent``
        (natural language) to target the input. File contents come from
        EITHER ``file_path`` (path on disk) OR ``content_base64`` + ``filename``.

        Returns a dict with ``ok``, optional ``reason``/``candidates``, and ``snapshot``.
        The ``snapshot`` field contains the full post-upload page state.
        DO NOT call snapshot() after upload — the snapshot is already in the result.
        Pass ``include_snapshot=False`` to opt out and save tokens.
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
        if include_snapshot is not None:
            params["include_snapshot"] = include_snapshot
        return await self._client.call("upload", params)

    async def extract(
        self,
        *,
        css: Optional[str] = None,
        selectors: Optional[dict[str, str]] = None,
        paginate: Optional[dict] = None,
    ) -> Optional[str] | dict[str, Optional[str]] | dict:
        """Extract text from the page. Three modes:

        - ``css``: single selector → returns string|None.
        - ``selectors``: multi-field map → returns {key: text|None}. One round-trip.
        - ``css|selectors`` + ``paginate``: click-next pagination loop → returns
          {pages, total_pages, stopped_reason}. Replaces manual extract+click loops.

        ``paginate`` shape::

            {
                "next": {"intent": "Next page"},  # or {"stable_id": "..."}
                "max_pages": 10,                  # optional, default 10
                "stop_when": {"text": "End"},     # optional WaitForCondition
            }

        DO NOT manually loop extract + click — pass ``paginate`` instead.
        """
        params: dict[str, Any] = {"session_id": self._id}
        if css is not None:
            params["css"] = css
        if selectors is not None:
            params["selectors"] = selectors
        if css is None and selectors is None:
            raise ValueError("extract requires either 'css' or 'selectors'")
        if paginate is not None:
            params["paginate"] = paginate
        result = await self._client.call("extract", params)
        # Paginate mode returns pages/total_pages/stopped_reason directly.
        if "pages" in result:
            return result
        if "result" in result:
            return result["result"]
        if "text" in result:
            return result["text"]
        return result

    async def close(self) -> None:
        await self._client.call("close_session", {"session_id": self._id})
