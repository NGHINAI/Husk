from __future__ import annotations
import asyncio
import os
import socket
import sys
import time
from pathlib import Path
from subprocess import Popen
from typing import Optional

import pytest
from husk import Husk

ORCHESTRATOR_PATH = (
    Path(__file__).resolve().parents[3] / "orchestrator" / "dist" / "index.js"
)
LIGHTPANDA_BIN = os.environ.get("LIGHTPANDA_BIN")

pytestmark = pytest.mark.skipif(
    not (LIGHTPANDA_BIN and ORCHESTRATOR_PATH.exists()),
    reason="integration test requires LIGHTPANDA_BIN env and built orchestrator/dist",
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _wait_ready(husk: Husk, deadline_s: float) -> None:
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        try:
            r = await husk.health()
            if r.get("ok"):
                return
        except Exception:
            await asyncio.sleep(0.2)
    raise RuntimeError("Orchestrator never became ready")


async def test_create_session_goto_snapshot_close() -> None:
    port = _free_port()
    env = {**os.environ, "LIGHTPANDA_BIN": LIGHTPANDA_BIN or ""}
    proc = Popen(
        ["node", str(ORCHESTRATOR_PATH), "start", "--port", str(port), "--log-level", "silent"],
        env=env, stdout=sys.stderr, stderr=sys.stderr,
    )
    try:
        async with Husk(base_url=f"http://127.0.0.1:{port}") as h:
            await _wait_ready(h, 15.0)
            s = await h.create_session()
            assert len(s.id) == 36  # UUID
            await s.goto("https://example.com")
            snap = await s.snapshot()
            assert snap.count > 0
            assert snap.root.r == "RootWebArea"
            await s.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


async def test_click_on_missing_returns_rejection() -> None:
    from husk._types import RejectionEnvelope

    port = _free_port()
    env = {**os.environ, "LIGHTPANDA_BIN": LIGHTPANDA_BIN or ""}
    proc = Popen(
        ["node", str(ORCHESTRATOR_PATH), "start", "--port", str(port), "--log-level", "silent"],
        env=env, stdout=sys.stderr, stderr=sys.stderr,
    )
    try:
        async with Husk(base_url=f"http://127.0.0.1:{port}") as h:
            await _wait_ready(h, 15.0)
            s = await h.create_session()
            await s.goto("https://example.com")
            await s.snapshot()
            result = await s.click("button:totally-fake")
            assert isinstance(result, RejectionEnvelope)
            assert result.reason == "element_not_found"
            await s.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
