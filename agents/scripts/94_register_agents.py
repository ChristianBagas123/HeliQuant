"""scripts/94_register_agents.py — periksa dan sinkronkan data/agent_registry.json dengan identitas on-chain (core NEAR).

Pendaftaran Firm + 12 desk, pembuatan akun desk, dan pemasangan kunci terbatas dilakukan oleh
contracts/scripts/deploy-testnet.sh (idempoten). Skrip ini hanya MEMBACA kontrak:
  - memastikan tiap desk di agent_registry.json punya token yang cocok di core (kind, induk Firm, agent_account);
  - memastikan DESK_KEYS_JSON punya kunci untuk tiap akun desk, dan kunci itu terpasang di akun dengan batas yang benar
    (hanya core.record_output);
  - --sync menulis ulang tokenId di agent_registry.json dari kondisi on-chain.

Pakai:  python scripts/94_register_agents.py            # periksa saja
        python scripts/94_register_agents.py --sync     # perbarui agent_registry.json dari kontrak
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from firm import near_client as nc  # noqa: E402

REGISTRY = ROOT / "data" / "agent_registry.json"


def check(reg: dict, core: str, keys: dict[str, str]) -> tuple[list[str], dict[str, str]]:
    """Kembali (masalah, peta akun -> tokenId on-chain). Hanya membaca."""
    problems: list[str] = []
    onchain: dict[str, str] = {}
    total = int(nc.view(core, "total_agents"))
    by_account: dict[str, dict] = {}
    for tid in range(1, total + 1):
        ident = nc.view(core, "get_identity", {"token_id": str(tid)})
        if ident:
            by_account.setdefault(ident["agent_account"], ident)
    firm = nc.view(core, "get_identity", {"token_id": str(reg.get("firm", {}).get("tokenId", ""))})
    if not firm or firm["kind"] != "Firm":
        problems.append("token Firm di registry tidak ada atau bukan Firm")
    for name, d in (reg.get("desks") or {}).items():
        acct = d.get("account")
        ident = by_account.get(acct or "")
        if not ident:
            problems.append(f"{name}: akun {acct} belum terdaftar di core")
            continue
        onchain[acct] = ident["token_id"]
        if ident["token_id"] != str(d.get("tokenId")):
            problems.append(f"{name}: tokenId registry {d.get('tokenId')} != on-chain {ident['token_id']}")
        if ident["kind"] != d.get("kind"):
            problems.append(f"{name}: kind registry {d.get('kind')} != on-chain {ident['kind']}")
        if firm and ident.get("parent_token_id") != firm["token_id"]:
            problems.append(f"{name}: induk bukan token Firm")
        key = keys.get(acct)
        if not key:
            problems.append(f"{name}: DESK_KEYS_JSON tidak punya kunci untuk {acct}")
            continue
        info = nc.key_info(acct, key)
        if info is None:
            problems.append(f"{name}: kunci tidak terpasang di {acct}")
        elif info.get("full") or info.get("receiver") != core or info.get("methods") != ["record_output"]:
            problems.append(f"{name}: kunci bukan kunci terbatas core.record_output ({info})")
    return problems, onchain


def main(argv: list[str]) -> int:
    nc.guard_config()
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    core = nc.core_id()
    if not core:
        print("set NEAR_CORE_CONTRACT_ID")
        return 1
    problems, onchain = check(reg, core, nc.desk_keys())
    print(f"core {core}: {len(reg.get('desks') or {})} desk di registry, {len(onchain)} cocok on-chain")
    for p in problems:
        print("  !", p)
    if "--sync" in argv:
        for name, d in (reg.get("desks") or {}).items():
            tid = onchain.get(d.get("account") or "")
            if tid:
                d["tokenId"] = tid
        REGISTRY.write_text(json.dumps(reg, indent=2) + "\n", encoding="utf-8")
        print("agent_registry.json diperbarui dari kontrak")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
