"""firm/defillama_client.py — DeFiLlama (keyless) NEAR-ecosystem fundamentals desk.

The on-chain desks are thin on NEAR (whale trade data is concentrated). DeFiLlama gives a real, keyless,
NEAR-native FUNDAMENTAL read: chain TVL trend (capital flowing into / out of the NEAR ecosystem),
protocol fees/revenue, and staking-yield pools (LiNEAR/stNEAR/rNEAR). Rising TVL + fees = ecosystem risk-on; falling
= risk-off. Advisory desk input (context, not a standalone predictive edge — validate before trading on it).
Source: api.llama.fi / yields.llama.fi (no key).
"""
from __future__ import annotations

import requests

BASE = "https://api.llama.fi"
YIELDS = "https://yields.llama.fi"


def chain_tvl(chain: str = "Near") -> dict | None:
    """Current NEAR TVL + 7d/30d change (capital in/out of the ecosystem)."""
    try:
        r = requests.get(f"{BASE}/v2/historicalChainTvl/{chain}", timeout=20)
        rows = r.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(rows, list) or len(rows) < 31:
        return None
    tvl = [x.get("tvl", 0) for x in rows]
    now, d7, d30 = tvl[-1], tvl[-8], tvl[-31]
    chg7 = (now / d7 - 1) * 100 if d7 else 0.0
    chg30 = (now / d30 - 1) * 100 if d30 else 0.0
    trend = "rising" if chg7 > 2 else "falling" if chg7 < -2 else "flat"
    return {"chain": chain, "tvl_usd": round(now), "chg7d_pct": round(chg7, 1),
            "chg30d_pct": round(chg30, 1), "trend": trend}


def chain_fees(chain: str = "Near") -> dict | None:
    """NEAR 24h protocol fees (usage/revenue proxy)."""
    try:
        r = requests.get(f"{BASE}/overview/fees/{chain}?excludeTotalDataChart=true", timeout=20)
        j = r.json()
        return {"fees_24h_usd": round(j.get("total24h", 0) or 0), "fees_7d_usd": round(j.get("total7d", 0) or 0)}
    except Exception:  # noqa: BLE001
        return None


def staking_yields(chain: str = "Near", symbols=("LINEAR", "STNEAR", "RNEAR", "NEAR")) -> list[dict]:
    """Top NEAR-eco yield pools for the staking assets (APY) — feeds the carry/convergence ideas."""
    try:
        pools = requests.get(f"{YIELDS}/pools", timeout=25).json().get("data", [])
    except Exception:  # noqa: BLE001
        return []
    out = []
    for p in pools:
        if str(p.get("chain", "")).lower() != chain.lower():
            continue
        sym = str(p.get("symbol", "")).upper()
        if any(s in sym for s in symbols):
            out.append({"symbol": p.get("symbol"), "project": p.get("project"),
                        "apy": round(p.get("apy", 0) or 0, 2), "tvl_usd": round(p.get("tvlUsd", 0) or 0)})
    return sorted(out, key=lambda x: x["tvl_usd"], reverse=True)[:6]


def near_brief() -> str:
    """One-line advisory for the PM: NEAR ecosystem fundamentals (TVL trend + fees). Empty on failure."""
    t = chain_tvl("Near")
    if not t:
        return ""
    f = chain_fees("Near") or {}
    fee_txt = f", fees ${f['fees_24h_usd']/1e3:.0f}k/24h" if f.get("fees_24h_usd") else ""
    return (f"NEAR FUNDAMENTALS DESK (DeFiLlama): chain TVL ${t['tvl_usd']/1e6:.0f}M {t['trend']} "
            f"({t['chg7d_pct']:+.1f}% 7d, {t['chg30d_pct']:+.1f}% 30d){fee_txt}. "
            f"Ecosystem {'risk-ON (capital inflow)' if t['trend']=='rising' else 'risk-OFF (outflow)' if t['trend']=='falling' else 'stable'}. Advisory context.")


if __name__ == "__main__":
    import json
    print("TVL:", json.dumps(chain_tvl("Near"), indent=2))
    print("fees:", json.dumps(chain_fees("Near"), indent=2))
    print("yields:", json.dumps(staking_yields("Near"), indent=2))
    print("\nbrief:", near_brief())
