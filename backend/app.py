"""Amanat backend API. Run:  uvicorn app:app --reload --port 8000   (from backend/)"""
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from amanat import bridges, config
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
    name: str
    relation: str
    phone: str | None = None
    wallet: str | None = None


class ContactsRequest(BaseModel):
    contacts: list[Contact] = Field(min_length=3, max_length=3)


class ConfirmRequest(BaseModel):
    contact_index: int = Field(ge=0, le=2)


class ClaimStatusRequest(BaseModel):
    status: str = Field(pattern="^(not_started|in_progress|submitted|settled)$")


def _commit_hash() -> dict | None:
    return bridges.push_vault_hash(store.vault_hash) if store.vault_hash else None


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


@app.post("/contacts")
def set_contacts(req: ContactsRequest):
    contacts = store.set_contacts([c.model_dump() for c in req.contacts])
    chain = bridges.push_contacts(contacts)
    _commit_hash()
    return {"contacts": contacts, "required": 2, "chain": chain}


@app.get("/contacts")
def get_contacts():
    return {"contacts": store.contacts(), "required": 2}


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
    """Screen 9: everything assigned to one beneficiary, with claim guides."""
    mine = []
    for a in store.assets():
        share = next((b["share"] for b in a["beneficiaries"] if b["name"].lower() == name.lower()), None)
        if share is not None:
            mine.append({**a, "your_share": share,
                         "your_value": round((a.get("value") or 0) * share / 100, 2)})
    status = bridges.status()
    return {"beneficiary": name, "released": status.get("state") == "RELEASED",
            "status_source": status.get("source"), "assets": mine,
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
    return {"ok": True}
