"""The shared asset schema agreed at kickoff (see README), plus normalisation helpers."""
import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator

ASSET_TYPES = [
    "Savings Account",
    "Current Account",
    "Fixed Deposit",
    "Recurring Deposit",
    "Life Insurance",
    "Health Insurance",
    "EPF",
    "PPF",
    "NPS",
    "Mutual Fund",
    "Shares",
    "Bonds",
    "Other",
]

CATEGORY_OF = {
    "Savings Account": "Bank",
    "Current Account": "Bank",
    "Fixed Deposit": "Bank",
    "Recurring Deposit": "Bank",
    "Life Insurance": "Insurance",
    "Health Insurance": "Insurance",
    "EPF": "PF",
    "PPF": "PF",
    "NPS": "PF",
    "Mutual Fund": "Investments",
    "Shares": "Investments",
    "Bonds": "Investments",
}

# Values documents use to say "no nominee"
_NO_NOMINEE = {"", "none", "nil", "na", "n/a", "-", "--", "not registered", "not available",
               "not updated", "no nominee", "not provided", "null"}


class Beneficiary(BaseModel):
    name: str
    relation: str
    share: float = Field(gt=0, le=100)


class Asset(BaseModel):
    id: str
    owner: Optional[str] = None
    institution: str
    asset_type: str
    account_number: Optional[str] = None
    value: Optional[float] = None
    nominee: Optional[str] = None
    beneficiaries: list[Beneficiary] = []
    claim_status: str = "not_started"
    source_doc: Optional[str] = None

    @field_validator("nominee", mode="before")
    @classmethod
    def _blank_nominee_is_none(cls, v):
        return clean_nominee(v)


def clean_nominee(v):
    if v is None:
        return None
    text = str(v).strip()
    if text.lower().strip(".") in _NO_NOMINEE:
        return None
    return text


def canonical_asset_type(raw: str) -> str:
    if not raw:
        return "Other"
    for t in ASSET_TYPES:
        if raw.strip().lower() == t.lower():
            return t
    low = raw.lower()
    if "fixed" in low or "term deposit" in low:
        return "Fixed Deposit"
    if "recurring" in low:
        return "Recurring Deposit"
    if "saving" in low:
        return "Savings Account"
    if "current" in low:
        return "Current Account"
    if "health" in low or "mediclaim" in low:
        return "Health Insurance"
    if "insurance" in low or "policy" in low or "assurance" in low:
        return "Life Insurance"
    if "ppf" in low or "public provident" in low:
        return "PPF"
    if "epf" in low or "provident" in low:
        return "EPF"
    if "nps" in low or "pension" in low:
        return "NPS"
    if "mutual" in low or "folio" in low:
        return "Mutual Fund"
    if "share" in low or "equity" in low or "demat" in low:
        return "Shares"
    if "bond" in low:
        return "Bonds"
    return "Other"


def category(asset_type: str) -> str:
    return CATEGORY_OF.get(asset_type, "Other")


def mask_account(number: Optional[str]) -> Optional[str]:
    """Show only the last 4 characters: 30556781234 -> XXXX1234."""
    if not number:
        return number
    compact = re.sub(r"\s+", "", str(number))
    if compact.upper().startswith("XXXX") or len(compact) <= 4:
        return compact
    return "XXXX" + compact[-4:]
