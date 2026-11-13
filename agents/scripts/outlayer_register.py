"""Daftarkan dompet custody OutLayer (testnet) dan simpan hasilnya tanpa mencetak rahasia.

    python agents/scripts/outlayer_register.py

Dijalankan PEMILIK (membuat akun di layanan pihak ketiga). Skrip:
  1. menolak jalan kalau OUTLAYER_API_KEY sudah ada di .env root (satu dompet saja);
  2. `POST {OUTLAYER_API_BASE}/register` dengan body `{}`;
  3. menambahkan OUTLAYER_API_KEY, OUTLAYER_WALLET_ACCOUNT, OUTLAYER_WALLET_ID ke `.env` root;
  4. menulis `handoff_url` (dashboard untuk memasang policy) ke `agents/data/outlayer_handoff.txt` (terabaikan git);
  5. mencetak HANYA akun implisit dompet dan lokasi file. API key tidak pernah dicetak.
`api_key` hanya tampil sekali dari server, jadi kalau skrip gagal setelah langkah 2, daftar ulang tidak bisa
memulihkannya: cek `.env` sebelum menjalankan lagi.
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
ENV = ROOT / ".env"
HANDOFF = Path(__file__).resolve().parents[1] / "data" / "outlayer_handoff.txt"
DEFAULT_API = "https://testnet-api.outlayer.ai"


def env_value(text: str, key: str) -> str | None:
    for line in text.replace("\r", "").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip() or None
    return None


def main() -> int:
    text = ENV.read_text(encoding="utf-8-sig") if ENV.exists() else ""
    if env_value(text, "OUTLAYER_API_KEY"):
        print("OUTLAYER_API_KEY sudah ada di .env: dompet sudah terdaftar, tidak mendaftar lagi.")
        return 1
    base = (env_value(text, "OUTLAYER_API_BASE") or DEFAULT_API).rstrip("/")
    if "testnet" not in base:
        print(f"OUTLAYER_API_BASE bukan testnet ({base}): dibatalkan.")
        return 1
    r = requests.post(f"{base}/register", json={}, timeout=60)
    if r.status_code >= 300:
        print(f"register gagal: HTTP {r.status_code} {r.text[:200]}")
        return 2
    j = r.json()
    key, acct = j.get("api_key"), j.get("near_account_id")
    if not key or not acct:
        print("respons register tidak memuat api_key atau near_account_id")
        return 2
    HANDOFF.parent.mkdir(parents=True, exist_ok=True)
    HANDOFF.write_text(str(j.get("handoff_url") or ""), encoding="utf-8")
    add = ("\n# --- OutLayer Agent Custody (testnet), dibuat oleh scripts/outlayer_register.py ---\n"
           f"OUTLAYER_API_KEY={key}\nOUTLAYER_WALLET_ACCOUNT={acct}\nOUTLAYER_WALLET_ID={j.get('wallet_id', '')}\n")
    ENV.write_text(text.rstrip("\n") + "\n" + add, encoding="utf-8")
    print(f"dompet terdaftar. akun implisit: {acct}")
    print(f"handoff_url (untuk memasang policy) ada di: {HANDOFF}")
    print("API key tersimpan di .env (tidak dicetak).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
