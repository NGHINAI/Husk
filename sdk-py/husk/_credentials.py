"""Credentials namespace for Husk SDK."""
from __future__ import annotations

from typing import Any, Optional

from ._transport import JsonRpcClient


class CredentialsApi:
    """Credential storage operations. Access via `Husk.credentials`."""

    def __init__(self, client: JsonRpcClient) -> None:
        self._client = client

    async def set(
        self,
        profile: str,
        *,
        key: str,
        username: str,
        password: str,
        totp_secret: Optional[str] = None,
    ) -> None:
        params: dict[str, Any] = {
            "profile": profile,
            "key": key,
            "username": username,
            "password": password,
        }
        if totp_secret is not None:
            params["totp_secret"] = totp_secret
        await self._client.call("credentials_set", params)

    async def list(self, profile: str) -> list[dict[str, Any]]:
        r = await self._client.call("credentials_list", {"profile": profile})
        return list(r["credentials"])

    async def list_profiles(self) -> list[str]:
        r = await self._client.call("credentials_list_profiles", {})
        return list(r["profiles"])

    async def remove(self, profile: str, key: str) -> None:
        await self._client.call("credentials_remove", {"profile": profile, "key": key})
