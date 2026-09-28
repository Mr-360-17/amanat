# frontend/ (Ananya)

**Base URL:** `http://localhost:8000` when the backend runs on your own laptop. On the hackathon Wi-Fi, use Nand's laptop: `http://<Nand's IP>:8000`, which `backend/run_lan.ps1` prints when it starts. Keep the base URL in one config variable. CORS is open, so any dev server works.

**Owner key (required):** every owner request must send the header `X-Amanat-Key: <key>`. Without it the backend answers **401**, which keeps other teams on the venue Wi-Fi out. Nand's `run_lan.ps1` prints the key when the backend starts. Keep it in a local env file (e.g. `.env.local`) and **don't commit it**. Wrap `fetch` once so every call adds the header:

```js
const API = import.meta.env.VITE_API_URL;           // e.g. http://10.80.79.72:8000
const KEY = import.meta.env.VITE_AMANAT_KEY;
export const api = (path, opts = {}) =>
  fetch(API + path, { ...opts, headers: { "X-Amanat-Key": KEY, ...(opts.headers || {}) } });
```

**No key for trusted-contact pages:** `/circle/:token...` works without it, because the token in the link is the contact's credential. The contact's phone never needs the owner key.

**Run your dev server on the network too** (Vite: `npm run dev -- --host`), so phones can open the invite page.

**Start before the backend is running:** build against the files in `shared/mock/`:
- `assets.json`: Ramesh's 5 assets (screens 1, 3, 4)
- `status.json`: protection state (screens 5, 6, 7)
- `txlog.json`: transaction log (screen 8)
- `claim_A3.json`: one claim guide (screen 9)
- `circle_card.json`: what a trusted contact sees after accepting (screens 10–11)
- `profile.json`, `contacts.json`: Ramesh's emergency card data and his 3 trusted contacts

**With the backend running:** call `POST /demo/load` once and every endpoint returns the same dataset for real.

## Endpoints per screen

| Screen | Endpoint |
|---|---|
| 1 Dashboard | `GET /summary` → `owner, total_value, counts{Bank,Insurance,PF,Investments}, missing_nominee, warnings[]` |
| 2 Upload | `POST /upload`: multipart, field name **`files`** (repeat it for several PDFs) → `assets[]`, `warnings[]`, `files[].extracted_by` |
| 3 Asset map | `GET /assets` |
| 4 Beneficiaries | `POST /beneficiaries` `{"asset_id":"A2","beneficiaries":[{"name","relation","share"}]}`. Shares must total 100, otherwise the response is 422 with a message |
| 5 Trusted contacts | `GET /contacts`, `POST /contacts` `{"contacts":[3 × {"name","relation","phone"}]}` (phone is **required**). Each contact has `status` (`pending` / `accepted` / `declined`) and `reachability` (`ok` / `not_accepted` / `awaiting_response` / `stale` / `declined`). Show ✅/⏳ per person. `POST /contacts/C1/resend` resends an invite |
| 5b Emergency card settings | `GET /profile`, `PUT /profile`: owner phone, address, blood group, family, doctor, note, and `share{address,family,doctor,institutions,asset_types}` toggles ("what my circle can see") |
| 6 Protection status | `GET /status` (poll every 2 s), `POST /activate`, `POST /checkin`, `POST /demo/miss-deadline` |
| 7 Contact confirmation | On the contact's phone: `POST /circle/:token/confirm` (no owner key; 403 if they never accepted). The operator panel can still use `POST /confirm` `{"contact_index": 0}` with the owner key |
| 10 **Invite page** (mobile, route `/circle/:token`) | `GET /circle/:token`. While pending it returns `message` + `card: null` → show **Accept / Decline** buttons → `POST /circle/:token/accept` or `/decline`. The response then includes the card |
| 11 **Emergency card** (mobile, same route once accepted) | `card.owner`, `card.family`, `card.doctor`, `card.circle` (the viewer has `you: true`), `card.assets_held_at` (where, **never amounts**), `card.note`, `card.what_to_do[]`, `card.privacy_note` |
| 12 Reachability check | Owner: `POST /circle/ping-all`. Contact: "I'm still reachable" button → `POST /circle/:token/ping` |
| Phone mock-up | `GET /notifications`: simulated SMS outbox, newest first. Show the latest message on the "phone" in the demo; its `link` opens screen 10 |
| 8 Transaction log | `GET /txlog` |
| 9 Beneficiary view | `GET /beneficiary/Sunita Kumar`. **Before release:** `released: false`, `message`, empty `assets`, so show a locked screen. **After release:** her assets with `your_share`, `your_value` and full account numbers; `GET /claim/A3` for each checklist. To build this screen before Pratham's keeper exists, call `POST /demo/simulate-release` first |

Invite links point to `AMANAT_INVITE_BASE_URL/<token>` (default `http://localhost:5173/circle/<token>`). Tell Nand your dev server's port if it's different.

Other endpoints: `GET /health` shows which parts are connected. `POST /demo/reset` clears everything so the demo can be replayed.
