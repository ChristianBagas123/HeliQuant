"""scripts/executor_demo.py — skrip executor untuk demo alur Hire di NEAR testnet (core.trade) dan pemantauan job terkunci.

Agen TIDAK memanggil `trade` otomatis (execution.py tetap stub, sama seperti versi sebelumnya). Skrip ini yang
dipanggil manual untuk demo, memakai akun executor (trade, recover_job, reconcile_job, anchor): kunci terbatas
(EXECUTOR_MODE=key, bawaan) atau dompet custody OutLayer (EXECUTOR_MODE=custody), lihat firm/executor_signer.py.

Perintah:
  python scripts/executor_demo.py status                       job aktif/terkunci dan saldo masing-masing
  python scripts/executor_demo.py trade <job_id> [--sell] [--bps 100] [--dry]   (kode keluar 3 = tersangkut, dana aman)
                                                               beli base (default) atau jual base. Ukuran = bps dari saldo
                                                               job (bawaan risk_per_trade_bps = 1%). min_amount_out dari
                                                               get_return Rhea dengan toleransi 1%.
  python scripts/executor_demo.py watch [--after 300] [--dry]  job yang terkunci lebih dari --after detik dipulihkan:
                                                               recover_job / reconcile_job sesuai tahap.
Env: EXECUTOR_MODE, NEAR_EXECUTOR_PRIVATE_KEY + NEAR_PARENT_ACCOUNT (mode key) atau OUTLAYER_API_KEY +
OUTLAYER_WALLET_ACCOUNT (mode custody), NEAR_CORE_CONTRACT_ID, NEAR_RPC_URL, NEAR_DEX_POOL_ID (atau
contracts/deployments/near_testnet.json).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from firm import executor_signer as es  # noqa: E402
from firm import near_client as nc  # noqa: E402

STATE_FILE = ROOT / "data" / "executor_watch.json"
SLIPPAGE_BPS = 100  # toleransi 1% terhadap get_return
LOCK_AFTER_S = 300  # job terkunci lebih dari 5 menit dipulihkan
DEPLOYMENTS = ROOT.parent / "contracts" / "deployments" / "near_testnet.json"


# ---------------------------------------------------------------- logika murni (diuji tanpa jaringan)
def trade_amount(balance: int, bps: int) -> int:
    """Ukuran trade = bps dari saldo job (pembulatan ke bawah, bilangan bulat)."""
    if balance < 0 or not 0 < bps <= 10_000:
        raise ValueError("saldo atau bps tidak valid")
    return balance * bps // 10_000


def min_out_from_quote(quote: int, slippage_bps: int = SLIPPAGE_BPS) -> int:
    """min_amount_out dari get_return Rhea dengan toleransi. Tidak pernah di bawah 1."""
    return max(quote - quote * slippage_bps // 10_000, 1)


def recovery_action(bal: dict) -> str | None:
    """Pilih langkah pemulihan dari get_job_balance: 'reconcile_job', 'recover_job', atau None."""
    if not bal.get("locked"):
        return None
    p = bal.get("pending")
    if not p:
        return None  # terkunci tanpa alur tertunda: hanya owner (force_unlock) yang bisa membuka
    if p.get("withdrawing"):
        return "reconcile_job"  # callback withdraw hilang atau belum selesai
    if p.get("stage") == "Depositing":
        return "reconcile_job"  # recover_job menolak tahap Depositing
    return "recover_job"  # Deposited atau Swapped, token tersangkut di DEX


def trade_outcome(sent_ok: bool, has_tx: bool, bal: dict | None) -> tuple[str, int]:
    """Nilai hasil `trade` dari sudut job, bukan hanya status transaksi. Kembali (label, kode keluar).

    OutLayer menandai transaksi gagal kalau satu receipt saja gagal, termasuk kegagalan DEX yang sudah ditangani
    kontrak (job dikunci aman, event `trade_stuck`). Karena itu saldo job dibaca dulu sebelum menyebut GAGAL.
      'ok'       0  transaksi sukses dan job tidak terkunci
      'stuck'    3  job terkunci dengan alur tertunda: dana aman, perlu `watch` untuk pulih
      'pending'  0  transaksi sukses tetapi job masih terkunci (callback belum selesai saat dibaca)
      'failed'   2  transaksi gagal dan job tidak tertahan (tidak ada yang berubah), atau tidak sampai ke chain
    """
    locked = bool(bal and bal.get("locked") and bal.get("pending"))
    if not has_tx:
        return "failed", 2
    if locked:
        return ("pending", 0) if sent_ok else ("stuck", 3)
    return ("ok", 0) if sent_ok else ("failed", 2)


# ---------------------------------------------------------------- konfigurasi
def _require_executor() -> None:
    """Mode key: kunci terbatas di env. Mode custody (EXECUTOR_MODE=custody): dompet OutLayer, tanpa kunci di agen."""
    if not es.configured():
        raise SystemExit(es.missing_hint())


def _deployment() -> dict:
    try:
        return json.loads(DEPLOYMENTS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _pool_id() -> int:
    v = nc._env("NEAR_DEX_POOL_ID")
    if v:
        return int(v)
    d = _deployment().get("dex", {}).get("pool_id")
    if d is None:
        raise SystemExit("set NEAR_DEX_POOL_ID (pool Rhea mUSDC/wNEAR)")
    return int(d)


def _core_cfg() -> dict:
    return nc.view(nc.core_id(), "config")


# ---------------------------------------------------------------- perintah
def cmd_status() -> int:
    core = nc.core_id()
    total = int(nc.view(core, "total_jobs"))
    print(f"core {core}: {total} job")
    for jid in range(max(1, total - 19), total + 1):
        j = nc.view(core, "get_job", {"job_id": str(jid)})
        b = nc.view(core, "get_job_balance", {"job_id": str(jid)})
        act = recovery_action(b)
        print(f"  job {jid}: {j['status']:8} locked={b['locked']!s:5} principal={b['principal']} base={b['base']}"
              + (f"  pending={b['pending']['stage']}" if b.get("pending") else "")
              + (f"  -> {act}" if act else ""))
    return 0


def cmd_trade(job_id: str, sell: bool, bps: int, dry: bool) -> int:
    core = nc.core_id()
    cfg = _core_cfg()
    pt, bt, dex = cfg["principal_token"], cfg["base_token"], cfg["dex"]
    bal = nc.view(core, "get_job_balance", {"job_id": job_id})
    if bal["locked"] or bal["status"] != "Active":
        print(f"job {job_id} tidak bisa di-trade (status {bal['status']}, locked={bal['locked']})")
        return 1
    token_in, token_out = (bt, pt) if sell else (pt, bt)
    balance = int(bal["base"] if sell else bal["principal"])
    amount = trade_amount(balance, bps)
    if amount <= 0:
        print("ukuran trade 0 (saldo terlalu kecil)")
        return 1
    pool = _pool_id()
    quote = int(nc.view(dex, "get_return", {"pool_id": pool, "token_in": token_in,
                                            "amount_in": str(amount), "token_out": token_out}))
    min_out = min_out_from_quote(quote)
    print(f"job {job_id}: {token_in} -> {token_out}, amount_in={amount}, kutipan={quote}, min_amount_out={min_out}, pool={pool}")
    if dry:
        print("(dry) tidak dikirim")
        return 0
    _require_executor()
    r = es.call("trade", {"job_id": job_id, "token_in": token_in, "amount_in": str(amount),
                          "token_out": token_out, "min_amount_out": str(min_out), "pool_id": pool})
    b = None
    if r.get("tx_hash"):
        time.sleep(8)  # callback swap berjalan setelah transaksi awal
        b = nc.view_safe(core, "get_job_balance", {"job_id": job_id})
    label, code = trade_outcome(bool(r["ok"]), bool(r.get("tx_hash")), b)
    tx = r.get("explorer") or ""
    if label == "ok":
        print("ok", tx)
    elif label == "stuck":
        stage = (b.get("pending") or {}).get("stage")
        print(f"TERSANGKUT, dana aman: langkah DEX gagal dan kontrak mengunci job {job_id} di tahap {stage} "
              f"(event trade_stuck). Status OutLayer: {r['error']}. {tx}")
        print("Pulihkan dengan: python scripts/executor_demo.py watch --after 0")
    elif label == "pending":
        print(f"ok {tx}  (job masih terkunci saat dibaca; cek lagi dengan `status`)")
    else:
        print(f"GAGAL: {r['error']}", tx)
    if b:
        print(f"saldo job: principal={b['principal']} base={b['base']} locked={b['locked']}")
    return code


def _load_seen() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def cmd_watch(after: int, dry: bool) -> int:
    core = nc.core_id()
    total = int(nc.view(core, "total_jobs"))
    seen, now, rc = _load_seen(), time.time(), 0
    for jid in range(max(1, total - 49), total + 1):
        b = nc.view(core, "get_job_balance", {"job_id": str(jid)})
        key = str(jid)
        act = recovery_action(b)
        if not b["locked"]:
            seen.pop(key, None)
            continue
        first = seen.setdefault(key, now)
        age = now - first
        print(f"job {jid} terkunci {age:.0f}s, tahap={(b.get('pending') or {}).get('stage')}, aksi={act}")
        if act is None:
            print("  terkunci tanpa alur tertunda: perlu force_unlock oleh owner")
            continue
        if age < after:
            continue
        if dry:
            print(f"  (dry) akan memanggil {act}")
            continue
        _require_executor()
        r = es.call(act, {"job_id": str(jid)})
        print(f"  {act}: " + ("ok " + (r["explorer"] or "") if r["ok"] else f"GAGAL {r['error']}"))
        rc = rc or (0 if r["ok"] else 2)
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(seen), encoding="utf-8")
    return rc


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in {"status", "trade", "watch"}:
        print(__doc__)
        return 1
    nc.guard_config()
    cmd, rest = argv[0], argv[1:]
    dry = "--dry" in rest

    def opt(name: str, default: int) -> int:
        return int(rest[rest.index(name) + 1]) if name in rest else default

    if cmd == "status":
        return cmd_status()
    if cmd == "trade":
        job_id = rest[0] if rest and not rest[0].startswith("--") else None
        if not job_id:
            print("pakai: trade <job_id> [--sell] [--bps N] [--dry]")
            return 1
        from firm.config import settings
        return cmd_trade(job_id, "--sell" in rest, opt("--bps", settings.risk_per_trade_bps), dry)
    return cmd_watch(opt("--after", LOCK_AFTER_S), dry)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
