"""Vault namespace for Husk SDK."""
from __future__ import annotations

from ._transport import JsonRpcClient
from ._types import Cookie, parse_cookie


class VaultApi:
    """Cookie vault operations. Access via `Husk.vault`."""

    def __init__(self, client: JsonRpcClient) -> None:
        self._client = client

    async def list_profiles(self) -> list[str]:
        r = await self._client.call("vault_list_profiles", {})
        return list(r["profiles"])

    async def list_cookies(self, profile: str) -> list[Cookie]:
        r = await self._client.call("vault_list_cookies", {"profile": profile})
        return [parse_cookie(c) for c in r["cookies"]]

    async def clear(self, profile: str) -> None:
        await self._client.call("vault_clear", {"profile": profile})

    async def remove_cookie(self, profile: str, name: str, domain: str, path: str) -> None:
        await self._client.call(
            "vault_remove_cookie",
            {"profile": profile, "name": name, "domain": domain, "path": path},
        )
