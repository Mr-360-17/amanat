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
    "AMANAT_OWNER_KEY": "test-owner-key",
})
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app as app_module  # noqa: E402
from amanat import vault  # noqa: E402

PDFS = BACKEND / "dev_samples" / "pdfs"
client = TestClient(app_module.app, headers={"X-Amanat-Key": "test-owner-key"})
stranger = TestClient(app_module.app)  # someone else on the venue Wi-Fi


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
    client.post("/demo/simulate-release")
    view = client.get("/beneficiary/Rahul Kumar").json()
    assert view["assets"][0]["your_value"] == 200000


def test_beneficiary_sees_nothing_before_release():
    client.post("/demo/load")
    view = client.get("/beneficiary/Sunita Kumar").json()
    assert view["released"] is False and view["assets"] == [] and view["total_value"] is None
    flat = str(view)
    for secret in ("SBI", "LIC", "1000000", "XXXX"):
        assert secret not in flat


def test_after_release_beneficiary_gets_full_account_numbers():
    _upload("sbi_fd_receipt.pdf")
    aid = client.get("/assets").json()[0]["id"]
    client.post("/beneficiaries", json={"asset_id": aid, "beneficiaries": [
        {"name": "Sunita Kumar", "relation": "Wife", "share": 100}]})
    assert client.get("/assets").json()[0]["account_number"] == "XXXX1234"  # owner API stays masked
    assert client.post("/demo/simulate-release").json()["state"] == "RELEASED"
    view = client.get("/beneficiary/sunita kumar").json()
    assert view["released"] is True
    assert view["assets"][0]["account_number"] == "30556781234"


def test_reset_clears_simulated_release():
    client.post("/demo/simulate-release")
    client.post("/demo/reset")
    assert client.get("/status").json()["state"] == "ACTIVE"


def test_simulated_release_refused_when_real_keeper_connected(monkeypatch):
    from amanat import config
    monkeypatch.setattr(config, "KEEPER_URL", "http://127.0.0.1:9")
    assert client.post("/demo/simulate-release").status_code == 409


def test_vault_hash_changes_on_every_change():
    h1 = _upload("sbi_fd_receipt.pdf").json()["vault_hash"]
    aid = client.get("/assets").json()[0]["id"]
    client.post("/beneficiaries", json={"asset_id": aid, "beneficiaries": [
        {"name": "Sunita Kumar", "relation": "Wife", "share": 100}]})
    assert client.get("/summary").json()["vault_hash"] != h1


def test_contacts_need_exactly_three_with_phones():
    two = [{"name": "A", "relation": "x", "phone": "+91 90000 00001"},
           {"name": "B", "relation": "y", "phone": "+91 90000 00002"}]
    assert client.post("/contacts", json={"contacts": two}).status_code == 422
    no_phone = two + [{"name": "C", "relation": "z"}]
    assert client.post("/contacts", json={"contacts": no_phone}).status_code == 422
    three = two + [{"name": "C", "relation": "z", "phone": "+91 90000 00003"}]
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


def test_stranger_without_owner_key_is_locked_out():
    client.post("/demo/load")
    for method, path in [("get", "/assets"), ("get", "/summary"), ("get", "/profile"),
                         ("get", "/contacts"), ("get", "/notifications"), ("post", "/demo/reset"),
                         ("post", "/circle/ping-all"), ("get", "/beneficiary/Sunita Kumar"),
                         ("post", "/demo/simulate-release"), ("get", "/assets/A1")]:
        assert getattr(stranger, method)(path).status_code == 401, path
    wrong = TestClient(app_module.app, headers={"X-Amanat-Key": "guess"})
    assert wrong.get("/assets").status_code == 401
    # raw non-ASCII bytes must give 401, not crash the comparison
    weird = TestClient(app_module.app, headers={"X-Amanat-Key": "ключ".encode("utf-8")})
    assert weird.get("/assets").status_code == 401
    assert client.get("/summary").json()["asset_count"] == 5  # reset was refused


def test_public_pages_need_no_key():
    for path in ("/", "/health", "/docs", "/openapi.json"):
        assert stranger.get(path).status_code == 200, path


def test_cors_preflight_and_401_carry_cors_headers():
    pre = stranger.options("/assets", headers={"Origin": "http://localhost:5173",
                                                "Access-Control-Request-Method": "GET",
                                                "Access-Control-Request-Headers": "x-amanat-key"})
    assert pre.status_code == 200
    r = stranger.get("/assets", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 401 and "access-control-allow-origin" in r.headers


def test_upload_runs_files_in_parallel(monkeypatch):
    import threading
    import time as _t
    from amanat.extractors import rules
    running, peak, lock = [0], [0], threading.Lock()
    real = rules.extract

    def slow(text):
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        _t.sleep(0.3)
        with lock:
            running[0] -= 1
        return real(text)

    monkeypatch.setattr(rules, "extract", slow)
    t0 = _t.time()
    r = _upload("sbi_fd_receipt.pdf", "lic_policy_bond.pdf", "epf_passbook.pdf")
    assert r.status_code == 200 and len(r.json()["assets"]) == 3
    assert peak[0] >= 2 and _t.time() - t0 < 0.8  # 3 x 0.3 s ran together, not 0.9 s in a row
    # IDs still follow upload order
    assert [a["source_doc"] for a in r.json()["assets"]] == [
        "sbi_fd_receipt.pdf", "lic_policy_bond.pdf", "epf_passbook.pdf"]


def test_demo_load_gives_agreed_dataset():
    s = client.post("/demo/load").json()
    assert s["asset_count"] == 5 and s["total_value"] == 2145000


def test_garbage_file_does_not_crash_upload():
    r = client.post("/upload", files=[("files", ("junk.pdf", b"%PDF-1.4 not really", "application/pdf"))])
    assert r.status_code == 200
    assert r.json()["assets"] == []
