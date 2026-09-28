"""LLM-based asset extraction. Providers: Claude (Anthropic SDK), Gemini, Ollama (local).
Every provider returns the same list[dict] shape as the rule-based extractor."""
import base64
import json
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

# Index of the key that last worked; the next call starts there (skips a known-throttled key).
_good_key = 0


def _is_bad_key(r) -> bool:
    return r.status_code in (401, 403) or (r.status_code == 400 and "API key" in r.text)


def extract_gemini(text: str, pdf_bytes: bytes | None = None) -> list[dict]:
    global _good_key
    keys = config.gemini_keys()
    if not keys:
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
    # Free-tier failures and what fixes them:
    #   429 rate limited  -> the KEY is throttled: try the next key on the same model
    #   503 overloaded    -> the MODEL is busy: retry once, then the next model
    #   404 retired       -> the MODEL is gone: next model
    #   bad key (400/401/403) -> drop that key for this call
    # Anything else (bad request) stops at once. Capped by LLM_TIME_BUDGET_S overall.
    order = list(range(len(keys)))
    order = order[_good_key % len(keys):] + order[:_good_key % len(keys)]
    dead: set[int] = set()
    errors = []
    deadline = time.monotonic() + config.LLM_TIME_BUDGET_S
    for model in [config.GEMINI_MODEL] + config.GEMINI_FALLBACK_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        retried_busy = False
        queue = [k for k in order if k not in dead]
        while queue:
            ki = queue[0]
            label = f"{model}" + (f" (key {ki + 1})" if len(keys) > 1 else "")
            remaining = deadline - time.monotonic()
            if remaining < 3:
                raise ExtractionError(f"Gemini gave no answer within {config.LLM_TIME_BUDGET_S:g}s: "
                                      + "; ".join(errors or ["timed out"]))
            try:
                r = httpx.post(url, json=body, headers={"x-goog-api-key": keys[ki]}, timeout=remaining)
            except httpx.HTTPError as e:
                errors.append(f"{label}: {type(e).__name__}")
                break
            if r.status_code == 429:
                errors.append(f"{label}: HTTP 429")
                queue.pop(0)
                continue
            if r.status_code == 503 and not retried_busy:
                retried_busy = True
                time.sleep(2)
                continue
            if r.status_code in (404, 503):
                errors.append(f"{label}: HTTP {r.status_code}")
                break
            if _is_bad_key(r):
                errors.append(f"key {ki + 1}: rejected (HTTP {r.status_code})")
                dead.add(ki)
                queue.pop(0)
                continue
            if r.status_code != 200:
                raise ExtractionError(f"Gemini {model} HTTP {r.status_code}: {r.text[:200]}")
            try:
                out = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError, ValueError) as e:
                raise ExtractionError(f"Gemini {model} returned no text") from e
            _good_key = ki
            return _parse(out)
        if len(dead) == len(keys):
            raise ExtractionError("every Gemini key was rejected: " + "; ".join(errors))
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
