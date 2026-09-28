# Amanat

*Your family's inheritance, held in trust.*

When someone dies, their family often doesn't know which bank accounts, FDs, insurance policies, PF or investments they had, so the money goes unclaimed. Amanat reads your financial documents with AI, builds an encrypted map of your assets, and uses an autonomous on-chain switch to release that map to your family, with a step-by-step claim guide, only once your death is confirmed by 2 of 3 trusted contacts.

## Trusted Circle

*Added after mentor feedback: the trusted people should know before anything happens.*

1. **Invited on day one.** When Ramesh adds a trusted contact, they get a message right away and must **accept**. That proves the number works and that they agree to the role.
2. **Emergency card.** Once accepted, a contact can always open Ramesh's card: phone, address, family, doctor, the other contacts, and **where** his assets are held. **Never amounts or account numbers**; those are released only after 2 of 3 contacts confirm. Ramesh chooses what the card shows.
3. **Kept fresh.** Periodic "still reachable?" checks. Anyone silent, unaccepted or declined is flagged on Ramesh's dashboard, just like a missing nominee.
4. **Only accepted contacts can confirm a death.** A stranger with a phone number can't trigger a release.
5. **Emergency mode ("something happens", short of death).** An accepted contact reports it, for example "admitted to hospital". Ramesh is alerted at once and can cancel by checking in. If a second contact confirms (2 of 3), the circle gets **only** his health cover, allergies, conditions, medications, blood group and doctor, so they can act at the hospital. Bank accounts, deposits, investments and life insurance stay locked, and the family's vault release still needs the separate on-chain death confirmation. An unconfirmed report expires after 48 hours.

## Structure

| Folder | Owner | What |
|---|---|---|
| `backend/` | Nand | Upload → text extraction → AI asset extraction → encrypted vault → API |
| `contract/` | Pratham | Smart contract + keeper agent (check-in, grace, 2-of-3, release, cancel) |
| `frontend/` | Ananya | All screens |
| `claims/` | Unnati | Claim knowledge base + claim agent (`claims/agent.py`) |
| `shared/mock/` | all | Agreed demo data. Everyone builds against these files |

Each folder's README describes the interface that folder has to provide.

## Agreed at kickoff

### Asset schema

```json
{
  "id": "A2",
  "owner": "Ramesh Kumar",
  "institution": "SBI",
  "asset_type": "Fixed Deposit",
  "account_number": "XXXX1234",
  "value": 500000,
  "nominee": null,
  "beneficiaries": [{ "name": "Sunita Kumar", "relation": "Wife", "share": 60 }],
  "claim_status": "not_started",
  "source_doc": "sbi_fd_receipt.pdf"
}
```

`asset_type` is one of: Savings Account, Current Account, Fixed Deposit, Recurring Deposit, Life Insurance, Health Insurance, EPF, PPF, NPS, Mutual Fund, Shares, Bonds, Other. `nominee: null` means no nominee is registered.

### Contract events

`CheckedIn`, `GraceStarted`, `ReminderSent`, `DeathConfirmed`, `Released`, `Cancelled` (plus `VaultHashStored`)

### Demo dataset: Ramesh Kumar

| # | Asset | Institution | Value | Nominee |
|---|---|---|---|---|
| A1 | Savings Account | SBI | ₹1,45,000 | Sunita Kumar |
| A2 | Fixed Deposit | SBI | ₹5,00,000 | **None** ⚠️ |
| A3 | Life Insurance | LIC | ₹10,00,000 | Sunita Kumar |
| A4 | EPF | EPFO | ₹3,20,000 | Sunita Kumar |
| A5 | Mutual Fund | HDFC Mutual Fund | ₹1,80,000 | Rahul Kumar |
| | **Total** | | **₹21,45,000** | |

Dashboard counts: Bank 2 · Insurance 1 · PF 1 · Investments 1. Wife: Sunita Kumar. Son: Rahul Kumar.

## Run the backend

```powershell
cd backend
python -m venv ..\.venv
..\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env          # add an API key here
..\.venv\Scripts\python dev_samples\make_samples.py   # synthetic test PDFs
..\.venv\Scripts\uvicorn app:app --reload --port 8000
```

API docs: http://localhost:8000/docs · Tests: `..\.venv\Scripts\python -m pytest tests`

**For the demo (phones + teammates on the same Wi-Fi):**
```powershell
powershell -ExecutionPolicy Bypass -File backend\run_lan.ps1
```
It prints the laptop's Wi-Fi address. Open `http://<that-ip>:8000/` on a phone: a green "✓ This device can reach the backend" means the phone demo will work. Invite links automatically point to `http://<that-ip>:5173/circle/<token>`. If Windows shows a firewall popup, tick both Private and Public and click Allow. If the phone still can't connect, the venue Wi-Fi is isolating devices: put the laptop and phone on one phone's hotspot instead.

**Owner key:** all owner and demo endpoints require the header `X-Amanat-Key`. The key comes from `AMANAT_OWNER_KEY`, or is generated once into `backend/data/owner.key`, and `run_lan.ps1` prints it. Only `/`, `/health`, `/docs` and the trusted-contact invite links (`/circle/<token>...`, where the token is the credential) are public. Access is default-deny, so any new route is protected automatically.

**Before every rehearsal / the demo:** `..\.venv\Scripts\python demo_prep.py` (add `--loaded` to start with Ramesh's data). It prints GO / NO-GO.

**Backup Gemini keys:** add `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` to `backend/.env`. A key that hits its rate limit (429) hands over to the next, and the backend remembers which key last worked.

**Privacy rule:** `GET /beneficiary/:name` returns nothing until the keeper reports `RELEASED`. After release it includes full account numbers, because the family needs them to claim. For frontend work before the keeper exists, `POST /demo/simulate-release` fakes a release. It is refused once a real keeper is connected, and `POST /demo/reset` clears it.

### How extraction works

1. Text is pulled out of the PDF with pypdf. A scanned PDF with no text layer is sent to Claude or Gemini as a PDF.
2. The configured LLM (`AMANAT_LLM`) returns assets in a strict JSON schema.
3. Entries with neither an account number nor a value are dropped as unverifiable, and names are tidied.
4. If a Gemini model is busy (503/429) or retired (404), the backend retries once and then tries the backup models (`AMANAT_GEMINI_FALLBACKS`). If nothing answers within `AMANAT_LLM_TIME_BUDGET_S` (45 s), the **rule-based extractor** takes over, so the demo never dead-ends.
5. Results are cached per file. Run `python dev_samples\check_extraction.py` during rehearsal: it checks all 5 PDFs and fills the cache, so the live demo works even if the API or Wi-Fi fails.
6. Assets are stored in an AES-256-GCM encrypted vault. Only its SHA-256 hash goes on-chain. The API always shows masked account numbers.
