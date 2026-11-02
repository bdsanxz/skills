"""Shared test fixtures for the computer-use skill test suite."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))


@pytest.fixture(autouse=True)
def _granted_permissions(monkeypatch):
    """Keep hermetic tests off live OS permission detection.

    Every hermetic test runs with an always-granted prober; tests for
    denial pass their own prober explicitly, and the one live status
    test names the real macOS prober explicitly.
    """

    from computer_use.permissions import OpenProber

    monkeypatch.setattr(
        "computer_use.permissions.detect_prober",
        lambda: OpenProber(),
    )
