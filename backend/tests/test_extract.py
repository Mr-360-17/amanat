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


def _gemini_env(monkeypatch, responses, budget=45, keys=("k1",)):
    """responses(call_number, model, key) -> _Resp. calls records (model, key)."""
    import httpx
    from amanat import config
    from amanat.extractors import llm
    calls = []

    def fake_post(url, headers=None, **kw):
        model = url.split("/models/")[1].split(":")[0]
        calls.append((model, headers["x-goog-api-key"]))
        return responses(len(calls), model, headers["x-goog-api-key"])

    monkeypatch.setattr(config, "gemini_keys", lambda: list(keys))
    monkeypatch.setattr(llm, "_good_key", 0)
    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    monkeypatch.setattr(config, "GEMINI_MODEL", "main")
    monkeypatch.setattr(config, "GEMINI_FALLBACK_MODELS", ["backup1", "backup2"])
    monkeypatch.setattr(config, "LLM_TIME_BUDGET_S", budget)
    return llm, calls


OK_JSON = ('{"assets": [{"institution": "LIC", "asset_type": "Life Insurance", "account_number": "1", '
           '"value": 5, "owner": null, "nominee": null}]}')


def test_gemini_busy_model_falls_through_to_backup(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n, m, k: _Resp(503) if n <= 2 else _Resp(200, OK_JSON))
    assert llm.extract_gemini("doc")[0]["institution"] == "LIC"
    assert [m for m, _ in calls] == ["main", "main", "backup1"]  # retried once, then moved on


def test_gemini_all_busy_raises_so_rules_can_take_over(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n, m, k: _Resp(503))
    with pytest.raises(llm.ExtractionError, match="busy/unavailable"):
        llm.extract_gemini("doc")
    assert [m for m, _ in calls] == ["main", "main", "backup1", "backup1", "backup2", "backup2"]


def test_gemini_rate_limited_key_hands_over_to_next_key(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n, m, k: _Resp(429) if k == "k1" else _Resp(200, OK_JSON),
                             keys=("k1", "k2"))
    assert llm.extract_gemini("doc")[0]["institution"] == "LIC"
    assert calls == [("main", "k1"), ("main", "k2")]  # same model, next key
    calls.clear()
    llm.extract_gemini("doc")
    assert calls == [("main", "k2")]  # remembers the key that worked


def test_gemini_rejected_key_is_skipped(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n, m, k: _Resp(400, "API key not valid") if k == "bad"
                             else _Resp(200, OK_JSON), keys=("bad", "good"))
    assert llm.extract_gemini("doc")
    assert calls == [("main", "bad"), ("main", "good")]


def test_gemini_all_keys_rejected(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n, m, k: _Resp(403, "denied"), keys=("a", "b"))
    with pytest.raises(llm.ExtractionError, match="every Gemini key was rejected"):
        llm.extract_gemini("doc")
    assert len(calls) == 2  # doesn't keep trying other models with dead keys


def test_gemini_bad_request_stops_immediately(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n, m, k: _Resp(400, "Invalid JSON payload"))
    with pytest.raises(llm.ExtractionError, match="HTTP 400"):
        llm.extract_gemini("doc")
    assert len(calls) == 1


def test_gemini_time_budget_stops_the_search(monkeypatch):
    llm, calls = _gemini_env(monkeypatch, lambda n, m, k: _Resp(503), budget=2)
    with pytest.raises(llm.ExtractionError, match="no answer within 2s"):
        llm.extract_gemini("doc")
    assert calls == []


def test_scan_failure_keeps_the_real_llm_error(monkeypatch):
    from amanat import config
    from amanat.extractors import extract_document, llm

    def busy(text, pdf=None):
        raise llm.ExtractionError("gemini-3.8-flash: HTTP 429")

    monkeypatch.setattr(config, "resolve_provider", lambda: "gemini")
    monkeypatch.setattr(config, "USE_CACHE", False)
    monkeypatch.setitem(llm.PROVIDERS, "gemini", busy)
    import amanat.extractors as ex
    monkeypatch.setitem(ex.PROVIDERS, "gemini", busy)
    scan = (Path(__file__).resolve().parent.parent / "dev_samples" / "scans" / "sbi_fd_receipt_scanned.pdf")
    r = extract_document("scan.pdf", scan.read_bytes())
    assert r["assets"] == []
    assert "Scanned PDF" in r["note"] and "HTTP 429" in r["note"] and "Try again" in r["note"]


def test_mask_account():
    assert mask_account("30556781234") == "XXXX1234"
    assert mask_account("XXXX1234") == "XXXX1234"
    assert mask_account(None) is None
