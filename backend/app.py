"""Amanat backend API. Run:  uvicorn app:app --reload --port 8000   (from backend/)"""
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from amanat import bridges, circle, config
from amanat.extractors import extract_document
from amanat.schema import Beneficiary
from amanat.store import Store

app = FastAPI(title="Amanat API", version="0.1.0",
              description="Your family's inheritance, held in trust.")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                   allow_methods=["*"], allow_headers=["*"])

store = Store()
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


class BeneficiaryRequest(BaseModel):
    asset_id: str
    beneficiaries: list[Beneficiary]


class Contact(BaseModel):
    name: str = Field(min_length=1)
    relation: str
    phone: str = Field(min_length=6)  # needed so they can be told before anything happens
    wallet: str | None = None


class Person(BaseModel):
    name: str
    relation: str | None = None
    phone: str | None = None


class ShareSettings(BaseModel):
    address: bool = True
    family: bool = True
    doctor: bool = True
    institutions: bool = True
    asset_types: bool = True


class Profile(BaseModel):
    name: str | None = None
    phone: str | None = None
    address: str | None = None
    blood_group: str | None = None
    family: list[Person] = []
    doctor: Person | None = None
    note: str | None = None
    share: ShareSettings = ShareSettings()


class ContactsRequest(BaseModel):
    contacts: list[Contact] = Field(min_length=3, max_length=3)


class ConfirmRequest(BaseModel):
    contact_index: int = Field(ge=0, le=2)


class ClaimStatusRequest(BaseModel):
    status: str = Field(pattern="^(not_started|in_progress|submitted|settled)$")


def _commit_hash() -> dict | None:
    return bridges.push_vault_hash(store.vault_hash) if store.vault_hash else None


@app.get("/", response_class=HTMLResponse)
def home():
    """Open http://<laptop-ip>:8000/ on a phone to check it can reach the backend."""
    h = health()
    rows = "".join(f"<li>{k.replace('_', ' ')}: <b>{v}</b></li>" for k, v in h.items())
    return (
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Amanat</title><body style='font-family:system-ui;padding:24px;max-width:480px'>"
        "<h1 style='margin:0'>Amanat</h1><p style='color:#555'>Your family's inheritance, held in trust.</p>"
        "<p style='font-size:20px;color:#15803d'>&#10003; This device can reach the backend.</p>"
        f"<ul>{rows}</ul><p><a href='/docs'>API docs</a></p></body>"
    )


@app.get("/health")
def health():
    return {"ok": True, "llm_provider": config.resolve_provider(),
            "keeper_connected": bridges.keeper_online(),
            "claims_agent_connected": (config.REPO_DIR / "claims" / "agent.py").exists()}


@app.post("/upload")
async def upload(files: list[UploadFile] = File(...)):
    results, all_added = [], []
    for f in files:
        data = await f.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"{f.filename} is larger than 15 MB")
        try:
            extraction = extract_document(f.filename or "upload", data)
        except Exception as e:  # unreadable / corrupt file: report it, keep the others
            results.append({"file": f.filename, "error": f"could not read file: {e}", "assets": []})
            continue
        added, dupes = store.add_extracted(extraction["assets"], f.filename)
        all_added += added
        results.append({"file": f.filename, "extracted_by": extraction["extracted_by"],
                        "note": extraction["note"], "assets": added, "duplicates_skipped": dupes})
    chain = _commit_hash() if all_added else None
    return {"files": results, "assets": all_added,
            "warnings": [w for w in store.warnings()
                         if w["type"] == "missing_nominee" and w["asset_id"] in {a["id"] for a in all_added}],
            "vault_hash": store.vault_hash, "chain": chain}


@app.get("/assets")
def assets():
    return store.assets()


@app.get("/assets/{asset_id}")
def asset(asset_id: str):
    a = store.get(asset_id)
    if a is None:
        raise HTTPException(404, f"no asset {asset_id}")
    return a


@app.get("/summary")
def summary():
    return store.summary()


@app.post("/beneficiaries")
def set_beneficiaries(req: BeneficiaryRequest):
    try:
        updated = store.set_beneficiaries(req.asset_id, req.beneficiaries)
    except KeyError:
        raise HTTPException(404, f"no asset {req.asset_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))
    chain = bridges.push_beneficiaries(req.asset_id, updated["beneficiaries"])
    _commit_hash()
    return {"asset": updated, "chain": chain}


# ---- trusted circle (owner side) ----

def _circle_view(state: dict) -> dict:
    return {"contacts": [circle.owner_view(c) for c in state.get("contacts", [])],
            "accepted": circle.accepted_count(state), "required": 2}


@app.post("/contacts")
def set_contacts(req: ContactsRequest):
    sent = store.mutate(lambda s: circle.set_contacts(s, [c.model_dump() for c in req.contacts]))
    view = store.read(_circle_view)
    chain = bridges.push_contacts(view["contacts"])
    _commit_hash()
    return {**view, "invites_sent": sent, "chain": chain}


@app.get("/contacts")
def get_contacts():
    return store.read(_circle_view)


@app.post("/contacts/{contact_id}/resend")
def resend_invite(contact_id: str):
    try:
        return store.mutate(lambda s: circle.resend_invite(s, contact_id))
    except KeyError:
        raise HTTPException(404, f"no contact {contact_id}")
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.post("/circle/ping-all")
def ping_all():
    """Send accepted contacts a one-tap 'are you still reachable?' check."""
    sent = store.mutate(circle.ping_all)
    return {"sent": sent, **store.read(_circle_view)}


@app.get("/notifications")
def notifications():
    """Simulated SMS outbox. The demo 'phone' screens read the latest message from here."""
    return store.read(lambda s: list(reversed(s.get("notifications", []))))


@app.get("/profile")
def get_profile():
    return store.read(circle.get_profile)


@app.put("/profile")
def put_profile(profile: Profile):
    result = store.mutate(lambda s: circle.set_profile(s, profile.model_dump()))
    _commit_hash()
    return result


# ---- trusted circle (contact side: opened from the invite link) ----

def _by_token(fn, token: str):
    try:
        return store.mutate(lambda s: fn(s, token))
    except KeyError:
        raise HTTPException(404, "This invite link is not valid")
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.get("/circle/{token}")
def circle_view(token: str):
    try:
        return store.read(lambda s: circle.invite_view(s, token))
    except KeyError:
        raise HTTPException(404, "This invite link is not valid")


def _respond(token: str, accept: bool):
    c = _by_token(lambda s, t: circle.respond(s, t, accept), token)
    bridges.push_contact_status(c["index"], c["status"])
    _commit_hash()
    return store.read(lambda s: circle.invite_view(s, token))


@app.post("/circle/{token}/accept")
def circle_accept(token: str):
    return _respond(token, True)


@app.post("/circle/{token}/decline")
def circle_decline(token: str):
    return _respond(token, False)


@app.post("/circle/{token}/ping")
def circle_ping(token: str):
    """Contact answers 'yes, still reachable'."""
    _by_token(circle.answer_ping, token)
    return store.read(lambda s: circle.invite_view(s, token))


@app.get("/claim/{asset_id}")
def claim(asset_id: str):
    a = store.get(asset_id)
    if a is None:
        raise HTTPException(404, f"no asset {asset_id}")
    try:
        return bridges.claim_guide(a)
    except Exception as e:
        raise HTTPException(502, f"claim agent failed: {e}")


@app.post("/claim/{asset_id}/status")
def claim_status(asset_id: str, req: ClaimStatusRequest):
    try:
        return store.set_claim_status(asset_id, req.status)
    except KeyError:
        raise HTTPException(404, f"no asset {asset_id}")


@app.get("/beneficiary/{name}")
def beneficiary_view(name: str):
    """Screen 9: what one beneficiary receives. Reveals NOTHING until the keeper reports
    RELEASED (2 of 3 trusted contacts confirmed). After release it includes the full,
    unmasked account numbers, because the family needs them to file claims."""
    status = bridges.status()
    if status.get("state") != "RELEASED":
        return {"beneficiary": name, "released": False, "status_source": status.get("source"),
                "message": "Nothing has been released. Amanat releases assets only after the "
                           "owner misses check-ins and 2 of 3 trusted contacts confirm.",
                "assets": [], "total_value": None}
    mine = []
    for a in store.read(lambda s: [dict(x) for x in s["assets"]]):
        share = next((b["share"] for b in a["beneficiaries"] if b["name"].lower() == name.lower()), None)
        if share is not None:
            mine.append({**a, "your_share": share,
                         "your_value": round((a.get("value") or 0) * share / 100, 2)})
    return {"beneficiary": name, "released": True, "status_source": status.get("source"),
            "owner_name": store.read(circle.owner_name), "assets": mine,
            "total_value": sum(x["your_value"] for x in mine)}


# ---- protection / chain (proxied to Pratham's keeper agent) ----

@app.get("/status")
def status():
    return bridges.status()


@app.get("/txlog")
def txlog():
    return bridges.txlog()


@app.post("/activate")
def activate():
    return bridges.keeper_action("/activate", {"vault_hash": store.vault_hash})


@app.post("/checkin")
def checkin():
    return bridges.keeper_action("/checkin", {})


@app.post("/confirm")
def confirm(req: ConfirmRequest):
    contacts = store.read(lambda s: s.get("contacts", []))
    if req.contact_index >= len(contacts):
        raise HTTPException(404, "no such trusted contact")
    c = contacts[req.contact_index]
    if c["status"] != circle.ACCEPTED:
        raise HTTPException(403, f"{c['name']} never accepted the trusted-contact role, "
                                 "so they cannot confirm")
    return bridges.keeper_action("/confirm", req.model_dump())


@app.post("/demo/miss-deadline")
def miss_deadline():
    return bridges.keeper_action("/demo/miss-deadline", {})


# ---- demo helpers ----

@app.post("/demo/load")
def demo_load():
    """Load Ramesh's agreed dataset without uploading (frontend dev / emergency fallback)."""
    result = store.load_demo()
    _commit_hash()
    return result


@app.post("/demo/reset")
def demo_reset():
    store.reset()
    bridges.clear_simulation()
    return {"ok": True}


@app.post("/demo/simulate-release")
def demo_simulate_release():
    """Frontend dev only: pretend the keeper released, so screen 9 can be built before
    Pratham's contract is connected. Refused once a real keeper is connected."""
    if bridges.keeper_online():
        raise HTTPException(409, "A real keeper is connected; release happens on-chain only")
    bridges.simulate_state("RELEASED")
    return bridges.status()
