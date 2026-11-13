"""firm/nep413.py — verifikasi tanda tangan NEP-413 untuk /register (onboarding engine lokal).

Alur:
  1. Halaman onboarding meminta nonce: `GET /register/nonce` -> `issue_nonce()` (32 byte acak, base64, 5 menit,
     sekali pakai, disimpan di memori proses).
  2. Dompet pemilik menandatangani `register_message(account_id, creds_sha256(creds))` dengan recipient `RECIPIENT`.
  3. `/register` memanggil `verify_register(auth, creds, owner)`. Semua harus lolos:
     akun == HQ_OWNER_ACCOUNT, akun .testnet, nonce sah dan belum dipakai, tanda tangan Ed25519 sah atas
     sha256(borsh(tag 2^31+413) + borsh(payload)), dan public key adalah kunci FullAccess akun itu (RPC testnet).

Hash kredensial ikut ditandatangani supaya isi kunci tidak bisa diganti setelah tanda tangan dibuat. Nilai kunci
sendiri tidak masuk pesan, jadi tidak tampil di jendela dompet.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import struct
import threading
import time

import requests

from firm import near_client as nc

TAG = 2**31 + 413
RECIPIENT = "heliquant.engine"
NONCE_TTL_SEC = 300
MAX_PENDING = 256  # batas nonce yang menunggu, supaya permintaan nonce beruntun tidak menghabiskan memori

_NONCES: dict[str, float] = {}
_LOCK = threading.Lock()


class AuthError(Exception):
    """Verifikasi gagal. `status` = kode HTTP yang dikembalikan /register."""

    def __init__(self, msg: str, status: int = 401):
        super().__init__(msg)
        self.status = status


# ---------------------------------------------------------------- owner dan pesan
def owner_account() -> str:
    """Akun pemilik engine dari HQ_OWNER_ACCOUNT. Kosong = /register mati."""
    return os.environ.get("HQ_OWNER_ACCOUNT", "").strip().lower()


def creds_sha256(creds: dict) -> str:
    """Hash kanonik kredensial: JSON dengan kunci terurut, tanpa spasi, non-ASCII apa adanya.
    Sama persis dengan `credsSha256` di frontend (JSON.stringify atas objek yang kuncinya diurutkan)."""
    canon = json.dumps({k: creds[k] for k in sorted(creds)}, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def register_message(account_id: str, creds_hash: str) -> str:
    return f"HeliQuant engine register\naccount: {account_id}\ncreds_sha256: {creds_hash}"


# ---------------------------------------------------------------- nonce
def issue_nonce(now: float | None = None) -> str:
    now = time.time() if now is None else now
    with _LOCK:
        for k in [k for k, exp in _NONCES.items() if exp <= now]:
            _NONCES.pop(k, None)
        if len(_NONCES) >= MAX_PENDING:
            _NONCES.pop(min(_NONCES, key=_NONCES.get))
        n = base64.b64encode(secrets.token_bytes(32)).decode()
        _NONCES[n] = now + NONCE_TTL_SEC
        return n


def consume_nonce(nonce: str, now: float | None = None) -> None:
    """Pakai nonce sekali. Gagal kalau tidak dikenal, sudah dipakai, atau kedaluwarsa."""
    now = time.time() if now is None else now
    with _LOCK:
        exp = _NONCES.pop(nonce, None)
    if exp is None:
        raise AuthError("nonce unknown or already used — request a new one")
    if exp <= now:
        raise AuthError("nonce expired — request a new one")


# ---------------------------------------------------------------- borsh + tanda tangan
def _borsh_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("<I", len(b)) + b


def payload_hash(message: str, nonce: bytes, recipient: str, callback_url: str | None = None) -> bytes:
    """sha256(borsh(u32 TAG) + borsh({message, nonce[32], recipient, callbackUrl: Option<String>}))."""
    if len(nonce) != 32:
        raise AuthError("nonce must be 32 bytes")
    data = struct.pack("<I", TAG) + _borsh_str(message) + nonce + _borsh_str(recipient)
    data += (b"\x01" + _borsh_str(callback_url)) if callback_url else b"\x00"
    return hashlib.sha256(data).digest()


def _decode_sig(sig: str) -> bytes:
    """Dompet berbeda format: base64 (standar NEP-413) atau `ed25519:<base58>`."""
    s = (sig or "").strip()
    try:
        if s.startswith("ed25519:"):
            raw = nc._b58d(s.split(":", 1)[1])
        else:
            raw = base64.b64decode(s + "=" * (-len(s) % 4), altchars=b"-_" if ("-" in s or "_" in s) else None)
    except (ValueError, TypeError) as e:
        raise AuthError(f"signature not decodable: {e}") from e
    if len(raw) != 64:
        raise AuthError("signature must be 64 bytes")
    return raw


def _decode_pk(pk: str) -> bytes:
    s = (pk or "").strip()
    if not s.startswith("ed25519:"):
        raise AuthError("public_key must be ed25519:<base58>")
    try:
        raw = nc._b58d(s.split(":", 1)[1])
    except ValueError as e:
        raise AuthError("public_key not decodable") from e
    if len(raw) != 32:
        raise AuthError("public_key must be 32 bytes")
    return raw


def verify_signature(public_key: str, signature: str, digest: bytes) -> bool:
    from nacl.exceptions import BadSignatureError
    from nacl.signing import VerifyKey
    try:
        VerifyKey(_decode_pk(public_key)).verify(digest, _decode_sig(signature))
        return True
    except BadSignatureError:
        return False


# ---------------------------------------------------------------- RPC
def _rpc_url() -> str:
    return nc.rpc_url() or nc.DEFAULT_RPC


def access_key_permission(account_id: str, public_key: str) -> str | None:
    """'FullAccess', 'FunctionCall', atau None kalau kunci tidak terdaftar di akun. Melempar kalau RPC gagal."""
    body = {"jsonrpc": "2.0", "id": "hq", "method": "query",
            "params": {"request_type": "view_access_key", "finality": "final",
                       "account_id": account_id, "public_key": public_key}}
    r = requests.post(_rpc_url(), json=body, timeout=12)
    r.raise_for_status()
    j = r.json()
    res = j.get("result") or {}
    if "error" in j or "error" in res or "permission" not in res:
        return None
    perm = res["permission"]
    return "FullAccess" if perm == "FullAccess" else "FunctionCall"


# ---------------------------------------------------------------- verifikasi lengkap
def verify_register(auth: dict, creds: dict, owner: str, *, now: float | None = None) -> str:
    """Kembali account_id kalau sah. Melempar AuthError (status 400/401/403/502) kalau tidak."""
    if not isinstance(auth, dict):
        raise AuthError("auth must be an object", 400)
    account = str(auth.get("account_id", "")).strip().lower()
    public_key = str(auth.get("public_key", "")).strip()
    signature = str(auth.get("signature", "")).strip()
    nonce_b64 = str(auth.get("nonce", "")).strip()
    callback_url = auth.get("callback_url") or None
    if not (account and public_key and signature and nonce_b64):
        raise AuthError("auth needs account_id, public_key, signature, nonce", 400)
    if account != owner:
        raise AuthError(f"{account} is not this engine's owner", 403)
    if nc.network() != "testnet" or not account.endswith(".testnet"):
        raise AuthError("testnet only: owner must be a .testnet account and NEAR_NETWORK=testnet", 403)
    consume_nonce(nonce_b64, now)  # dipakai sebelum cek tanda tangan: percobaan gagal tetap menghanguskan nonce
    try:
        nonce = base64.b64decode(nonce_b64)
    except ValueError as e:
        raise AuthError("nonce not base64") from e
    msg = register_message(account, creds_sha256(creds))
    if not verify_signature(public_key, signature, payload_hash(msg, nonce, RECIPIENT, callback_url)):
        raise AuthError("bad signature (message, nonce, recipient or creds do not match)")
    try:
        perm = access_key_permission(account, public_key)
    except Exception as e:  # noqa: BLE001
        raise AuthError(f"cannot verify access key on NEAR RPC: {str(e)[:120]}", 502) from e
    if perm is None:
        raise AuthError(f"{public_key} is not a key of {account}", 403)
    if perm != "FullAccess":
        raise AuthError("a full-access key is required (function-call keys are rejected)", 403)
    return account
