"""firm/agent_onchain.py — segel OUTPUT tiap desk di NEAR (`core.record_output`).

Tiap siklus org, desk yang menghasilkan analisis mengirim hash outputnya dengan AKUNNYA SENDIRI dan kunci
terbatasnya (hanya boleh memanggil `record_output` di core). Semua desk dikirim paralel (satu Account per
desk). Best-effort: satu desk gagal tidak menghentikan desk lain, dan kegagalan dicatat untuk
/health/onchain. Saklar `AGENT_ONCHAIN` (bawaan 1; 0 mematikan). Reputasi bertambah terpisah saat job selesai.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from firm import near_client as nc

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "data" / "agent_registry.json"
PROOF_ATTESTED = 1  # AttestedByValidator


def _registry() -> dict:
    try:
        return json.loads(REGISTRY.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def _proof_hash(obj: dict) -> str:
    """SHA-256 hex (64 karakter) dari JSON kanonik {"asset", "desk", "output"}. Rumus sama dengan versi sebelumnya."""
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def record_outputs(analysts: dict, asset: str, job_id: int) -> list[dict]:
    """`record_output` per desk di `analysts` yang terdaftar. Kembali [{desk, tokenId, account, tx, explorer}] untuk
    yang berhasil. Best-effort: [] kalau pengaturan tidak lengkap. Tidak melempar."""
    if os.environ.get("AGENT_ONCHAIN", "1") == "0" or not analysts:
        return []
    reg = _registry()
    desks = reg.get("desks") or {}
    core = nc.core_id()
    keys = nc.desk_keys()
    if not desks or not core or not keys:
        return []
    calls, meta = [], []
    for name, output in analysts.items():
        d = desks.get(name)
        if not d:
            continue
        acct = d.get("account")
        key = keys.get(acct or "")
        if not acct or not key:
            continue
        ph = _proof_hash({"asset": asset, "desk": name, "output": output})
        calls.append({"account": acct, "key": key, "contract": core, "method": "record_output",
                      "args": {"token_id": str(d["tokenId"]), "job_id": str(int(job_id)),
                               "proof_kind": PROOF_ATTESTED, "proof_hash": ph}})
        meta.append((name, d["tokenId"], acct))
    if not calls:
        return []
    results = nc.send_many(calls)
    out: list[dict] = []
    for (name, token_id, acct), r in zip(meta, results):
        nc.note_result(name, r["ok"])
        if r["ok"]:
            out.append({"desk": name, "tokenId": token_id, "account": acct, "tx": r["tx_hash"],
                        "explorer": r["explorer"]})
    return out
