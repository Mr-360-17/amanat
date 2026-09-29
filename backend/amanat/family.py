"""Beneficiaries ("family") get their own private link, like trusted contacts do, but they
are only told about it when the vault is RELEASED. Before release the link shows nothing.

All functions work on the decrypted vault state dict; Store handles locking + sealing.
"""
from . import circle, config


def family_url(token: str) -> str:
    return f"{config.FAMILY_BASE_URL}/{token}"


def _key(name: str) -> str:
    return " ".join(name.lower().split())


def sync(state: dict, tokens: dict[str, str] | None = None) -> list[dict]:
    """Make sure every person named as a beneficiary on any asset has a private link.
    Existing people keep their token; people no longer named are dropped. `tokens`
    (name -> token) lets the demo reuse the same links after a reset."""
    tokens = tokens or {}
    state.setdefault("family", [])
    existing = {_key(m["name"]): m for m in state["family"]}
    phones = {_key(p["name"]): p.get("phone") for p in state.get("profile", {}).get("family", [])
              if p.get("name")}
    members, seen = [], set()
    for a in state.get("assets", []):
        for b in a.get("beneficiaries", []):
            k = _key(b["name"])
            if k in seen:
                continue
            seen.add(k)
            m = existing.get(k) or {"token": tokens.get(b["name"]) or circle.new_token(),
                                    "notified_at": None}
            members.append({**m, "name": b["name"], "relation": b.get("relation"),
                            "phone": phones.get(k) or m.get("phone")})
    state["family"] = members
    return members


def find(state: dict, token: str) -> dict | None:
    return next((m for m in state.get("family", []) if circle.token_matches(m["token"], token)), None)


def _assets_for(state: dict, name: str) -> list[dict]:
    out = []
    for a in state.get("assets", []):
        share = next((b["share"] for b in a.get("beneficiaries", []) if _key(b["name"]) == _key(name)), None)
        if share is not None:
            out.append({**a, "your_share": share,
                        "your_value": round((a.get("value") or 0) * share / 100, 2)})
    return out


def on_release(state: dict) -> list[dict]:
    """Called whenever the vault is seen as RELEASED: tell each beneficiary once."""
    sync(state)
    owner = circle.owner_name(state)
    sent = []
    for m in state["family"]:
        if m.get("notified_at") or not _assets_for(state, m["name"]):
            continue
        m["notified_at"] = circle._iso(circle._now())
        sent.append(circle.notify(state, m, "release",
                                  f"Amanat: {owner} left something for you and asked Amanat to keep "
                                  f"it safe until now. Open your private page: {family_url(m['token'])}",
                                  family_url(m["token"])))
    return sent


def view(state: dict, token: str, released: bool) -> dict:
    m = find(state, token)
    if m is None:
        raise KeyError("invalid link")
    if not released:
        # Reveal nothing, not even whose vault this is.
        return {"released": False, "message": "There is nothing to show here yet."}
    mine = _assets_for(state, m["name"])
    return {"released": True, "beneficiary": m["name"], "relation": m.get("relation"),
            "owner_name": circle.owner_name(state), "assets": mine,
            "total_value": sum(x["your_value"] for x in mine)}


def owner_list(state: dict) -> list[dict]:
    """Owner/presenter view: who will receive what, with their (not yet sent) links."""
    sync(state)
    return [{"name": m["name"], "relation": m.get("relation"), "phone": m.get("phone"),
             "assets": len(_assets_for(state, m["name"])), "notified_at": m.get("notified_at"),
             "family_url": family_url(m["token"])} for m in state["family"]]
