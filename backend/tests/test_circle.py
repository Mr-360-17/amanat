"""Trusted Circle: contacts know their role before anything happens."""
from test_api import client, vault  # noqa: F401  (shares the temp data dir + reset fixture)
from test_api import fresh_store  # noqa: F401

import pytest

CONTACTS = [
    {"name": "Suresh Iyer", "relation": "Brother-in-law", "phone": "+91 90000 00001"},
    {"name": "Dr. Meena Rao", "relation": "Family doctor", "phone": "+91 90000 00002"},
    {"name": "Anil Shetty", "relation": "Friend", "phone": "+91 90000 00003"},
]


def _token(url: str) -> str:
    return url.rsplit("/", 1)[-1]


@pytest.fixture
def demo():
    client.post("/demo/load")
    return client.get("/contacts").json()["contacts"]


def test_adding_contacts_sends_invites_immediately():
    r = client.post("/contacts", json={"contacts": CONTACTS}).json()
    assert len(r["invites_sent"]) == 3
    assert all(c["status"] == "pending" for c in r["contacts"])
    inbox = client.get("/notifications").json()
    assert inbox[0]["kind"] == "invite" and "trusted contacts" in inbox[0]["text"]
    assert inbox[0]["to_phone"].startswith("+91")


def test_pending_contact_sees_invitation_not_card(demo):
    view = client.get(f"/circle/{_token(demo[0]['invite_url'])}").json()
    assert view["card"] is None
    assert "Ramesh Kumar has chosen you" in view["message"]


def test_accepting_reveals_card_without_amounts_or_account_numbers(demo):
    view = client.post(f"/circle/{_token(demo[0]['invite_url'])}/accept").json()
    card = view["card"]
    assert view["contact"]["status"] == "accepted"
    assert card["owner"]["phone"] and card["doctor"]["name"] == "Dr. Meena Rao"
    assert {"institution": "LIC", "asset_type": "Life Insurance"} in card["assets_held_at"]
    assert [c["you"] for c in card["circle"]] == [True, False, False]
    flat = str(card)
    for secret in ("1000000", "500000", "XXXX", "712457730", "30556781234"):
        assert secret not in flat


def test_owner_can_hide_address_and_asset_types(demo):
    profile = client.get("/profile").json()
    profile["share"].update({"address": False, "asset_types": False})
    client.put("/profile", json=profile)
    card = client.post(f"/circle/{_token(demo[1]['invite_url'])}/accept").json()["card"]
    assert card["owner"]["address"] is None
    assert all(set(p) == {"institution"} for p in card["assets_held_at"])


def test_dashboard_flags_unaccepted_and_incomplete_circle(demo):
    s = client.get("/summary").json()
    types = [w["type"] for w in s["warnings"]]
    assert types.count("contact_not_accepted") == 3 and "circle_incomplete" in types
    for c in demo[:2]:
        client.post(f"/circle/{_token(c['invite_url'])}/accept")
    s = client.get("/summary").json()
    assert s["circle"] == {"total": 3, "accepted": 2, "required": 2}
    assert "circle_incomplete" not in [w["type"] for w in s["warnings"]]


def test_only_accepted_contacts_can_confirm(demo):
    r = client.post("/confirm", json={"contact_index": 2})
    assert r.status_code == 403 and "never accepted" in r.json()["detail"]
    client.post(f"/circle/{_token(demo[2]['invite_url'])}/accept")
    # accepted now: request passes the check and goes to the keeper (offline in tests)
    assert client.post("/confirm", json={"contact_index": 2}).status_code == 200


def test_reachability_check_round_trip(demo):
    tok = _token(demo[0]["invite_url"])
    client.post(f"/circle/{tok}/accept")
    sent = client.post("/circle/ping-all").json()["sent"]
    assert [n["to"] for n in sent] == ["Suresh Iyer"]  # only accepted contacts are pinged
    c = client.get("/contacts").json()["contacts"][0]
    assert c["reachability"] == "awaiting_response"
    client.post(f"/circle/{tok}/ping")
    assert client.get("/contacts").json()["contacts"][0]["reachability"] == "ok"


def test_resaving_contacts_keeps_acceptance(demo):
    client.post(f"/circle/{_token(demo[0]['invite_url'])}/accept")
    changed = CONTACTS[:2] + [{"name": "Kavya Rao", "relation": "Cousin", "phone": "+91 90000 00004"}]
    r = client.post("/contacts", json={"contacts": changed}).json()
    assert [c["status"] for c in r["contacts"]] == ["accepted", "pending", "pending"]
    assert [n["to"] for n in r["invites_sent"]] == ["Kavya Rao"]  # only the new person


def test_declined_contact_is_flagged_and_can_be_reinvited(demo):
    client.post(f"/circle/{_token(demo[0]['invite_url'])}/decline")
    assert "contact_declined" in [w["type"] for w in client.get("/summary").json()["warnings"]]
    assert client.post(f"/contacts/{demo[0]['id']}/resend").status_code == 200


def test_contact_links_work_without_owner_key(demo):
    from test_api import stranger
    tok = _token(demo[0]["invite_url"])
    assert stranger.get(f"/circle/{tok}").status_code == 200
    assert stranger.post(f"/circle/{tok}/accept").json()["card"] is not None
    assert stranger.post(f"/circle/{tok}/ping").status_code == 200
    # ...but a contact can't reach owner routes
    assert stranger.post("/circle/ping-all").status_code == 401


def test_contact_confirms_from_own_link_only_after_accepting(demo):
    from test_api import stranger
    tok = _token(demo[1]["invite_url"])
    assert stranger.post(f"/circle/{tok}/confirm").status_code == 403
    stranger.post(f"/circle/{tok}/accept")
    assert stranger.post(f"/circle/{tok}/confirm").status_code == 200  # forwarded to keeper
    assert stranger.post("/circle/bogus-token/confirm").status_code == 404


def test_bad_token_is_rejected():
    assert client.get("/circle/not-a-real-token").status_code == 404
    assert client.post("/circle/not-a-real-token/accept").status_code == 404


def test_vault_hides_contacts_and_tokens(demo):
    raw = vault.VAULT_FILE.read_bytes()
    assert b"Suresh" not in raw and _token(demo[0]["invite_url"]).encode() not in raw


def test_invite_tokens_never_sent_to_keeper(monkeypatch):
    from amanat import bridges
    sent = []
    monkeypatch.setattr(bridges, "_post", lambda path, payload, *a: sent.append(payload) or {"ok": True})
    client.post("/contacts", json={"contacts": CONTACTS})
    payload = str(sent[0])
    assert "Suresh Iyer" in payload
    assert "invite_url" not in payload and "token" not in payload
