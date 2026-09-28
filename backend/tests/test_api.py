import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="amanat-test-")
os.environ.update({
    "AMANAT_LLM": "rules",
    "AMANAT_USE_CACHE": "0",
    "AMANAT_KEEPER_URL": "",
    "AMANAT_DATA_DIR": str(Path(_tmp) / "data"),
    "AMANAT_CACHE_DIR": str(Path(_tmp) / "cache"),
})
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app as app_module  # noqa: E402
from amanat import vault  # noqa: E402

PDFS = BACKEND / "dev_samples" / "pdfs"
client = TestClient(app_module.app)


@pytest.fixture(autouse=True)
def fresh_store():
    client.post("/demo/reset")
    yield


def _upload(*names):
    files = [("files", (n, (PDFS / n).read_bytes(), "application/pdf")) for n in names]
    return client.post("/upload", files=files)


def test_upload_all_five_finds_ramesh_assets():
    r = _upload("sbi_savings_statement.pdf", "sbi_fd_receipt.pdf", "lic_policy_bond.pdf",
                "epf_passbook.pdf", "hdfc_mf_statement.pdf")
    assert r.status_code == 200
    body = r.json()
    assert len(body["assets"]) == 5
    # FD is the one with no nominee
    assert [w["asset_id"] for w in body["warnings"]] == [
        a["id"] for a in body["assets"] if a["asset_type"] == "Fixed Deposit"]
    s = client.get("/summary").json()
    assert s["total_value"] == 2145000
    assert s["counts"] == {"Bank": 2, "Insurance": 1, "PF": 1, "Investments": 1, "Other": 0}
    assert s["owner"] == "Ramesh Kumar"
    assert s["missing_nominee"] == 1


def test_account_numbers_are_masked_but_vault_keeps_full():
    body = _upload("sbi_fd_receipt.pdf").json()
    assert body["assets"][0]["account_number"] == "XXXX1234"
    state, h = vault.open_vault()
    assert state["assets"][0]["account_number"] == "30556781234"
    assert h == body["vault_hash"] and h.startswith("0x")


def test_vault_file_is_not_plaintext():
    _upload("lic_policy_bond.pdf")
    raw = vault.VAULT_FILE.read_bytes()
    assert b"712457730" not in raw and b"Ramesh" not in raw


def test_same_document_twice_is_deduplicated():
    _upload("lic_policy_bond.pdf")
    r = _upload("lic_policy_bond.pdf").json()
    assert r["assets"] == [] and r["files"][0]["duplicates_skipped"] == 1
    assert len(client.get("/assets").json()) == 1


def test_beneficiary_shares_must_total_100():
    aid = _upload("sbi_fd_receipt.pdf").json()["assets"][0]["id"]
    bad = client.post("/beneficiaries", json={"asset_id": aid, "beneficiaries": [
        {"name": "Sunita Kumar", "relation": "Wife", "share": 60},
        {"name": "Rahul Kumar", "relation": "Son", "share": 30}]})
    assert bad.status_code == 422
    ok = client.post("/beneficiaries", json={"asset_id": aid, "beneficiaries": [
        {"name": "Sunita Kumar", "relation": "Wife", "share": 60},
        {"name": "Rahul Kumar", "relation": "Son", "share": 40}]})
    assert ok.status_code == 200
    view = client.get("/beneficiary/Rahul Kumar").json()
    assert view["assets"][0]["your_value"] == 200000


def test_vault_hash_changes_on_every_change():
    h1 = _upload("sbi_fd_receipt.pdf").json()["vault_hash"]
    aid = client.get("/assets").json()[0]["id"]
    client.post("/beneficiaries", json={"asset_id": aid, "beneficiaries": [
        {"name": "Sunita Kumar", "relation": "Wife", "share": 100}]})
    assert client.get("/summary").json()["vault_hash"] != h1


def test_contacts_need_exactly_three():
    two = [{"name": "A", "relation": "x"}, {"name": "B", "relation": "y"}]
    assert client.post("/contacts", json={"contacts": two}).status_code == 422
    three = two + [{"name": "C", "relation": "z"}]
    r = client.post("/contacts", json={"contacts": three})
    assert r.status_code == 200 and r.json()["required"] == 2


def test_claim_endpoint_works_without_claims_agent():
    aid = _upload("lic_policy_bond.pdf").json()["assets"][0]["id"]
    r = client.get(f"/claim/{aid}")
    assert r.status_code == 200
    assert "disclaimer" in r.json()


def test_keeper_offline_serves_mock_status_and_logs_locally():
    assert client.get("/status").json()["source"] == "mock"
    _upload("epf_passbook.pdf")
    log = client.get("/txlog").json()
    assert log[-1]["event"] == "VaultHashStored" and log[-1]["tx_hash"] is None
    assert client.post("/checkin").json()["ok"] is False


def test_demo_load_gives_agreed_dataset():
    s = client.post("/demo/load").json()
    assert s["asset_count"] == 5 and s["total_value"] == 2145000


def test_garbage_file_does_not_crash_upload():
    r = client.post("/upload", files=[("files", ("junk.pdf", b"%PDF-1.4 not really", "application/pdf"))])
    assert r.status_code == 200
    assert r.json()["assets"] == []
