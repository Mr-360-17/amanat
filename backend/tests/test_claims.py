"""Unnati's claim agent (claims/agent.py), loaded the way the backend loads it."""
import json
from pathlib import Path

import pytest

from amanat import bridges

MOCK = json.loads((Path(__file__).resolve().parents[2] / "shared" / "mock" / "assets.json").read_text())


@pytest.mark.parametrize("asset", MOCK, ids=[f"{a['institution']} {a['asset_type']}" for a in MOCK])
def test_every_demo_asset_gets_a_real_guide(asset):
    g = bridges.claim_guide(asset)
    assert g["source"] == "claims-agent"
    assert len(g["steps"]) >= 4 and g["documents"] and g["sources"]
    assert "could not be matched" not in " ".join(g["steps"])
    assert all(s.startswith("https://") for s in g["sources"])
    assert g["disclaimer"] == "Guidance only, not legal advice."


def test_missing_nominee_adds_legal_heir_step():
    fd = next(a for a in MOCK if a["asset_type"] == "Fixed Deposit")
    assert fd["nominee"] is None
    assert "legal-heir" in bridges.claim_guide(fd)["steps"][-1]


@pytest.mark.parametrize("name", ["State Bank of India", "STATE  BANK OF INDIA", "Life Insurance Corporation of India"])
def test_full_institution_names_are_recognised(name):
    kind = "Life Insurance" if "Life" in name else "Fixed Deposit"
    g = bridges.claim_guide({"id": "X", "institution": name, "asset_type": kind, "nominee": "A"})
    assert "could not be matched" not in " ".join(g["steps"])


def test_unknown_asset_gets_safe_fallback():
    g = bridges.claim_guide({"id": "X", "institution": "Some Co-op Bank", "asset_type": "Bonds"})
    assert "could not be matched" in g["steps"][0] and g["sources"] == []


def test_no_broken_epfo_link():
    epf = next(a for a in MOCK if a["asset_type"] == "EPF")
    g = bridges.claim_guide(epf)
    assert all("epfindia.gov.in/site_docs" not in s for s in g["sources"])
    assert any("Composite Claim Form (Death Cases)" in s for s in g["steps"])
