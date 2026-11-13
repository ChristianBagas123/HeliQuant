"""Isi env layanan Railway dari .env root. Nilai tidak pernah dicetak.

    python agents/scripts/railway_set_env.py agent      # layanan agen
    python agents/scripts/railway_set_env.py relayer    # layanan cron relayer
    python agents/scripts/railway_set_env.py agent --dry-run   # hanya tampilkan NAMA variabel

Prasyarat: `railway login`, dan proyek sudah ditautkan (`railway link`) dari folder mana pun di repo.

Aturan: kunci pemilik (`NEAR_OWNER_PRIVATE_KEY`) tidak pernah dikirim ke Railway.
Tiap layanan hanya menerima kunci yang dipakainya: agen memegang kunci executor dan kunci desk, relayer
hanya memegang kunci relayer.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

COMMON = ["NEAR_NETWORK", "NEAR_RPC_URL", "NEAR_PARENT_ACCOUNT", "ALLORA_CONTRACT_ID"]

SETS: dict[str, dict] = {
    "agent": {
        "service": "agent",
        "names": COMMON + [
            "NEAR_CORE_CONTRACT_ID", "FIRM_TOKEN_ID", "NEAR_EXECUTOR_PRIVATE_KEY", "DESK_KEYS_JSON",
            "NEARBLOCKS_API_KEY", "BITGET_DEMO", "BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_PASSPHRASE",
            "SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_JWT_SECRET", "AGENT_ONCHAIN", "INTERVAL_MIN",
            "AGENT_PUBLIC_URL", "DAPP_URL", "GROQ_API_KEY", "NANSEN_API_KEY", "NANSEN_API_KEY_2",
            "NANSEN_API_KEY_3", "NANSEN_API_KEY_4", "ELFA_API_KEY",
            "AGENT_MARKET_TOKEN", "HQ_PROVIDER", "HQ_FALLBACK_PROVIDER", "NEARAI_API_KEY", "NEARAI_MODEL",
            "NEARAI_BUDGET_USD", "NEARAI_NO_THINK_LIGHT", "NEARAI_DEBATE_MODEL", "NEARAI_THINK_OPEN", "NEARAI_THINK_REBUT",
            "NEARAI_THINK_PM", "NEARAI_THINK_SIGNOFF", "NEARAI_TIMEOUT_S", "NEARAI_DESK_WORKERS", "NEARAI_DESK_TIMEOUT_S", "EXECUTOR_MODE", "OUTLAYER_API_BASE", "OUTLAYER_API_KEY",
            "OUTLAYER_WALLET_ACCOUNT",
        ],
        # Nilai produksi: menimpa .env lokal, yang memakai groq dan hemat kredit.
        "fixed": {"NEAR_DEX_POOL_ID": "2926", "PYTHONUNBUFFERED": "1", "HQ_PROVIDER": "nearai"},
        "defaults": {"HQ_FALLBACK_PROVIDER": "groq", "NEARAI_BUDGET_USD": "8"},
    },
    "relayer": {
        "service": "relayer",
        "names": COMMON + ["NEAR_RELAYER_PRIVATE_KEY"],
        "fixed": {"PYTHONUNBUFFERED": "1"},
    },
}

NEVER = {"NEAR_OWNER_PRIVATE_KEY", "SUPABASE_PASSWORD"}

# Nama alias di .env pemilik -> nama yang dibaca kode (llm_client.KEY_ALIASES).
ALIASES = {"NEARAI_API_KEY": "NEAR_API_KEY_AI_CREDITS"}

# Mode custody (asumsi A7): agen tidak boleh memegang kunci executor.
CUSTODY_SKIP = {"NEAR_EXECUTOR_PRIVATE_KEY"}


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").replace("\r", "").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def build_pairs(kind: str, env: dict[str, str]) -> tuple[list[str], list[str]]:
    """Kembali (daftar KEY=VALUE, nama yang kosong). Tidak pernah memuat NEVER."""
    spec = SETS[kind]
    fixed = spec["fixed"]
    custody = kind == "agent" and (env.get("EXECUTOR_MODE") or "key").lower() == "custody"
    pairs, empty = [], []
    for k in spec["names"]:
        assert k not in NEVER
        if k in fixed:  # nilai tetap ditambahkan di bawah
            continue
        if custody and k in CUSTODY_SKIP:
            continue
        v = env.get(k) or (env.get(ALIASES[k]) if k in ALIASES else "") or spec.get("defaults", {}).get(k, "")
        if v:
            pairs.append(f"{k}={v}")
        else:
            empty.append(k)
    pairs += [f"{k}={v}" for k, v in fixed.items()]
    return pairs, empty


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in SETS:
        print(__doc__)
        return 2
    kind, dry = argv[0], "--dry-run" in argv
    pairs, empty = build_pairs(kind, read_env(ROOT / ".env"))
    print(f"layanan {SETS[kind]['service']}: {len(pairs)} variabel -> {[p.split('=', 1)[0] for p in pairs]}")
    if empty:
        print(f"kosong di .env, dilewati: {empty}")
    if dry:
        return 0
    exe = shutil.which("railway")
    if not exe:
        print("railway CLI tidak ditemukan")
        return 1
    failed = []
    for p in pairs:  # satu variabel per panggilan, nilai lewat stdin: aman dari kutip dan karakter khusus
        k, v = p.split("=", 1)
        r = subprocess.run([exe, "variable", "set", k, "--stdin", "--service", SETS[kind]["service"], "--skip-deploys"],
                           input=v, capture_output=True, text=True)
        if r.returncode:
            failed.append(k)
    print("gagal:" if failed else "selesai tanpa kegagalan", failed or "")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
