"""Jalankan worker NEAR Agent Market dari lokal selama beberapa menit, lalu berhenti.

Dipakai untuk uji alur sewa tanpa men-deploy ulang Railway:
    python scripts/market_poll.py --minutes 15 --poll 20

Butuh `AGENT_MARKET_TOKEN` di `.env` root. Analisis memakai fungsi yang sama dengan layanan agen
(`app._market_analyze`), dan anchor dikirim ke NEAR testnet kalau `AGENT_ONCHAIN` bukan 0.
Berhenti lebih awal setelah `--max-jobs` deliverable terkirim.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from firm.near_client import _env  # noqa: E402

os.environ.setdefault("AGENT_MARKET_TOKEN", _env("AGENT_MARKET_TOKEN") or "")
# Uji lokal tidak boleh menimpa data riset: `_refresh` (scripts/73) menulis ulang near_perp_hourly.csv dan
# near_positioning.csv dengan 1000 bar terakhir saja (riwayat panjang hilang, tes data gagal). Isi REFRESH_DATA=1
# sendiri kalau memang ingin data segar.
os.environ.setdefault("REFRESH_DATA", "0")

import app  # noqa: E402
from firm import market_worker as mw  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=15)
    ap.add_argument("--poll", type=int, default=20)
    ap.add_argument("--max-jobs", type=int, default=1)
    a = ap.parse_args()
    if not mw.enabled():
        print("AGENT_MARKET_TOKEN kosong atau MARKET_WORKER=0")
        return 1

    def log(m: str) -> None:
        app.log(m)
        print(app.LOGS[-1], flush=True)

    w = mw.Worker(analyze=app._market_analyze, log=log, on_decision=app._market_decision,
                  send_anchor=os.environ.get("AGENT_ONCHAIN", _env("AGENT_ONCHAIN") or "1") != "0")
    end = time.time() + a.minutes * 60
    log(f"[market] polling lokal {a.minutes} menit, tiap {a.poll} detik")
    while time.time() < end and w.stats["submitted"] < a.max_jobs:
        w.poll_once()
        if w.stats["submitted"] < a.max_jobs:
            time.sleep(a.poll)
    log(f"[market] selesai · terkirim {w.stats['submitted']} · error {w.stats['errors']} · {w.stats['last_error'] or ''}")
    return 0 if w.stats["submitted"] else 2


if __name__ == "__main__":
    sys.exit(main())
