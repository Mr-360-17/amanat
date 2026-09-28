"""LLM-based asset extraction. Providers: Claude (Anthropic SDK), Gemini, Ollama (local).
Every provider returns the same list[dict] shape as the rule-based extractor."""
import base64
import json
import os
import time

import httpx

from .. import config
from ..schema import ASSET_TYPES


class ExtractionError(Exception):
    pass


PROMPT = """You read Indian financial documents (bank statements, FD receipts, insurance \
policies, EPF passbooks, mutual fund statements, demat statements) and list every \
financial asset the document proves the account holder owns.

Rules:
- One entry per distinct account / policy / folio / deposit. A savings statement is one \
asset even if it has many transactions. Transaction lines that mention other products \
(e.g. "LIC PREMIUM", "MF SIP") are NOT separate assets.
- institution: short common name (SBI, LIC, EPFO, HDFC Mutual Fund, ...).
- asset_type: one of {types}.
- account_number: exactly as printed (account / policy / FD / folio / member ID).
- value: current value in rupees as a plain number (closing balance, deposit principal, \
sum assured, EPF total balance, MF current value). null if not shown.
- owner: the account holder / life assured / member / investor.
- nominee: the registered nominee's name, or null if the document says none, \
"not registered", "NIL", or shows no nominee field.
- Never invent values that are not in the document.
If the document contains no financial asset, return an empty list.""".format(types=", ".join(ASSET_TYPES))

_NULLABLE_STR = {"anyOf": [{"type": "string"}, {"type": "null"}]}
SCHEMA = {
    "type": "object",
    "properties": {
        "assets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "institution": {"type": "string"},
                    "asset_type": {"type": "string", "enum": ASSET_TYPES},
                    "account_number": _NULLABLE_STR,
                    "value": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "owner": _NULLABLE_STR,
                    "nominee": _NULLABLE_STR,
                },
                "required": ["institution", "asset_type", "account_number", "value", "owner", "nominee"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["assets"],
    "additionalProperties": False,
}


def _parse(text: str) -> list[dict]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ExtractionError(f"model returned invalid JSON: {e}") from e
    assets = data.get("assets") if isinstance(data, dict) else data
    if not isinstance(assets, list):
        raise ExtractionError("model JSON has no 'assets' list")
    return assets


# ---------- Claude ----------

def extract_claude(text: str, pdf_bytes: bytes | None = None) -> list[dict]:
    import anthropic

    content: list[dict] = []
    if pdf_bytes is not None and not text:
        # Scanned PDF with no text layer: let Claude read the PDF itself.
        content.append({
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf",
                       "data": base64.b64encode(pdf_bytes).decode("ascii")},
        })
        content.append({"type": "text", "text": PROMPT})
    else:
        content.append({"type": "text", "text": f"{PROMPT}\n\n<document>\n{text}\n</document>"})

    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={
                "effort": config.CLAUDE_EFFORT,
                "format": {"type": "json_schema", "schema": SCHEMA},
            },
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.RateLimitError as e:
        raise ExtractionError("Claude rate limit hit") from e
    except anthropic.APIStatusError as e:
        raise ExtractionError(f"Claude API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ExtractionError("could not reach Claude API") from e

    if response.stop_reason == "refusal":
        raise ExtractionError("Claude declined this document")
    if response.stop_reason == "max_tokens":
        raise ExtractionError("Claude output was cut off")
    text_out = next((b.text for b in response.content if b.type == "text"), None)
    if text_out is None:
        raise ExtractionError("Claude returned no text")
    return _parse(text_out)


# ---------- Gemini ----------

def extract_gemini(text: str, pdf_bytes: bytes | None = None) -> list[dict]:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise ExtractionError("GEMINI_API_KEY not set")
    parts: list[dict] = [{"text": PROMPT}]
    if pdf_bytes is not None and not text:
        parts.append({"inline_data": {"mime_type": "application/pdf",
                                      "data": base64.b64encode(pdf_bytes).decode("ascii")}})
    else:
        parts.append({"text": f"<document>\n{text}\n</document>"})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json",
                             "responseJsonSchema": SCHEMA},
    }
    # Busy (429/503) or retired (404) models are common on the free tier: retry once,
    # then move down the model list. Other errors (bad key, bad request) stop at once.
    # The whole search is capped by LLM_TIME_BUDGET_S so a busy API can't stall the UI.
    errors = []
    deadline = time.monotonic() + config.LLM_TIME_BUDGET_S
    for model in [config.GEMINI_MODEL] + config.GEMINI_FALLBACK_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        for attempt in range(2):
            remaining = deadline - time.monotonic()
            if remaining < 3:
                raise ExtractionError(f"Gemini gave no answer within {config.LLM_TIME_BUDGET_S:g}s: "
                                      + "; ".join(errors or ["timed out"]))
            try:
                r = httpx.post(url, json=body, headers={"x-goog-api-key": key}, timeout=remaining)
            except httpx.HTTPError as e:
                errors.append(f"{model}: {type(e).__name__}")
                break
            if r.status_code in (429, 503) and attempt == 0:
                time.sleep(2)
                continue
            if r.status_code in (404, 429, 503):
                errors.append(f"{model}: HTTP {r.status_code}")
                break
            if r.status_code != 200:
                raise ExtractionError(f"Gemini {model} HTTP {r.status_code}: {r.text[:200]}")
            try:
                out = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError, ValueError) as e:
                raise ExtractionError(f"Gemini {model} returned no text") from e
            return _parse(out)
    raise ExtractionError("all Gemini models busy/unavailable: " + "; ".join(errors))


# ---------- Ollama (local, offline) ----------

def extract_ollama(text: str, pdf_bytes: bytes | None = None) -> list[dict]:
    if not text:
        raise ExtractionError("Ollama path needs a text layer (scanned PDFs unsupported)")
    body = {
        "model": config.OLLAMA_MODEL,
        "stream": False,
        "format": SCHEMA,
        "options": {"temperature": 0},
        "messages": [{"role": "user", "content": f"{PROMPT}\n\n<document>\n{text}\n</document>"}],
    }
    try:
        r = httpx.post(f"{config.OLLAMA_URL}/api/chat", json=body, timeout=180)
        r.raise_for_status()
        out = r.json()["message"]["content"]
    except (httpx.HTTPError, KeyError) as e:
        raise ExtractionError(f"Ollama call failed: {e}") from e
    return _parse(out)


PROVIDERS = {"claude": extract_claude, "gemini": extract_gemini, "ollama": extract_ollama}
