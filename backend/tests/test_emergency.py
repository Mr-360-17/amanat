"""Emergency (incapacity) mode: 'something happens' short of death."""
from datetime import datetime, timedelta, timezone

import pytest

from test_api import client, fresh_store, stranger  # noqa: F401


def _tok(c):
    return c["invite_url"].rsplit("/", 1)[-1]


@pytest.fixture
def circle3():
    """Ramesh loaded; Suresh and Dr. Meena accepted, Anil still pending."""
    client.post("/demo/load")
    cs = client.get("/contacts").json()["contacts"]
    for c in cs[:2]:
        stranger.post(f"/circle/{_tok(c)}/accept")
    return [_tok(c) for c in cs]


def _inbox(kind):
    return [n for n in client.get("/notifications").json() if n["kind"] == kind]


def test_report_alerts_owner_and_asks_others_to_confirm(circle3):
    suresh, meena, anil = circle3
    r = stranger.post(f"/circle/{suresh}/emergency", json={"reason": "Admitted to hospital"})
    assert r.status_code == 200 and r.json()["status"] == "reported"
    owner_alert = _inbox("emergency_owner_alert")[0]
    assert owner_alert["to"] == "Ramesh Kumar" and "check in to cancel" in owner_alert["text"]
    asked = [n["to"] for n in _inbox("emergency_confirm_request")]
    assert asked == ["Dr. Meena Rao"]  # accepted others only; not Suresh, not pending Anil
    # the owner's dashboard shows it at the top
    assert client.get("/summary").json()["warnings"][0]["type"] == "emergency_reported"


def test_one_report_alone_reveals_nothing(circle3):
    suresh = circle3[0]
    stranger.post(f"/circle/{suresh}/emergency", json={"reason": "Not answering calls"})
    view = stranger.get(f"/circle/{suresh}").json()
    assert view["emergency"]["status"] == "reported" and view["emergency_access"] is None
    # the reporter confirming again doesn't count twice
    assert stranger.post(f"/circle/{suresh}/emergency/confirm").json()["status"] == "reported"


def test_second_confirmation_opens_health_and_medical_only(circle3):
    suresh, meena, _ = circle3
    stranger.post(f"/circle/{suresh}/emergency", json={"reason": "Admitted to hospital"})
    r = stranger.post(f"/circle/{meena}/emergency/confirm").json()
    assert r["status"] == "active" and r["confirmed_by"] == ["Suresh Iyer", "Dr. Meena Rao"]
    access = stranger.get(f"/circle/{suresh}").json()["emergency_access"]
    assert access["health_cover"][0]["insurer"].startswith("Star Health")
    assert access["medical"]["allergies"] == "Penicillin" and access["blood_group"] == "B+"
    flat = str(access)
    for vault_secret in ("30556781234", "712457730", "500000.0", "1000000", "Fixed Deposit", "EPFO"):
        assert vault_secret not in flat
    # beneficiary view is still locked: emergency is not death
    assert client.get("/beneficiary/Sunita Kumar").json()["released"] is False


def test_medical_details_hidden_until_emergency_active(circle3):
    view = stranger.get(f"/circle/{circle3[0]}").json()
    flat = str(view)
    assert "Penicillin" not in flat and "SH-0000" not in flat and "Metformin" not in flat


def test_pending_contact_cannot_report_or_confirm(circle3):
    anil = circle3[2]
    assert stranger.post(f"/circle/{anil}/emergency", json={"reason": "x"}).status_code == 403
    stranger.post(f"/circle/{circle3[0]}/emergency", json={"reason": "x"})
    assert stranger.post(f"/circle/{anil}/emergency/confirm").status_code == 403


def test_owner_checkin_cancels_report(circle3):
    stranger.post(f"/circle/{circle3[0]}/emergency", json={"reason": "Phone switched off"})
    r = client.post("/checkin").json()
    assert r["emergency"]["status"] == "cancelled"
    assert [n["to"] for n in _inbox("emergency_closed")] == ["Dr. Meena Rao", "Suresh Iyer"]
    assert stranger.post(f"/circle/{circle3[1]}/emergency/confirm").status_code == 409


def test_owner_im_ok_ends_active_emergency(circle3):
    suresh, meena, _ = circle3
    stranger.post(f"/circle/{suresh}/emergency", json={"reason": "Hospital"})
    stranger.post(f"/circle/{meena}/emergency/confirm")
    assert client.post("/emergency/cancel").json()["status"] == "resolved"
    assert stranger.get(f"/circle/{suresh}").json()["emergency_access"] is None
    # a new report can be filed afterwards
    assert stranger.post(f"/circle/{meena}/emergency", json={"reason": "Again"}).status_code == 200


def test_duplicate_report_is_rejected(circle3):
    stranger.post(f"/circle/{circle3[0]}/emergency", json={"reason": "Hospital"})
    assert stranger.post(f"/circle/{circle3[1]}/emergency", json={"reason": "Hospital"}).status_code == 409


def test_unconfirmed_report_expires(circle3, monkeypatch):
    from amanat import circle
    stranger.post(f"/circle/{circle3[0]}/emergency", json={"reason": "Hospital"})
    later = datetime.now(timezone.utc) + timedelta(hours=49)
    monkeypatch.setattr(circle, "_now", lambda: later)
    assert client.get("/emergency").json()["status"] == "expired"
    assert stranger.post(f"/circle/{circle3[1]}/emergency/confirm").status_code == 409


def test_emergency_routes_are_owner_or_token_only(circle3):
    assert stranger.get("/emergency").status_code == 401
    assert stranger.post("/emergency/cancel").status_code == 401
    assert stranger.post("/circle/fake-token/emergency", json={"reason": "x"}).status_code == 404
