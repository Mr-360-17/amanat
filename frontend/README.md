# frontend/ (Ananya)

**Base URL:** `http://localhost:8000`. CORS is open, so any dev server works.

**Start before the backend is running:** build against the files in `shared/mock/`:
- `assets.json`: Ramesh's 5 assets (screens 1, 3, 4)
- `status.json`: protection state (screens 5, 6, 7)
- `txlog.json`: transaction log (screen 8)
- `claim_A3.json`: one claim guide (screen 9)

**With the backend running:** call `POST /demo/load` once and every endpoint returns the same dataset for real.

## Endpoints per screen

| Screen | Endpoint |
|---|---|
| 1 Dashboard | `GET /summary` → `owner, total_value, counts{Bank,Insurance,PF,Investments}, missing_nominee, warnings[]` |
| 2 Upload | `POST /upload`: multipart, field name **`files`** (repeat it for several PDFs) → `assets[]`, `warnings[]`, `files[].extracted_by` |
| 3 Asset map | `GET /assets` |
| 4 Beneficiaries | `POST /beneficiaries` `{"asset_id":"A2","beneficiaries":[{"name","relation","share"}]}`. Shares must total 100, otherwise the response is 422 with a message |
| 5 Trusted contacts | `GET /contacts`, `POST /contacts` `{"contacts":[3 × {"name","relation","phone"}]}` |
| 6 Protection status | `GET /status` (poll every 2 s), `POST /activate`, `POST /checkin`, `POST /demo/miss-deadline` |
| 7 Contact confirmation | `POST /confirm` `{"contact_index": 0}` |
| 8 Transaction log | `GET /txlog` |
| 9 Beneficiary view | `GET /beneficiary/Sunita Kumar` → her assets with `your_share` and `your_value`; `GET /claim/A3` for each checklist |

Other endpoints: `GET /health` shows which parts are connected. `POST /demo/reset` clears everything so the demo can be replayed.
