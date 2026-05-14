"""Husk — open-source browser engine for AI agents (Python SDK).

In Milestone 1, this module exposes only the Husk client constructor as a
placeholder. Full transport (JSON-RPC over HTTP/2), session management,
and snapshot/act methods land in Milestone 6.
"""

__version__ = "0.0.0"

DEFAULT_BASE_URL = "http://localhost:7777"


class Husk:
    """Husk SDK client (Milestone 1 placeholder).

    Args:
        base_url: Orchestrator URL. Defaults to ``http://localhost:7777``.
    """

    def __init__(self, base_url: str = DEFAULT_BASE_URL) -> None:
        self.base_url = base_url


__all__ = ["Husk", "__version__", "DEFAULT_BASE_URL"]
