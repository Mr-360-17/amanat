"""Backend <-> keeper, against a fake keeper that behaves like Pratham's adapter."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from test_api import client, fresh_store, stranger  # noqa: F401

received: list[tuple[str, dict]] = []


class FakeKeeper(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/status":
            self._send(200, {"state": "GRACE", "confirmations": 0, "confirmations_required": 2})
        else:
            self._send(200, [])

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        received.append((self.path, body))
        if self.path == "/confirm":
            return self._send(409, {"error": "The grace period hasn't ended yet; the owner gets the full window first",
                                    "contract_error": "GraceNotOver"})
        if self.path == "/vault-hash":
            time.sleep(2)  # like waiting for an MST block
        self._send(200, {"ok": True, "tx_hash": "0x" + "ab" * 32})


@pytest.fixture
def keeper(monkeypatch):
    from amanat import config
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeKeeper)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(config, "KEEPER_URL", f"http://127.0.0.1:{server.server_address[1]}")
    received.clear()
    yield received
    server.shutdown()


def test_contract_refusal_reason_reaches_the_contacts_phone(keeper):
    client.post("/demo/load")
    tok = client.get("/contacts").json()["contacts"][0]["invite_url"].rsplit("/", 1)[-1]
    stranger.post(f"/circle/{tok}/accept")
    r = stranger.post(f"/circle/{tok}/confirm").json()
    assert r["ok"] is False
    assert r["error"].startswith("The grace period hasn't ended yet")


def test_vault_hash_does_not_block_the_request(keeper):
    t0 = time.time()
    client.post("/demo/load")
    assert time.time() - t0 < 1.5  # the fake keeper takes 2 s per hash
    for _ in range(40):
        if any(p == "/vault-hash" for p, _ in keeper):
            break
        time.sleep(0.1)
    assert any(p == "/vault-hash" for p, _ in keeper)


def test_only_latest_hash_is_sent_when_changes_pile_up(keeper):
    client.post("/demo/load")
    for share in (50, 40, 30):  # 3 quick vault changes while the first hash is "mining"
        client.post("/beneficiaries", json={"asset_id": "A1", "beneficiaries": [
            {"name": "Sunita Kumar", "relation": "Wife", "share": share},
            {"name": "Rahul Kumar", "relation": "Son", "share": 100 - share}]})
    time.sleep(5)
    hashes = [b["hash"] for p, b in keeper if p == "/vault-hash"]
    assert hashes[-1] == client.get("/summary").json()["vault_hash"]
    assert len(hashes) <= 3  # not one transaction per change


def test_phone_numbers_and_tokens_never_sent_to_keeper(keeper):
    client.post("/demo/load")
    sent = json.dumps([b for p, b in keeper if p == "/contacts"])
    assert "Suresh Iyer" in sent and "+91" not in sent and "invite" not in sent


def test_reset_also_resets_the_chain(keeper):
    r = client.post("/demo/reset").json()
    assert ("/demo/reset", {}) in keeper and r["chain"]["ok"] is True
