"""In-memory asset map, persisted to the encrypted vault after every change."""
import json
import threading
from collections import Counter

from . import circle, config, vault
from .schema import Asset, Beneficiary, canonical_asset_type, category, mask_account

_EMPTY = {"assets": [], "contacts": [], "profile": {}, "notifications": []}


class Store:
    def __init__(self):
        self._lock = threading.Lock()
        state, self.vault_hash = vault.open_vault()
        self._state = state or json.loads(json.dumps(_EMPTY))

    # ---- persistence ----
    def _commit(self) -> str:
        self.vault_hash = vault.seal(self._state)
        return self.vault_hash

    def mutate(self, fn):
        """Run fn(state) under the lock, then re-seal the vault. Returns fn's result."""
        with self._lock:
            result = fn(self._state)
            self._commit()
            return result

    def read(self, fn):
        with self._lock:
            return fn(self._state)

    # ---- assets ----
    def _next_id(self) -> str:
        used = {int(a["id"][1:]) for a in self._state["assets"] if a["id"][1:].isdigit()}
        n = 1
        while n in used:
            n += 1
        return f"A{n}"

    @staticmethod
    def _dedupe_key(a: dict):
        num = "".join(ch for ch in (a.get("account_number") or "") if ch.isalnum())
        return (a.get("institution", "").lower(), a.get("asset_type"), num[-4:] or None)

    def add_extracted(self, raw_assets: list[dict], source_doc: str) -> tuple[list[dict], int]:
        """Add assets found in one document. Returns (added assets masked, duplicates skipped)."""
        added, dupes = [], 0
        with self._lock:
            seen = {self._dedupe_key(a) for a in self._state["assets"]}
            for raw in raw_assets:
                asset = Asset(
                    id=self._next_id(),
                    owner=raw.get("owner"),
                    institution=(raw.get("institution") or "Unknown").strip(),
                    asset_type=canonical_asset_type(raw.get("asset_type", "")),
                    account_number=raw.get("account_number"),
                    value=raw.get("value"),
                    nominee=raw.get("nominee"),
                    source_doc=source_doc,
                ).model_dump()
                key = self._dedupe_key(asset)
                if key in seen:
                    dupes += 1
                    continue
                seen.add(key)
                self._state["assets"].append(asset)
                added.append(self._public(asset))
            if added:
                self._commit()
        return added, dupes

    @staticmethod
    def _public(asset: dict) -> dict:
        out = dict(asset)
        out["account_number"] = mask_account(asset.get("account_number"))
        return out

    def assets(self) -> list[dict]:
        return [self._public(a) for a in self._state["assets"]]

    def get(self, asset_id: str, masked: bool = True) -> dict | None:
        for a in self._state["assets"]:
            if a["id"] == asset_id:
                return self._public(a) if masked else dict(a)
        return None

    def set_beneficiaries(self, asset_id: str, beneficiaries: list[Beneficiary]) -> dict:
        total = sum(b.share for b in beneficiaries)
        if beneficiaries and abs(total - 100) > 0.01:
            raise ValueError(f"shares must add up to 100 (got {total:g})")
        with self._lock:
            for a in self._state["assets"]:
                if a["id"] == asset_id:
                    a["beneficiaries"] = [b.model_dump() for b in beneficiaries]
                    self._commit()
                    return self._public(a)
        raise KeyError(asset_id)

    def set_claim_status(self, asset_id: str, status: str) -> dict:
        with self._lock:
            for a in self._state["assets"]:
                if a["id"] == asset_id:
                    a["claim_status"] = status
                    self._commit()
                    return self._public(a)
        raise KeyError(asset_id)

    # ---- dashboard ----
    def warnings(self) -> list[dict]:
        out = []
        for a in self._state["assets"]:
            if not a.get("nominee"):
                out.append({"asset_id": a["id"], "type": "missing_nominee",
                            "message": f"{a['institution']} {a['asset_type']} has no nominee"})
            if not a.get("beneficiaries"):
                out.append({"asset_id": a["id"], "type": "no_beneficiary",
                            "message": f"{a['institution']} {a['asset_type']} has no beneficiary assigned"})
        return out

    def summary(self) -> dict:
        assets = self._state["assets"]
        counts = Counter(category(a["asset_type"]) for a in assets)
        owners = Counter(a["owner"] for a in assets if a.get("owner"))
        return {
            "owner": owners.most_common(1)[0][0] if owners else None,
            "total_value": sum(a.get("value") or 0 for a in assets),
            "asset_count": len(assets),
            "counts": {k: counts.get(k, 0) for k in ("Bank", "Insurance", "PF", "Investments", "Other")},
            "missing_nominee": sum(1 for a in assets if not a.get("nominee")),
            "circle": {"total": len(self._state.get("contacts", [])),
                       "accepted": circle.accepted_count(self._state), "required": 2},
            # Emergencies first: the owner must see "are you OK?" before anything else.
            "warnings": sorted(self.warnings() + circle.warnings(self._state),
                               key=lambda w: not w["type"].startswith("emergency_")),
            "vault_hash": self.vault_hash,
        }

    # ---- demo helpers ----
    def reset(self) -> None:
        with self._lock:
            self._state = json.loads(json.dumps(_EMPTY))
            vault.clear()
            self.vault_hash = None

    def load_demo(self) -> dict:
        def mock(name):
            return json.loads((config.MOCK_DIR / name).read_text(encoding="utf-8"))

        with self._lock:
            self._state = json.loads(json.dumps(_EMPTY))
            self._state["assets"] = mock("assets.json")
            circle.set_profile(self._state, mock("profile.json"))
            # Contacts start as "pending" so the demo can show them accepting live.
            circle.set_contacts(self._state, mock("contacts.json"))
            self._commit()
        return self.summary()
