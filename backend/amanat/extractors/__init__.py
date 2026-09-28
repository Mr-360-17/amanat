"""Extraction pipeline: file bytes -> text -> assets, with cache and rule-based fallback."""
import hashlib
import json

from .. import config
from ..text_extract import extract_text, is_pdf
from . import rules
from .llm import PROVIDERS, ExtractionError


def _cache_path(digest: str, provider: str):
    return config.CACHE_DIR / f"{digest}.{provider}.json"


def _read_cache(digest: str, provider: str):
    """Current provider's cached result first; otherwise any cached LLM result
    (so a rehearsal run with Claude still saves the demo if the API is down)."""
    own = _cache_path(digest, provider)
    if own.exists():
        return provider, json.loads(own.read_text(encoding="utf-8"))
    for name in PROVIDERS:
        p = _cache_path(digest, name)
        if p.exists():
            return name, json.loads(p.read_text(encoding="utf-8"))
    return None, None


def _clean(assets: list[dict]) -> tuple[list[dict], int]:
    """Tidy names and drop entries with neither an account number nor a value:
    those are model guesses (e.g. a transaction line mistaken for an asset)."""
    kept, dropped = [], 0
    for a in assets:
        if not a.get("account_number") and a.get("value") in (None, 0):
            dropped += 1
            continue
        a = dict(a)
        for field in ("owner", "nominee"):
            if a.get(field):
                a[field] = rules.tidy_name(a[field])
        kept.append(a)
    return kept, dropped


def extract_document(filename: str, data: bytes) -> dict:
    """Returns {"assets": [...raw dicts...], "extracted_by": str, "note": str | None}."""
    digest = hashlib.sha256(data).hexdigest()
    provider = config.resolve_provider()

    if config.USE_CACHE:
        cached_by, cached = _read_cache(digest, provider)
        if cached is not None:
            return {"assets": cached, "extracted_by": f"cache:{cached_by}", "note": None}

    text = extract_text(filename, data)
    pdf = data if is_pdf(filename, data) else None
    note = None
    extracted_by = "rules"

    if provider in PROVIDERS:
        try:
            assets = PROVIDERS[provider](text, pdf)
            extracted_by = provider
        except ExtractionError as e:
            note = f"{provider} failed ({e}); used rule-based extractor"
            assets = rules.extract(text)
    else:
        assets = rules.extract(text)

    assets, dropped = _clean(assets)
    if dropped:
        note = ((note + "; ") if note else "") + f"dropped {dropped} unverifiable entries"
    if not text and extracted_by == "rules":
        note = "No text layer found (scanned PDF?). Configure Claude or Gemini to read scans."

    # Cache only real LLM output: never a fallback result, and never rules output
    # (it is instant anyway, and a stale copy would hide rule fixes).
    if assets and extracted_by == provider and provider in PROVIDERS:
        config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(digest, provider).write_text(json.dumps(assets, indent=2), encoding="utf-8")
    return {"assets": assets, "extracted_by": extracted_by, "note": note}
