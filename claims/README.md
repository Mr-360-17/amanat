# claims/ (Unnati)

The backend loads `claims/agent.py` automatically. The only thing it needs is this function:

```python
def get_claim_guide(asset: dict) -> dict:
    ...
```

**Input:** one asset in the shared schema (see the root README). The account number arrives masked (`XXXX1234`).

**Return at least:**

```json
{
  "steps": ["Get the death certificate ...", "..."],
  "documents": ["Death certificate", "Original policy bond", "..."],
  "sources": ["https://<official LIC / EPFO / SBI / AMC page>"],
  "disclaimer": "Guidance only, not legal advice."
}
```

The backend adds `asset_id` if you leave it out. Until `agent.py` exists, `GET /claim/:assetId` returns a stub with an empty `steps` list, so the frontend never breaks.

Check it with the backend running: `GET http://localhost:8000/claim/A3`, then look at `GET /health` and confirm `"claims_agent_connected": true`.
