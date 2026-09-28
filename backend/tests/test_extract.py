import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from amanat.extractors import _clean, rules  # noqa: E402
from amanat.schema import clean_nominee, mask_account  # noqa: E402


def test_clean_drops_guessed_assets_and_tidies_names():
    # Shape of what llama3.2:1b returned for the savings statement
    raw = [
        {"institution": "State Bank of India", "asset_type": "Savings Account",
         "account_number": "30112284821", "value": 145000.0,
         "owner": "MR. RAMESH KUMAR", "nominee": "Sunita Kumar (Wife)"},
        {"institution": "LIC", "asset_type": "Life Insurance", "account_number": None,
         "value": None, "owner": "MR. RAMESH KUMAR", "nominee": "Sunita Kumar (Wife)"},
    ]
    kept, dropped = _clean(raw)
    assert dropped == 1 and len(kept) == 1
    assert kept[0]["owner"] == "Ramesh Kumar"
    assert kept[0]["nominee"] == "Sunita Kumar"


def test_rupee_symbol_amounts():
    text = "HDFC Mutual Fund\nFolio No: 1234/56\nCurrent Value: ₹ 2,50,000.50"
    [a] = rules.extract(text)
    assert a["value"] == 250000.5 and a["asset_type"] == "Mutual Fund"


def test_bank_statement_with_premium_line_stays_savings():
    text = ("State Bank of India\nSavings Bank A/c\nAccount Number: 123456789\n"
            "Opening Balance 10,000\n03-08 LIC PREMIUM 4,850\nClosing Balance: Rs. 5,150")
    [a] = rules.extract(text)
    assert a["asset_type"] == "Savings Account" and a["value"] == 5150


def test_no_nominee_variants():
    for v in ("Not Registered", "NIL", "-", "N/A", "", None, "none."):
        assert clean_nominee(v) is None
    assert clean_nominee("Sunita Kumar") == "Sunita Kumar"


class _Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text = status, text

    def json(self):
        import json
        return {"candidates": [{"content": {"parts": [{"text": self.text}]}}]}


def _gemini_env(monkeypatch, responses, budget=45):
    import httpx
    from amanat import config
    from amanat.extractors import llm
    calls = []

    def fake_post(url, **kw):
        calls.append(url.split("/models/")[1].split(":")[0])
        return responses(len(calls))

    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    monkeypatch.setattr(config, "GEMINI_MODEL", "main")
    monkeypatch.setattr(config, "GEMINI_FALLBACK_MODELS", ["backup1", "backup2"])
    monkeypatch.setattr(config, "LLM_TIME_BUDGET_S", budget)
    return llm, calls


def test_gemini_busy_model_falls_through_to_backup(monkeypatch):
    ok = '{"assets": [{"institution": "LIC", "asset_type": "Life Insurance", "account_number": "1", ' \
         '"value": 5, "owner": null, "nominee": null}]}'
    llm, calls = _gemini_env(monkeypatch, lambda n: _Resp(503) if n <= 2 else _Resp(200, ok))
    assert llm.extract_gemini("doc")[0]["institution"] == "LIC"
    assert calls == ["main", "main", "backup1"]  # retried once, then moved on


def test_gemini_all_busy_raises_so_rules_can_take_over(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n: _Resp(503))
    with pytest.raises(llm.ExtractionError, match="busy/unavailable"):
        llm.extract_gemini("doc")
    assert calls == ["main", "main", "backup1", "backup1", "backup2", "backup2"]


def test_gemini_bad_key_stops_immediately(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n: _Resp(400, "API key not valid"))
    with pytest.raises(llm.ExtractionError, match="HTTP 400"):
        llm.extract_gemini("doc")
    assert calls == ["main"]


def test_gemini_time_budget_stops_the_search(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n: _Resp(503), budget=2)
    with pytest.raises(llm.ExtractionError, match="no answer within 2s"):
        llm.extract_gemini("doc")
    assert calls == []


def test_mask_account():
    assert mask_account("30556781234") == "XXXX1234"
    assert mask_account("XXXX1234") == "XXXX1234"
    assert mask_account(None) is None
