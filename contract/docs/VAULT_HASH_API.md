# Vault hash API: integration guide for the backend

The backend (FastAPI) encrypts the user's vault. It then sends **only a hash** of the
encrypted data to the LegacyVault keeper, which stores it on-chain with `storeVaultHash(bytes32)`.
Anyone can later recompute the hash and prove the vault was not changed after it was recorded.

**Never send the vault itself, personal data, account numbers, names, Aadhaar or PAN.** Send only the 32-byte hash.

## Endpoint

```
POST http://<KEEPER_HOST>:4000/vault/hash
Header:  x-api-key: <BACKEND_API_KEY>        (shared privately, never commit it)
Header:  Content-Type: application/json
Body:    { "vaultHash": "0x<64 hex chars>" }
```

- `KEEPER_HOST` is `localhost` on the keeper laptop, or that laptop's LAN IP from another machine.
  The keeper laptop must allow inbound TCP 4000 in Windows Firewall.
- The hash can be SHA-256 or keccak256 of the **encrypted** vault bytes. Both are 32 bytes.
  Use one consistently. We recommend SHA-256, which is in Python's standard library.

## Responses

| Status | Meaning | Body |
|---|---|---|
| 200 | Stored on-chain | `{ vaultHash, action, hash, block, gasUsed, status: "SUCCESS", explorerUrl }` |
| 400 | Bad hash (not `0x` + 64 hex, or all zeros) | `{ error }` |
| 401 | Missing or wrong `x-api-key` | `{ error }` |
| 409 | Contract refused. For example, the vault is already RELEASED. | `{ error: "Contract refused: InvalidState(3)" }` |
| 502 | Transaction failed (RPC or network problem). Safe to retry. | `{ error, detail }` |
| 503 | Keeper busy for more than 60 s, or API key not configured on the server. Retry later. | `{ error }` |

In the 200 response, `hash` is the **transaction** hash, and `explorerUrl` links to it on MSTScan.
The request waits for the block, so it can take a few seconds.

## PowerShell example

```powershell
$api = "http://localhost:4000"          # or http://<keeper-laptop-ip>:4000
$key = "<BACKEND_API_KEY>"

# SHA-256 of the ENCRYPTED vault file -> 0x + lowercase hex
$hex = (Get-FileHash .\vault.enc -Algorithm SHA256).Hash.ToLower()
$body = @{ vaultHash = "0x$hex" } | ConvertTo-Json

$r = Invoke-RestMethod "$api/vault/hash" -Method Post -ContentType "application/json" `
       -Headers @{ "x-api-key" = $key } -Body $body
$r | Format-List        # status, block, hash (tx), explorerUrl
```

## Python example (FastAPI backend)

```python
import hashlib
import requests  # or httpx

KEEPER_URL = "http://localhost:4000"          # from your settings/env
BACKEND_API_KEY = "..."                       # from env, never hardcode

def record_vault_hash(encrypted_vault: bytes) -> dict:
    vault_hash = "0x" + hashlib.sha256(encrypted_vault).hexdigest()
    r = requests.post(
        f"{KEEPER_URL}/vault/hash",
        json={"vaultHash": vault_hash},
        headers={"x-api-key": BACKEND_API_KEY},
        timeout=90,  # waits for the block
    )
    r.raise_for_status()
    return r.json()   # {"status": "SUCCESS", "hash": "0x...", "block": ..., "explorerUrl": ...}
```

For keccak256 instead, use `from eth_utils import keccak` and `"0x" + keccak(encrypted_vault).hex()`.

## Checking what is on-chain

`GET http://<KEEPER_HOST>:4000/contract` returns the contract address and ABI.
The `vaultHash` field of `getStatus()` holds the latest hash, and every update emits a
`VaultHashStored(by, vaultHash, timestamp)` event, visible on the `/txlog` page.
