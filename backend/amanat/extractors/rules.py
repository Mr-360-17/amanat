"""Offline, rule-based extractor. Always available; used when no LLM is configured
or the LLM call fails. Finds one asset per document."""
import re
from typing import Optional

from ..schema import canonical_asset_type

INSTITUTIONS = [
    (r"state bank of india|\bsbi\b", "SBI"),
    (r"life insurance corporation|\blic\b", "LIC"),
    (r"employees'? provident fund|\bepfo\b", "EPFO"),
    (r"hdfc mutual fund|hdfc asset management", "HDFC Mutual Fund"),
    (r"sbi mutual fund|sbi funds management", "SBI Mutual Fund"),
    (r"icici prudential mutual fund", "ICICI Prudential Mutual Fund"),
    (r"hdfc bank", "HDFC Bank"),
    (r"icici bank", "ICICI Bank"),
    (r"axis bank", "Axis Bank"),
    (r"canara bank", "Canara Bank"),
    (r"bank of baroda", "Bank of Baroda"),
    (r"kotak mahindra bank", "Kotak Mahindra Bank"),
    (r"punjab national bank|\bpnb\b", "PNB"),
    (r"post office|india post", "India Post"),
]

# Each type scores one point per distinct signal found; highest score wins, ties go to
# the earlier type. Scoring (not first-match) matters because a bank statement can
# mention "LIC PREMIUM" or "MUTUAL FUND SIP" in a transaction line.
TYPE_SIGNALS = [
    ("Mutual Fund", [r"\bfolio\b", r"mutual fund", r"\bnav\b", r"\bunits\b", r"scheme"]),
    ("EPF", [r"provident fund", r"\buan\b", r"\bepf\b", r"member id", r"passbook"]),
    ("PPF", [r"public provident fund", r"\bppf\b"]),
    ("Life Insurance", [r"sum assured", r"policy (?:no|number)", r"life assured", r"policy bond",
                        r"plan\s*(?:no|name)?\s*:"]),
    ("Fixed Deposit", [r"fixed deposit", r"term deposit", r"\bfd\b", r"maturity (?:date|value|amount)",
                       r"rate of interest"]),
    ("Recurring Deposit", [r"recurring deposit", r"\brd\b a/?c"]),
    ("Savings Account", [r"savings (?:bank|a/?c|account)", r"\bsb a/?c", r"opening balance",
                         r"closing balance", r"withdrawal"]),
    ("Current Account", [r"current account"]),
    ("Shares", [r"demat", r"dp id", r"holding statement", r"\bisin\b"]),
]


def _detect_type(low: str) -> str | None:
    best, best_score = None, 0
    for asset_type, patterns in TYPE_SIGNALS:
        score = sum(1 for p in patterns if re.search(p, low))
        if score > best_score:
            best, best_score = asset_type, score
    return best

_AMOUNT = r"(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"

VALUE_LABELS = {
    "Life Insurance": ["sum assured", "basic sum assured"],
    "Fixed Deposit": ["deposit amount", "principal amount", "principal", "amount deposited"],
    "Recurring Deposit": ["balance", "deposit amount"],
    "EPF": ["total balance", "net balance", "grand total", "closing balance"],
    "PPF": ["closing balance", "balance"],
    "Mutual Fund": ["current value", "market value", "valuation", "total value"],
    "Shares": ["total value", "market value", "holding value"],
}
DEFAULT_VALUE_LABELS = ["closing balance", "available balance", "balance", "total"]

NUMBER_LABELS = {
    "Life Insurance": ["policy no", "policy number"],
    "Fixed Deposit": ["fd no", "fd number", "deposit no", "deposit number", "account no", "a/c no"],
    "EPF": ["member id", "uan"],
    "Mutual Fund": ["folio no", "folio number", "folio"],
    "Shares": ["dp id", "client id", "demat a/c"],
}
DEFAULT_NUMBER_LABELS = ["account number", "account no", "a/c no", "a/c number", "acct no"]

OWNER_LABELS = ["account holder", "customer name", "name of life assured", "life assured",
                "policyholder", "policy holder", "member name", "investor name",
                "depositor name", "depositor", "first holder", "name of account holder"]


def _find_after(text: str, labels: list[str], value_pattern: str) -> Optional[str]:
    for label in labels:
        m = re.search(re.escape(label) + r"\s*[:\-]?\s*" + value_pattern, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _to_number(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def extract(text: str) -> list[dict]:
    low = text.lower()

    institution = next((name for pat, name in INSTITUTIONS if re.search(pat, low)), None)
    asset_type = _detect_type(low)
    if not institution and not asset_type:
        return []
    asset_type = canonical_asset_type(asset_type or "Other")
    # "SBI" also matches inside "SBI Mutual Fund"; prefer the fund house for MFs.
    if asset_type == "Mutual Fund" and institution in ("SBI", "HDFC Bank", "ICICI Bank"):
        institution = {"SBI": "SBI Mutual Fund", "HDFC Bank": "HDFC Mutual Fund",
                       "ICICI Bank": "ICICI Prudential Mutual Fund"}[institution]

    number = _find_after(text, NUMBER_LABELS.get(asset_type, []) + DEFAULT_NUMBER_LABELS,
                         r"([A-Z0-9][A-Z0-9/\-]{3,})")
    value = _to_number(_find_after(text, VALUE_LABELS.get(asset_type, []) + DEFAULT_VALUE_LABELS,
                                   _AMOUNT))
    owner = _find_after(text, OWNER_LABELS, r"((?:mr\.?|mrs\.?|ms\.?|shri|smt\.?)?\s*[A-Za-z][A-Za-z .]{2,40})")
    # Nominee line: capture the rest of the line (may be "Not Registered").
    nominee = _find_after(text, ["nominee name", "nominee"], r"([^\n\r]*)")
    if nominee:
        nominee = re.split(r"\s{2,}|\(|relation", nominee, flags=re.IGNORECASE)[0].strip()

    return [{
        "owner": tidy_name(owner),
        "institution": institution or "Unknown",
        "asset_type": asset_type,
        "account_number": number,
        "value": value,
        "nominee": tidy_name(nominee) if nominee else None,
    }]


def tidy_name(name: Optional[str]) -> Optional[str]:
    if not name:
        return name
    name = re.split(r"\s{2,}|\(", name.strip())[0].strip()
    name = re.sub(r"^(mr\.?|mrs\.?|ms\.?|shri|smt\.?)\s+", "", name, flags=re.IGNORECASE)
    return name.strip(" .").title() if name.isupper() else name.strip(" .")
