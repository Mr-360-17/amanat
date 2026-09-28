"""Runtime settings, read from environment variables (and backend/.env if present)."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
MOCK_DIR = REPO_DIR / "shared" / "mock"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BACKEND_DIR / ".env")

DATA_DIR = Path(os.getenv("AMANAT_DATA_DIR", BACKEND_DIR / "data"))
CACHE_DIR = Path(os.getenv("AMANAT_CACHE_DIR", BACKEND_DIR / "cache"))

# auto | claude | gemini | ollama | rules
LLM_PROVIDER = os.getenv("AMANAT_LLM", "auto").lower()
CLAUDE_MODEL = os.getenv("AMANAT_CLAUDE_MODEL", "claude-opus-5")
CLAUDE_EFFORT = os.getenv("AMANAT_CLAUDE_EFFORT", "low")
GEMINI_MODEL = os.getenv("AMANAT_GEMINI_MODEL", "gemini-3.8-flash")
# Tried in order when the main model is busy or unavailable.
GEMINI_FALLBACK_MODELS = [m.strip() for m in os.getenv(
    "AMANAT_GEMINI_FALLBACKS", "gemini-3.7-flash,gemini-3.5-flash,gemini-flash-latest").split(",") if m.strip()]
OLLAMA_URL = os.getenv("AMANAT_OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("AMANAT_OLLAMA_MODEL", "llama3.2:1b")

# Max seconds to spend on one document's LLM call(s) before using the rule-based extractor.
LLM_TIME_BUDGET_S = float(os.getenv("AMANAT_LLM_TIME_BUDGET_S", "45"))

# Trusted contacts who haven't answered a reachability check for this many days are flagged.
REACHABILITY_DAYS = int(os.getenv("AMANAT_REACHABILITY_DAYS", "180"))

# Base URL of the frontend page a trusted contact opens from their invite message.
INVITE_BASE_URL = os.getenv("AMANAT_INVITE_BASE_URL", "http://localhost:5173/circle").rstrip("/")

# Re-use extraction results for a file we've already seen (demo safety net).
USE_CACHE = os.getenv("AMANAT_USE_CACHE", "1") == "1"

# Pratham's keeper agent. Empty = serve mock status/txlog.
KEEPER_URL = os.getenv("AMANAT_KEEPER_URL", "").rstrip("/")

# Hex-encoded 32-byte AES key. Empty = generate one into data/vault.key.
VAULT_KEY_HEX = os.getenv("AMANAT_VAULT_KEY", "")

CORS_ORIGINS = [o.strip() for o in os.getenv("AMANAT_CORS_ORIGINS", "*").split(",") if o.strip()]


def owner_key() -> str:
    """Secret the owner's app sends as X-Amanat-Key. From AMANAT_OWNER_KEY, else generated
    once into data/owner.key. Keeps other people on the venue Wi-Fi out of the API."""
    key = os.getenv("AMANAT_OWNER_KEY", "").strip()
    if key:
        return key
    path = DATA_DIR / "owner.key"
    if not path.exists():
        import secrets
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(18))
    return path.read_text().strip()


def gemini_keys() -> list[str]:
    """GEMINI_API_KEY plus optional backups GEMINI_API_KEY_2 ... GEMINI_API_KEY_5 (e.g. from
    teammates' Google accounts). A rate-limited key hands over to the next one."""
    names = ["GEMINI_API_KEY"] + [f"GEMINI_API_KEY_{i}" for i in range(2, 6)]
    keys = [os.getenv(n, "").strip() for n in names]
    return list(dict.fromkeys(k for k in keys if k))


def resolve_provider() -> str:
    if LLM_PROVIDER != "auto":
        return LLM_PROVIDER
    if os.getenv("ANTHROPIC_API_KEY"):
        return "claude"
    if gemini_keys():
        return "gemini"
    return "rules"
