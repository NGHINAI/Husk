"""Smoke tests for husk-sdk."""
import re

import husk


def test_version_is_semver():
    assert re.match(r"^\d+\.\d+\.\d+(-[\w.]+)?$", husk.__version__)


def test_husk_class_exists():
    assert hasattr(husk, "Husk")
    assert callable(husk.Husk)


def test_husk_constructor_accepts_base_url():
    h = husk.Husk(base_url="http://localhost:7777")
    assert h.base_url == "http://localhost:7777"


def test_husk_default_base_url():
    h = husk.Husk()
    assert h.base_url == "http://localhost:7777"
