"""Hand-offs to teammates' components.

Claim agent (Unnati): claims/agent.py must define
    get_claim_guide(asset: dict) -> dict
returning at least {"steps": [...], "documents": [...], "sources": [...], "disclaimer": str}.
The asset passed in has the full shared schema (account number masked).

Keeper agent (Pratham): an HTTP service at AMANAT_KEEPER_URL exposing
    GET  /status          -> same shape as shared/mock/status.json
    GET  /txlog           -> same shape as shared/mock/txlog.json
    POST /vault-hash      {"hash": "0x..."}
    POST /contacts        {"contacts": [{"index", "name", "relation", "phone", "wallet", "status"}]}
    POST /contact-status  {"contact_index": 0-2, "status": "accepted" | "declined"}
    POST /beneficiaries   {"asset_id", "beneficiaries": [...]}
    POST /activate, /checkin, /confirm {"contact_index": 0-2}, /demo/miss-deadline
Until it is running, status/txlog come from shared/mock and actions are logged locally.
"""
import importlib.util
import json
import threading
from datetime import datetime, timezone

import httpx

from . import config

# ---------- claims ----------

_CLAIMS_AGENT = config.REPO_DIR / "claims" / "agent.py"


def _load_claims_agent():
    if not _CLAIMS_AGENT.exists():
        return None
    spec = importlib.util.spec_from_file_location("amanat_claims_agent", _CLAIMS_AGENT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, "get_claim_guide", None)


def claim_guide(asset: dict) -> dict:
    fn = _load_claims_agent()
    if fn is None:
        return {
            "asset_id": asset["id"],
            "institution": asset["institution"],
            "asset_type": asset["asset_type"],
            "steps": [],
            "documents": [],
            "sources": [],
            "disclaimer": "Guidance only, not legal advice.",
            "source": "stub",
            "note": "Claim agent not connected yet: claims/agent.py with get_claim_guide(asset).",
        }
    guide = fn(asset)
    guide.setdefault("asset_id", asset["id"])
    guide.setdefault("disclaimer", "Guidance only, not legal advice.")
    guide.setdefault("source", "claims-agent")
    return guide


# ---------- keeper / chain ----------

_local_log: list[dict] = []


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def keeper_online() -> bool:
    return bool(config.KEEPER_URL)


def _keeper_error(e: httpx.HTTPError) -> str:
    """The keeper's own explanation (e.g. "The grace period hasn't ended yet") when it
    sent one, instead of httpx's generic "Client error '409 Conflict' for url ..."."""
    resp = getattr(e, "response", None)
    if resp is not None:
        try:
            body = resp.json()
            msg = body.get("error") or body.get("detail") if isinstance(body, dict) else None
            if msg:
                return str(msg)
        except ValueError:
            pass
        return f"keeper answered HTTP {resp.status_code}"
    return f"keeper unreachable ({type(e).__name__})"


def _post(path: str, payload: dict, event: str, details: str, timeout: float = 30) -> dict:
    if keeper_online():
        try:
            r = httpx.post(f"{config.KEEPER_URL}{path}", json=payload, timeout=timeout)
            r.raise_for_status()
            return {"ok": True, "forwarded": True, "keeper": r.json() if r.content else None}
        except httpx.HTTPError as e:
            msg = _keeper_error(e)
            _local_log.append({"event": event, "tx_hash": None, "timestamp": _now(),
                               "explorer_url": None, "details": f"{details} (keeper error: {msg})"})
            return {"ok": False, "forwarded": False, "error": msg}
    _local_log.append({"event": event, "tx_hash": None, "timestamp": _now(),
                       "explorer_url": None, "details": f"{details} (keeper offline, not on-chain)"})
    return {"ok": True, "forwarded": False}


# Storing the vault hash on-chain waits for a block (up to ~60 s on MST), so it runs on a
# background worker instead of inside the request. Only the newest hash matters: if the
# vault changes 5 times while one transaction is pending, only the latest is sent next.
_hash_lock = threading.Condition()
_hash_pending: str | None = None
_hash_worker: threading.Thread | None = None


def _hash_loop():
    global _hash_pending
    while True:
        with _hash_lock:
            while _hash_pending is None:
                _hash_lock.wait()
            h, _hash_pending = _hash_pending, None
        _post("/vault-hash", {"hash": h}, "VaultHashStored", f"Vault hash {h[:12]}...", timeout=70)


def push_vault_hash(vault_hash: str) -> dict:
    global _hash_pending, _hash_worker
    if not keeper_online():
        return _post("/vault-hash", {"hash": vault_hash}, "VaultHashStored", f"Vault hash {vault_hash[:12]}...")
    with _hash_lock:
        _hash_pending = vault_hash
        if _hash_worker is None or not _hash_worker.is_alive():
            _hash_worker = threading.Thread(target=_hash_loop, daemon=True, name="vault-hash")
            _hash_worker.start()
        _hash_lock.notify()
    return {"ok": True, "forwarded": True, "queued": True}


def push_contacts(contacts: list[dict]) -> dict:
    # Invite links carry the contact's secret token, and the keeper has no use for phone
    # numbers: send only what it displays.
    safe = [{k: c.get(k) for k in ("index", "name", "relation", "wallet", "status")}
            for c in contacts]
    return _post("/contacts", {"contacts": safe}, "TrustedContactsSet", f"{len(safe)} trusted contacts")


def push_contact_status(index: int, status: str) -> dict:
    event = "ContactAccepted" if status == "accepted" else "ContactDeclined"
    return _post("/contact-status", {"contact_index": index, "status": status},
                 event, f"Trusted contact #{index + 1} {status}")


def push_beneficiaries(asset_id: str, beneficiaries: list[dict]) -> dict:
    return _post("/beneficiaries", {"asset_id": asset_id, "beneficiaries": beneficiaries},
                 "BeneficiariesSet", f"Beneficiaries for {asset_id}")


def keeper_action(path: str, payload: dict) -> dict:
    if not keeper_online():
        return {"ok": False, "forwarded": False,
                "error": "Keeper agent not connected (set AMANAT_KEEPER_URL)."}
    try:
        # The keeper waits up to ~55 s for the block before answering.
        r = httpx.post(f"{config.KEEPER_URL}{path}", json=payload, timeout=65)
        r.raise_for_status()
        return {"ok": True, "forwarded": True, "keeper": r.json() if r.content else None}
    except httpx.HTTPError as e:
        return {"ok": False, "forwarded": False, "error": _keeper_error(e)}


def _mock(name: str):
    return json.loads((config.MOCK_DIR / name).read_text(encoding="utf-8"))


# Demo-only state override used while no keeper is connected (see /demo/simulate-release).
_simulated_state: str | None = None


def simulate_state(state: str) -> None:
    global _simulated_state
    _simulated_state = state


def clear_simulation() -> None:
    global _simulated_state
    _simulated_state = None


def _mock_status() -> dict:
    s = {**_mock("status.json"), "source": "mock"}
    if _simulated_state:
        s["state"], s["source"] = _simulated_state, "simulated"
    return s


def status() -> dict:
    if keeper_online():
        try:
            r = httpx.get(f"{config.KEEPER_URL}/status", timeout=10)
            r.raise_for_status()
            return {**r.json(), "source": "keeper"}
        except httpx.HTTPError as e:
            # Keeper down: fail closed. Never report a simulated release here.
            return {**_mock("status.json"), "source": "mock", "error": f"keeper unreachable: {e}"}
    return _mock_status()


def txlog() -> list[dict]:
    if keeper_online():
        try:
            r = httpx.get(f"{config.KEEPER_URL}/txlog", timeout=10)
            r.raise_for_status()
            return r.json() + _local_log
        except httpx.HTTPError:
            pass
    return list(_local_log) or _mock("txlog.json")
