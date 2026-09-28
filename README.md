# Amanat

*Your family's inheritance, held in trust.*

When someone dies, their family often doesn't know which bank accounts, FDs, insurance policies, PF or investments they had, so the money goes unclaimed. Amanat reads your financial documents with AI, builds an encrypted map of your assets, and uses an autonomous on-chain switch to release that map to your family, with a step-by-step claim guide, only once your death is confirmed by 2 of 3 trusted contacts.

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

### How extraction works

1. Text is pulled out of the PDF with pypdf. A scanned PDF with no text layer is sent to Claude or Gemini as a PDF.
2. The configured LLM (`AMANAT_LLM`) returns assets in a strict JSON schema.
3. Entries with neither an account number nor a value are dropped as unverifiable, and names are tidied.
4. If the LLM fails, the **rule-based extractor** takes over, so the demo never dead-ends.
5. Results are cached per file. Upload the demo PDFs once during rehearsal, and the live demo works even if the API or Wi-Fi fails.
6. Assets are stored in an AES-256-GCM encrypted vault. Only its SHA-256 hash goes on-chain. The API always shows masked account numbers.
