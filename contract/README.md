# contract/ (Pratham)

The contract and the keeper agent live here. The backend talks to the keeper over HTTP at `AMANAT_KEEPER_URL` (set it in `backend/.env`, e.g. `http://localhost:8100`).

## Endpoints the keeper exposes

| Method | Path | Body | Called when |
|---|---|---|---|
| GET | `/status` | | Frontend polls protection state |
| GET | `/txlog` | | Frontend shows transaction log |
| POST | `/vault-hash` | `{"hash": "0x..."}` | Every time the vault changes → `storeVaultHash()` |
| POST | `/contacts` | `{"contacts": [{"index","name","relation","phone","wallet","status"}]}` | User saves 3 trusted contacts → `setTrustedContacts()` |
| POST | `/contact-status` | `{"contact_index": 0-2, "status": "accepted"\|"declined"}` | A contact accepts or declines the role → record it on-chain, e.g. `acceptRole()` |
| POST | `/beneficiaries` | `{"asset_id","beneficiaries":[{"name","relation","share"}]}` | User saves a split → `setBeneficiaries()` |
| POST | `/activate` | `{"vault_hash": "0x..."}` | "Activate protection" button |
| POST | `/checkin` | `{}` | Check-in button → `checkIn()` / `cancel()` during grace |
| POST | `/confirm` | `{"contact_index": 0-2}` | Trusted contact confirms on phone → `confirmDeath()` |
| POST | `/demo/miss-deadline` | `{}` | Demo button: jump the clock past the deadline |

The frontend calls the **backend** (`http://localhost:8000/checkin` etc.) and the backend forwards the request to you. That way Ananya only has one base URL.

**Trusted Circle rule (from mentor feedback):** trusted contacts are invited and must **accept** before anything happens. The backend already refuses `/confirm` from a contact who hasn't accepted (HTTP 403). Ideally the contract enforces it too: `confirmDeath()` should revert unless that contact accepted. Invite tokens are never sent to you.

## Response shapes

- `/status` → same shape as `shared/mock/status.json`. `state` is one of `ACTIVE | GRACE | CONFIRMED | RELEASED | CANCELLED`.
- `/txlog` → same shape as `shared/mock/txlog.json`, with a real `tx_hash` and `explorer_url`.

Until the keeper is running, the backend serves those mock files and logs its calls locally with `tx_hash: null`.
