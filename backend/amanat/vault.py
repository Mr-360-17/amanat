"""AES-256-GCM encryption of the whole vault, plus the SHA-256 hash that goes on-chain.

Only the hash leaves this machine. The contract can later prove the vault a beneficiary
receives is the exact one the owner committed, without the data ever being public."""
import hashlib
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import config

VAULT_FILE = config.DATA_DIR / "vault.enc"
KEY_FILE = config.DATA_DIR / "vault.key"
NONCE_BYTES = 12


def _key() -> bytes:
    if config.VAULT_KEY_HEX:
        key = bytes.fromhex(config.VAULT_KEY_HEX)
    elif KEY_FILE.exists():
        key = bytes.fromhex(KEY_FILE.read_text().strip())
    else:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        key = AESGCM.generate_key(bit_length=256)
        KEY_FILE.write_text(key.hex())
    if len(key) != 32:
        raise ValueError("AMANAT_VAULT_KEY must be 32 bytes (64 hex chars)")
    return key


def seal(state: dict) -> str:
    """Encrypt and persist the state. Returns the on-chain hash (0x-prefixed hex)."""
    plaintext = json.dumps(state, sort_keys=True).encode("utf-8")
    nonce = os.urandom(NONCE_BYTES)
    blob = nonce + AESGCM(_key()).encrypt(nonce, plaintext, b"amanat-vault-v1")
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    VAULT_FILE.write_bytes(blob)
    return "0x" + hashlib.sha256(blob).hexdigest()


def open_vault() -> tuple[dict | None, str | None]:
    """Decrypt the persisted vault. Returns (state, hash) or (None, None) if there is none."""
    if not VAULT_FILE.exists():
        return None, None
    blob = VAULT_FILE.read_bytes()
    plaintext = AESGCM(_key()).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], b"amanat-vault-v1")
    return json.loads(plaintext), "0x" + hashlib.sha256(blob).hexdigest()


def clear() -> None:
    VAULT_FILE.unlink(missing_ok=True)
