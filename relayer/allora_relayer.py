"""Allora Relayer — meneruskan prediksi Allora ke kontrak `allora` di NEAR testnet.

Alur:
  1. Ambil inference terbaru topik 14 (BTC/USD 8 jam) langsung dari chain Allora lewat LCD
     (`firm/allora_lcd.py`). Gratis dan tanpa API key. Waktunya = waktu blok inference itu.
  2. Bandingkan dengan isi kontrak. Kalau belum ada data yang lebih baru, lewati.
  3. Kirim `submit_inference` dengan kunci akun relayer (kunci terbatas: hanya method itu).
  4. Baca balik `get_latest_inference` dan cocokkan dengan yang dikirim.

Keamanan: kontrak hanya menerima akun relayer tepercaya, dan protokol NEAR sendiri membatasi kunci relayer
ke `submit_inference` di kontrak `allora`.

Dijalankan sekali per panggilan (cron Railway tiap 30 menit):
    python relayer/allora_relayer.py

Kode keluar: 0 sukses atau sengaja dilewati, 1 gagal (supaya cron menandai run gagal).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agents"))

from firm import allora_lcd  # noqa: E402
from firm import near_client as nc  # noqa: E402

TOPIC_ID = 14                 # BTC/USD - prediksi harga - 8 jam
CONFIDENCE_BPS = 7500         # LCD tidak memberi angka confidence; nilai bawaan lama
MAX_FRESHNESS_SEC = 1800      # harus sama dengan batas kontrak (`max_freshness_seconds`)


class RelayerError(RuntimeError):
    """Kegagalan yang membuat run dianggap gagal (kode keluar 1)."""


# ---------------------------------------------------------------- konfigurasi
def _deployment() -> dict:
    try:
        return json.loads((ROOT / "contracts" / "deployments" / "near_testnet.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def allora_contract() -> str:
    v = nc._env("ALLORA_CONTRACT_ID") or _deployment().get("contracts", {}).get("allora")
    if not v:
        raise RelayerError("ALLORA_CONTRACT_ID belum diisi")
    return v


def relayer_account() -> str:
    v = nc._env("NEAR_RELAYER_ACCOUNT_ID") or _deployment().get("accounts", {}).get("relayer")
    if not v:
        raise RelayerError("akun relayer belum diketahui (NEAR_RELAYER_ACCOUNT_ID atau near_testnet.json)")
    return v


def relayer_key() -> str:
    v = nc._env("NEAR_RELAYER_PRIVATE_KEY")
    if not v:
        raise RelayerError("NEAR_RELAYER_PRIVATE_KEY belum diisi")
    return v


# ---------------------------------------------------------------- Allora
async def fetch_allora_inference() -> tuple[int, int, int]:
    """Kembali (network_inference skala 1e18, timestamp detik, confidence_bps). Pengulangan ada di allora_lcd."""
    try:
        inf = await asyncio.to_thread(allora_lcd.fetch_latest, TOPIC_ID)
    except allora_lcd.AlloraLcdError as e:
        raise RelayerError(f"gagal mengambil inference Allora: {e}") from e
    value = inf.value_1e18
    if value <= 0:
        raise RelayerError(f"inference Allora tidak masuk akal: {inf.value}")
    return value, inf.timestamp, CONFIDENCE_BPS


# ---------------------------------------------------------------- kontrak
def read_latest() -> dict | None:
    """Isi kontrak untuk TOPIC_ID, atau None kalau belum pernah diisi."""
    return nc.view_safe(allora_contract(), "get_latest_inference", {"topic_id": TOPIC_ID})


def decide(raw_ts: int, now: int, onchain_ts: int | None) -> tuple[str, int]:
    """Tentukan (aksi, timestamp yang dikirim).

    * `skip`   : data belum lebih baru dari isi kontrak dan masih segar. Kontrak menolak (`inference not newer`).
    * `submit` : kirim. Kalau data lebih tua dari batas kesegaran kontrak, timestamp diganti `now`
                . Timestamp di masa depan (selisih jam) dibatasi ke `now`.
    """
    stale = now - raw_ts > MAX_FRESHNESS_SEC
    ts = now if stale else min(raw_ts, now)
    if onchain_ts is not None and ts <= onchain_ts:
        return "skip", ts
    return "submit", ts


def submit(value: int, ts: int, confidence_bps: int) -> dict:
    return nc.send_sync(
        relayer_account(), relayer_key(), allora_contract(), "submit_inference",
        {"topic_id": TOPIC_ID, "network_inference": str(value), "network_inference_timestamp_sec": ts,
         "confidence_bps": confidence_bps},
        timeout=60,
    )


def verify(value: int, ts: int, tries: int = 6, wait: float = 4.0) -> dict:
    """Cocokkan isi kontrak dengan yang dikirim. View `final` bisa tertinggal beberapa blok (temuan Tahap 8), jadi diulang."""
    stored = None
    for attempt in range(tries):
        stored = read_latest()
        if stored and str(stored["network_inference"]) == str(value) \
                and int(stored["network_inference_timestamp_sec"]) == ts:
            return stored
        if attempt < tries - 1:
            time.sleep(wait)
    if not stored:
        raise RelayerError("verifikasi gagal: kontrak tidak mengembalikan data")
    raise RelayerError(f"verifikasi gagal: kirim ({value}, {ts}), "
                       f"kontrak ({stored['network_inference']}, {stored['network_inference_timestamp_sec']})")


# ---------------------------------------------------------------- run
async def run_once() -> int:
    nc.guard_testnet(relayer_account(), allora_contract())
    print(f"=== Allora Relayer — topik {TOPIC_ID} (BTC 8 jam) ===")
    print(f"Kontrak : {allora_contract()}")
    print(f"Relayer : {relayer_account()}")

    raw, raw_ts, conf = await fetch_allora_inference()
    now = int(time.time())
    print(f"[1/3] Allora (LCD): {raw / 1e18:.4f} USD, timestamp {raw_ts} ({now - raw_ts} detik lalu), "
          f"confidence {conf} bps")

    cur = read_latest()
    onchain_ts = int(cur["network_inference_timestamp_sec"]) if cur else None
    action, ts = decide(raw_ts, now, onchain_ts)
    if ts != raw_ts:
        why = "lebih tua dari batas kesegaran" if now - raw_ts > MAX_FRESHNESS_SEC else "di masa depan"
        print(f"      PERINGATAN: timestamp Allora {why}; dikirim sebagai {ts}")
    if action == "skip":
        print(f"[2/3] Dilewati: kontrak sudah punya data timestamp {onchain_ts}")
        return 0

    print("[2/3] submit_inference ...")
    res = submit(raw, ts, conf)
    nc.note_result("relayer", res["ok"])
    if not res["ok"]:
        raise RelayerError(f"submit_inference gagal: {res['error']} (tx {res.get('tx_hash')})")
    print(f"      tx: {res['explorer']}  gas terbakar {res['gas_burnt'] / 1e12:.2f} TGas")

    print("[3/3] Verifikasi ...")
    stored = verify(raw, ts)
    print(f"      kontrak: {int(stored['network_inference']) / 1e18:.4f} USD, timestamp "
          f"{stored['network_inference_timestamp_sec']}, oleh {stored['published_by']}")
    return 0


def main() -> int:
    try:
        return asyncio.run(run_once())
    except (RelayerError, nc.NearGuardError) as e:
        print(f"GAGAL: {nc.redact(e)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
