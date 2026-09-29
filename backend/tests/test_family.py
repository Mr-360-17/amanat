"""Beneficiaries get a private link, and hear about it only at release."""
import pytest

from test_api import client, fresh_store, stranger  # noqa: F401


@pytest.fixture
def links():
    client.post("/demo/load")
    return {m["name"]: m["family_url"].rsplit("/", 1)[-1] for m in client.get("/family").json()}


def test_every_beneficiary_gets_a_link(links):
    assert set(links) == {"Sunita Kumar", "Rahul Kumar"}
    fam = client.get("/family").json()
    sunita = next(m for m in fam if m["name"] == "Sunita Kumar")
    assert sunita["assets"] == 4 and sunita["phone"] == "+91 90000 00010"
    assert sunita["notified_at"] is None


def test_before_release_link_shows_nothing_and_nobody_is_told(links):
    view = stranger.get(f"/family/{links['Sunita Kumar']}").json()
    assert view == {"released": False, "message": "There is nothing to show here yet."}
    assert [n for n in client.get("/notifications").json() if n["kind"] == "release"] == []
    assert stranger.get(f"/family/{links['Sunita Kumar']}/claim/A3").status_code == 404


def test_release_sends_each_beneficiary_their_link_once(links):
    client.post("/demo/simulate-release")
    client.get("/status")  # polling again must not re-send
    sms = [n for n in client.get("/notifications").json() if n["kind"] == "release"]
    assert sorted(n["to"] for n in sms) == ["Rahul Kumar", "Sunita Kumar"]
    sunita_sms = next(n for n in sms if n["to"] == "Sunita Kumar")
    assert sunita_sms["to_phone"] == "+91 90000 00010"
    assert sunita_sms["link"].endswith(links["Sunita Kumar"])


def test_after_release_each_person_sees_only_their_share(links):
    client.post("/demo/simulate-release")
    rahul = stranger.get(f"/family/{links['Rahul Kumar']}").json()
    assert rahul["released"] and rahul["owner_name"] == "Ramesh Kumar"
    assert sorted(a["asset_type"] for a in rahul["assets"]) == ["Fixed Deposit", "Mutual Fund"]
    assert rahul["total_value"] == 200000 + 180000
    assert stranger.get(f"/family/{links['Rahul Kumar']}/claim/A5").status_code == 200
    # Rahul can't open a claim for Sunita's LIC policy
    assert stranger.get(f"/family/{links['Rahul Kumar']}/claim/A3").status_code == 404


def test_family_list_is_owner_only_and_bad_links_fail(links):
    assert stranger.get("/family").status_code == 401
    assert stranger.get("/family/not-a-real-token").status_code == 404


def test_demo_links_stay_the_same_across_reset_and_load(links):
    contacts = {c["name"]: c["invite_url"] for c in client.get("/contacts").json()["contacts"]}
    tok = contacts["Suresh Iyer"].rsplit("/", 1)[-1]
    stranger.post(f"/circle/{tok}/accept")
    client.post("/demo/reset")
    client.post("/demo/load")
    again = {c["name"]: c["invite_url"] for c in client.get("/contacts").json()["contacts"]}
    fam = {m["name"]: m["family_url"].rsplit("/", 1)[-1] for m in client.get("/family").json()}
    assert again == contacts and fam == links
    # same link, fresh round: the phone just taps Accept again
    view = stranger.get(f"/circle/{tok}").json()
    assert view["contact"]["status"] == "pending"


def test_link_survives_split_changes(links):
    client.post("/beneficiaries", json={"asset_id": "A1", "beneficiaries": [
        {"name": "Sunita Kumar", "relation": "Wife", "share": 50},
        {"name": "Rahul Kumar", "relation": "Son", "share": 50}]})
    again = {m["name"]: m["family_url"].rsplit("/", 1)[-1] for m in client.get("/family").json()}
    assert again == links
