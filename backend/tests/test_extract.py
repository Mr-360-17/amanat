import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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


def test_mask_account():
    assert mask_account("30556781234") == "XXXX1234"
    assert mask_account("XXXX1234") == "XXXX1234"
    assert mask_account(None) is None
