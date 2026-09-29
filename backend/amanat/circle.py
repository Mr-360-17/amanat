"""Trusted Circle: the 3 trusted contacts know their role *before* anything happens.

Emergency (incapacity) mode: if something happens to the owner short of death (hospital,
unreachable), an accepted contact reports it; when 2 of 3 agree the circle gets ONLY
health cover and medical info (never the vault). The owner checking in cancels it.

- Each contact is invited the moment they are added and must accept (proves the number
  works and that they agree). Only accepted contacts can later confirm a death.
- Accepted contacts can always open an emergency card: the owner's contact details and
  WHERE assets exist. Never amounts, never account numbers; those are released only
  after 2-of-3 confirmation.
- Periodic "still reachable?" checks keep the circle from going stale.

All functions work on the decrypted vault state dict; Store handles locking + sealing.
"""
import secrets
from datetime import datetime, timedelta, timezone

from . import config

PENDING, ACCEPTED, DECLINED = "pending", "accepted", "declined"

DEFAULT_SHARE = {"address": True, "family": True, "doctor": True,
                 "institutions": True, "asset_types": True}

WHAT_TO_DO = [
    "If {first} is unwell or can't be reached, call the other people in this circle first.",
    "Amanat will only ask you to confirm if {first} misses their regular check-ins. You'll get a message.",
    "Confirm only when you are certain. 2 of the 3 people in this circle must confirm before anything is released.",
    "After release, the family receives the full asset details and a step-by-step claim guide.",
]
PRIVACY_NOTE = ("You can see where {first}'s assets are held, but not the amounts or account numbers. "
                "Those are released to the family only after 2 of 3 trusted contacts confirm.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(ts: str | None) -> datetime | None:
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) if ts else None


def _ensure(state: dict) -> None:
    state.setdefault("contacts", [])
    state.setdefault("profile", {})
    state.setdefault("notifications", [])
    state.setdefault("emergency", {"status": "none"})


def owner_name(state: dict) -> str:
    name = state.get("profile", {}).get("name")
    if name:
        return name
    owners = [a.get("owner") for a in state.get("assets", []) if a.get("owner")]
    return max(set(owners), key=owners.count) if owners else "Your family member"


def invite_url(token: str) -> str:
    return f"{config.INVITE_BASE_URL}/{token}"


# ---------- notifications (simulated outbox; the demo phone screen reads this) ----------

def notify(state: dict, contact: dict, kind: str, text: str, link: str | None = None) -> dict:
    _ensure(state)
    note = {"id": f"N{len(state['notifications']) + 1}", "kind": kind,
            "to": contact["name"], "to_phone": contact.get("phone"),
            "channel": "sms (simulated)", "text": text, "link": link, "timestamp": _iso(_now())}
    state["notifications"].append(note)
    return note


def _send_invite(state: dict, c: dict) -> dict:
    link = invite_url(c["token"])
    c["invited_at"] = _iso(_now())
    return notify(state, c, "invite",
                  f"{owner_name(state)} has chosen you as one of 3 trusted contacts on Amanat. "
                  f"Please open the link to accept: {link}", link)


# ---------- contacts ----------

def _same_person(old: dict, new: dict) -> bool:
    if new.get("phone") and old.get("phone"):
        return "".join(filter(str.isdigit, old["phone"])) == "".join(filter(str.isdigit, new["phone"]))
    return old["name"].strip().lower() == new["name"].strip().lower()


def set_contacts(state: dict, contacts: list[dict], tokens: dict[str, str] | None = None) -> list[dict]:
    """Replace the circle. People already in it keep their acceptance; new people are
    invited. `tokens` (name -> token) lets the demo reuse the same links after a reset.
    Returns the notifications sent."""
    _ensure(state)
    old = state["contacts"]
    tokens = tokens or {}
    result, sent = [], []
    for i, new in enumerate(contacts):
        match = next((c for c in old if _same_person(c, new)), None)
        if match:
            c = {**match, **{k: new.get(k) for k in ("name", "relation", "phone", "wallet")}}
        else:
            c = {"name": new["name"], "relation": new["relation"], "phone": new.get("phone"),
                 "wallet": new.get("wallet"), "status": PENDING,
                 "token": tokens.get(new["name"]) or new_token(),
                 "invited_at": None, "accepted_at": None,
                 "last_seen_at": None, "ping_pending_since": None}
        c["id"], c["index"] = f"C{i + 1}", i
        result.append(c)
        if not match:
            sent.append(_send_invite(state, c))
    state["contacts"] = result
    return sent


def resend_invite(state: dict, contact_id: str) -> dict:
    _ensure(state)
    for c in state["contacts"]:
        if c["id"] == contact_id:
            if c["status"] == ACCEPTED:
                raise ValueError(f"{c['name']} has already accepted")
            c["status"] = PENDING
            return _send_invite(state, c)
    raise KeyError(contact_id)


_ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"


def new_token(length: int = 18) -> str:
    """Letters and digits only: chat apps drop a trailing '-' or '_' from links, which
    silently broke a demo phone's link. (No 0/O/1/l/I, so it can be read aloud too.)"""
    return "".join(secrets.choice(_ALNUM) for _ in range(length))


def token_matches(stored: str, given: str) -> bool:
    """Exact match, or the same token with leading/trailing '-'/'_' lost in a chat app
    (older tokens could contain them)."""
    if secrets.compare_digest(stored.encode(), given.encode()):
        return True
    trimmed = stored.strip("-_")
    return trimmed != stored and len(trimmed) >= 12 and secrets.compare_digest(trimmed.encode(), given.encode())


def find(state: dict, token: str) -> dict | None:
    _ensure(state)
    return next((c for c in state["contacts"] if token_matches(c["token"], token)), None)


def respond(state: dict, token: str, accept: bool) -> dict:
    c = find(state, token)
    if c is None:
        raise KeyError("invalid invite link")
    now = _iso(_now())
    c["status"] = ACCEPTED if accept else DECLINED
    c["accepted_at"] = now if accept else None
    c["last_seen_at"] = now
    c["ping_pending_since"] = None
    return c


def answer_ping(state: dict, token: str) -> dict:
    c = find(state, token)
    if c is None:
        raise KeyError("invalid invite link")
    if c["status"] != ACCEPTED:
        raise ValueError("accept the invitation first")
    c["last_seen_at"] = _iso(_now())
    c["ping_pending_since"] = None
    return c


def ping_all(state: dict) -> list[dict]:
    """Send every accepted contact a one-tap 'still reachable?' check."""
    _ensure(state)
    sent = []
    for c in state["contacts"]:
        if c["status"] != ACCEPTED:
            continue
        c["ping_pending_since"] = _iso(_now())
        sent.append(notify(state, c, "reachability_check",
                           f"Amanat check: are you still reachable on this number as "
                           f"{owner_name(state)}'s trusted contact? Tap to confirm: "
                           f"{invite_url(c['token'])}", invite_url(c["token"])))
    return sent


def reachability(c: dict) -> str:
    if c["status"] == PENDING:
        return "not_accepted"
    if c["status"] == DECLINED:
        return "declined"
    if c.get("ping_pending_since"):
        return "awaiting_response"
    last = _parse(c.get("last_seen_at"))
    if last and _now() - last > timedelta(days=config.REACHABILITY_DAYS):
        return "stale"
    return "ok"


def owner_view(c: dict) -> dict:
    """What the owner's dashboard sees (includes the invite link to resend manually)."""
    return {k: c.get(k) for k in ("id", "index", "name", "relation", "phone", "wallet", "status",
                                  "invited_at", "accepted_at", "last_seen_at")} | {
        "reachability": reachability(c), "invite_url": invite_url(c["token"])}


def accepted_count(state: dict) -> int:
    return sum(1 for c in state.get("contacts", []) if c["status"] == ACCEPTED)


def warnings(state: dict) -> list[dict]:
    _ensure(state)
    out = []
    em = emergency_view(state)
    if em["status"] == "reported":
        out.append({"contact_id": None, "type": "emergency_reported",
                    "message": f"{em['reported_by']} reported you may be in an emergency "
                               f"(\"{em['reason']}\"). Check in if you are OK."})
    elif em["status"] == "active":
        out.append({"contact_id": None, "type": "emergency_active",
                    "message": "Emergency access is open: your circle can see your health cover and "
                               "medical details. Check in to close it."})
    for c in state["contacts"]:
        r = reachability(c)
        msg = {
            "not_accepted": f"{c['name']} hasn't accepted the trusted-contact invite yet",
            "declined": f"{c['name']} declined. Choose another trusted contact",
            "awaiting_response": f"{c['name']} hasn't answered the latest reachability check",
            "stale": f"{c['name']} hasn't been heard from in over {config.REACHABILITY_DAYS} days",
        }.get(r)
        if msg:
            out.append({"contact_id": c["id"], "type": f"contact_{r}", "message": msg})
    if state["contacts"] and accepted_count(state) < 2:
        out.append({"contact_id": None, "type": "circle_incomplete",
                    "message": "Fewer than 2 trusted contacts have accepted, so a release could never be confirmed"})
    return out


# ---------- owner profile + emergency card ----------

def get_profile(state: dict) -> dict:
    _ensure(state)
    p = dict(state["profile"])
    p.setdefault("name", owner_name(state))
    p["share"] = {**DEFAULT_SHARE, **p.get("share", {})}
    return p


def set_profile(state: dict, profile: dict) -> dict:
    _ensure(state)
    share = {k: bool(v) for k, v in (profile.get("share") or {}).items() if k in DEFAULT_SHARE}
    state["profile"] = {**profile, "share": {**DEFAULT_SHARE, **share}}
    return get_profile(state)


# ---------- emergency (incapacity) mode ----------

EMERGENCY_CONFIRMATIONS = 2


def _emergency(state: dict) -> dict:
    """Current emergency record, expiring an unconfirmed report after the configured hours."""
    _ensure(state)
    em = state["emergency"]
    if em.get("status") == "reported":
        reported = _parse(em.get("reported_at"))
        if reported and _now() - reported > timedelta(hours=config.EMERGENCY_REPORT_HOURS):
            em.update(status="expired", closed_at=_iso(_now()))
    return em


def _owner_as_recipient(state: dict) -> dict:
    return {"name": owner_name(state), "phone": state.get("profile", {}).get("phone")}


def _accepted_contact(state: dict, token: str) -> dict:
    c = find(state, token)
    if c is None:
        raise KeyError("invalid invite link")
    if c["status"] != ACCEPTED:
        raise PermissionError("accept the trusted-contact invitation first")
    return c


def report_emergency(state: dict, token: str, reason: str) -> dict:
    c = _accepted_contact(state, token)
    em = _emergency(state)
    if em.get("status") in ("reported", "active"):
        raise ValueError(f"an emergency is already {em['status']}; confirm it instead")
    first = owner_name(state).split()[0]
    state["emergency"] = em = {
        "status": "reported", "reason": reason.strip() or "Unreachable",
        "reported_by": c["id"], "reported_at": _iso(_now()), "confirmed_by": [c["id"]],
        "activated_at": None, "closed_at": None, "closed_by": None,
    }
    notify(state, _owner_as_recipient(state), "emergency_owner_alert",
           f"Amanat: {c['name']} reported that something may have happened to you "
           f"(\"{em['reason']}\"). If you are OK, open Amanat and check in to cancel.")
    for other in state["contacts"]:
        if other["id"] != c["id"] and other["status"] == ACCEPTED:
            notify(state, other, "emergency_confirm_request",
                   f"Amanat: {c['name']} reported that {first} may be in an emergency "
                   f"(\"{em['reason']}\"). If you know this is true, confirm here: "
                   f"{invite_url(other['token'])}", invite_url(other["token"]))
    return emergency_view(state)


def confirm_emergency(state: dict, token: str) -> dict:
    c = _accepted_contact(state, token)
    em = _emergency(state)
    if em.get("status") not in ("reported", "active"):
        raise ValueError("there is no open emergency report to confirm")
    if c["id"] not in em["confirmed_by"]:
        em["confirmed_by"].append(c["id"])
    if em["status"] == "reported" and len(em["confirmed_by"]) >= EMERGENCY_CONFIRMATIONS:
        em.update(status="active", activated_at=_iso(_now()))
        first = owner_name(state).split()[0]
        for other in state["contacts"]:
            if other["status"] == ACCEPTED:
                notify(state, other, "emergency_active",
                       f"Amanat: emergency access for {first} is now open to the trusted circle: "
                       f"health cover and medical details. {invite_url(other['token'])}",
                       invite_url(other["token"]))
        notify(state, _owner_as_recipient(state), "emergency_owner_alert",
               "Amanat: 2 trusted contacts confirmed an emergency. Your health cover and medical "
               "details are now visible to your circle. Check in any time to close it.")
    return emergency_view(state)


def close_emergency(state: dict, by: str = "owner") -> dict:
    """Owner is OK (check-in or 'I'm OK'). Cancels a report, or ends an active emergency."""
    em = _emergency(state)
    if em.get("status") not in ("reported", "active"):
        return emergency_view(state)
    em.update(status="cancelled" if em["status"] == "reported" else "resolved",
              closed_at=_iso(_now()), closed_by=by)
    first = owner_name(state).split()[0]
    for other in state["contacts"]:
        if other["status"] == ACCEPTED:
            notify(state, other, "emergency_closed",
                   f"Amanat: {first} checked in and is OK. The emergency is closed.")
    return emergency_view(state)


def emergency_view(state: dict) -> dict:
    em = _emergency(state)
    names = {c["id"]: c["name"] for c in state["contacts"]}
    return {
        "status": em.get("status", "none"),
        "reason": em.get("reason"),
        "reported_by": names.get(em.get("reported_by")),
        "reported_at": em.get("reported_at"),
        "confirmed_by": [names.get(i, i) for i in em.get("confirmed_by", [])],
        "confirmations": len(em.get("confirmed_by", [])),
        "confirmations_required": EMERGENCY_CONFIRMATIONS,
        "activated_at": em.get("activated_at"),
        "closed_at": em.get("closed_at"),
    }


def _emergency_access(state: dict) -> dict:
    """What the circle sees while an emergency is active: health + medical only."""
    p = get_profile(state)
    health_assets = [
        {"institution": a["institution"], "asset_type": a["asset_type"],
         "policy_number": a.get("account_number")}
        for a in state.get("assets", []) if a["asset_type"] == "Health Insurance"]
    return {
        "health_cover": ([p["health_cover"]] if p.get("health_cover") else []) + health_assets,
        "medical": p.get("medical") or {},
        "blood_group": p.get("blood_group"),
        "doctor": p.get("doctor"),
        "note": "Emergency access covers health and medical details only. Bank accounts, "
                "deposits, investments and life insurance stay locked.",
    }


def invite_view(state: dict, token: str) -> dict:
    """What a trusted contact sees when they open their link."""
    c = find(state, token)
    if c is None:
        raise KeyError("invalid invite link")
    owner = owner_name(state)
    first = owner.split()[0]
    base = {"contact": {"name": c["name"], "relation": c["relation"], "status": c["status"]},
            "owner_name": owner, "reachability": reachability(c)}
    if c["status"] != ACCEPTED:
        return {**base, "card": None, "message":
                f"{owner} has chosen you as one of 3 trusted contacts. If something ever happens to "
                f"{first}, Amanat will ask you to help confirm it, so the family can receive what "
                f"{first} left for them. Accept to see {first}'s emergency card."}
    em = emergency_view(state)
    return {**base, "card": _card(state, c), "emergency": em,
            "emergency_access": _emergency_access(state) if em["status"] == "active" else None}


def _card(state: dict, viewer: dict) -> dict:
    p = get_profile(state)
    share = p["share"]
    first = p["name"].split()[0]
    places = []
    if share["institutions"]:
        seen = set()
        for a in state.get("assets", []):
            key = (a["institution"], a["asset_type"] if share["asset_types"] else None)
            if key not in seen:
                seen.add(key)
                places.append({"institution": key[0]} | ({"asset_type": key[1]} if key[1] else {}))
    return {
        "owner": {"name": p["name"], "phone": p.get("phone"),
                  "address": p.get("address") if share["address"] else None,
                  "blood_group": p.get("blood_group")},
        "family": p.get("family", []) if share["family"] else [],
        "doctor": p.get("doctor") if share["doctor"] else None,
        "circle": [{"name": c["name"], "relation": c["relation"], "phone": c.get("phone"),
                    "status": c["status"], "you": c["id"] == viewer["id"]}
                   for c in state["contacts"]],
        "assets_held_at": places,
        "asset_count": len(state.get("assets", [])),
        "note": p.get("note"),
        "what_to_do": [s.format(first=first) for s in WHAT_TO_DO],
        "privacy_note": PRIVACY_NOTE.format(first=first),
    }
