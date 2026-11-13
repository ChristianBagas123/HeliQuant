"""firm/onchain_recorder.py — Line-2: anchor keputusan, hasil trade, dan validasi edge di NEAR testnet.

Kita tidak auto-swap di DEX tipis. Yang dicatat adalah hash SHA-256 kanonik dari record, lewat
`core.anchor(record_hash, kind, ref_id)`. Kontrak hanya mengeluarkan event NEP-297 (tanpa menyimpan
isi), jadi siapa pun bisa memverifikasi bahwa record itu ada di blok tertentu tanpa biaya simpan.

Mode:
  DRY (bawaan)   bangun record kanonik + hash. Tanpa kunci, gas, atau jaringan.
  SEND           kirim `anchor` lewat akun executor: kunci terbatas (NEAR_EXECUTOR_PRIVATE_KEY, mode `key`) atau
                 dompet custody OutLayer (EXECUTOR_MODE=custody), lihat firm/executor_signer.py. Hanya testnet.
Semua pengiriman best-effort: kegagalan tidak boleh menghentikan siklus firm.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from firm import executor_signer as es
from firm import near_client as nc
from firm.near_client import _env  # noqa: F401 - dipakai modul lain (mis. FIRM_TOKEN_ID)

ROOT = Path(__file__).resolve().parents[1]
CHAIN = "near-testnet"


def canonical_record(decision: dict, ticker: str, ts: str) -> dict:
    """Snapshot ringkas dan deterministik dari keputusan/tiket yang di-anchor."""
    tk = decision.get("trade_ticket") or {}
    rec = {
        "ts": ts, "ticker": ticker.upper(), "decision": decision.get("decision"),
        "direction": decision.get("direction"), "confidence": decision.get("confidence"),
        "entry": tk.get("entry"), "stop_loss": tk.get("stop_loss"),
        "tp1": (tk.get("take_profit") or [{}])[0].get("price"),
        "risk_pct": tk.get("risk_pct"), "mode": tk.get("mode"),
    }
    if decision.get("tee"):   # ringkasan bukti TEE; hanya ada kalau siklus berjalan di NEAR AI Cloud (hash lama tetap sama)
        rec["tee"] = decision["tee"]
    return rec


def record_hash(rec: dict) -> str:
    """SHA-256 kanonik dari record (kunci terurut, ringkas) -> hex 32 byte berawalan 0x."""
    blob = json.dumps(rec, sort_keys=True, separators=(",", ":")).encode()
    return "0x" + hashlib.sha256(blob).hexdigest()


def send_anchor(h: str, kind: str, ref_id: str) -> dict:
    """Kirim satu `core.anchor` lewat akun executor (kunci terbatas atau dompet custody OutLayer, lihat
    firm/executor_signer.py). Kembali {sent, tx_hash, explorer} atau {sent: False, error}. Tidak melempar."""
    if not es.configured() or not nc.core_id():
        return {"sent": False, "error": es.missing_hint()}
    r = es.call("anchor", {"record_hash": h, "kind": kind, "ref_id": str(ref_id)})
    if not r["ok"]:
        return {"sent": False, "error": r["error"], "tx_hash": r["tx_hash"]}
    return {"sent": True, "tx_hash": r["tx_hash"], "explorer": r["explorer"], "from_account": es.account()}


def anchor(decision: dict, ticker: str, ts: str, *, send: bool = False) -> dict:
    """Bangun (dan opsional kirim) anchor keputusan. Selalu aman dalam mode DRY."""
    rec = canonical_record(decision, ticker, ts)
    h = record_hash(rec)
    out = {"chain": CHAIN, "network": nc.network(), "kind": "decision", "record": rec, "record_hash": h,
           "core": nc.core_id() or None, "sent": False}
    if not send:
        out["note"] = "DRY — record + hash dibangun; pakai send=True (+ NEAR_EXECUTOR_PRIVATE_KEY) untuk mengirim"
        return out
    out.update(send_anchor(h, "decision", f"{ticker.upper()}@{ts}"))
    return out


def canonical_trade(trade: dict) -> dict:
    """Snapshot ringkas dan deterministik dari trade campaign yang SUDAH selesai (hasil, bukan mekanika fill)."""
    rec = {"id": trade.get("id"), "asset": trade.get("asset"), "dir": trade.get("dir"),
           "tier": trade.get("tier"), "entry": trade.get("entry"), "exit": trade.get("exit"),
           "exit_reason": trade.get("exit_reason"), "net_pct": trade.get("net_pct"),
           "pnl_usd": trade.get("pnl_usd"), "ts": trade.get("utc_close")}
    if trade.get("intents_hash"):   # hash of the 1Click quote taken at ENTER (only present when a quote was made)
        rec["intents_hash"] = trade["intents_hash"]
    return rec


def batch_anchor(records: list[dict], kind: str = "trade") -> list[dict]:
    """Segel sekumpulan record berurutan dengan satu kunci executor. Kembali [{id, tx_hash, explorer}] untuk yang
    terkirim. Best-effort: [] kalau konfigurasi tidak lengkap, dan berhenti di kegagalan pertama supaya urutan
    nonce tidak bolong. Pemanggil harus menganggap anchoring tidak kritis."""
    if not records or not es.configured() or not nc.core_id():
        return []
    out: list[dict] = []
    for rec in records:
        r = send_anchor(record_hash(rec), kind, str(rec.get("id") or rec.get("asset") or ""))
        if not r.get("sent"):
            break
        out.append({"id": rec.get("id"), "tx_hash": r["tx_hash"], "explorer": r["explorer"]})
    return out


def canonical_validation_record(edge: dict, ts: str) -> dict:
    """Snapshot deterministik dari edge yang VALIDATED/GRADUATED — bukti bahwa edge lolos gerbang OOS
    berbiaya pada data nyata. Merujuk identitas firm (token Firm di core)."""
    return {
        "type": "edge_validation", "ts": ts, "asset": str(edge.get("asset", "")).upper(),
        "edge": edge.get("edge"), "validated": bool(edge.get("validated")),
        "p_win": edge.get("p_win"), "payoff_b": edge.get("payoff_b"),
        "sample_n": edge.get("sample_n"), "oos_roi_pct": edge.get("oos_roi_pct"),
        "firm_token_id": _env("FIRM_TOKEN_ID"),
    }


def anchor_validation(edge: dict, ts: str, *, send: bool = False) -> dict:
    """Bangun (dan opsional kirim) anchor peristiwa validasi edge. Aman dalam mode DRY."""
    rec = canonical_validation_record(edge, ts)
    h = record_hash(rec)
    out = {"chain": CHAIN, "network": nc.network(), "kind": "edge_validation", "record": rec,
           "record_hash": h, "sent": False}
    if not send:
        out["note"] = "DRY — record validasi + hash dibangun; pakai send=True (+ kunci executor) untuk mengirim"
        return out
    out.update(send_anchor(h, "edge_validation", rec["asset"] or "edge"))
    return out


if __name__ == "__main__":
    import sys

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sample = {"decision": "ABSTAIN", "direction": "NONE", "confidence": "low",
              "reasoning": "ranging; tidak ada edge tervalidasi OOS + R:R<2 -> abstain",
              "trade_ticket": None}
    print(json.dumps(anchor(sample, "NEAR", "2026-11-09 manual-demo", send="--send" in sys.argv), indent=2))
