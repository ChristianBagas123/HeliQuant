"""firm/smart_money.py — POSITIONING-mode smart-money read for assets with a Bitget perp.

Replaces the earlier two-mode engine (scripts/51). The CONTRACT mode (DEX flow of the old chain's tokens) is gone:
on NEAR the on-chain flow read is the whale watchlist (firm/whale_manager + firm/sources/whale_indexer), reported by
the On-chain/Risk desk. This module keeps the perp-positioning read: where the crowd sits (contrarian-to-crowding).

Honest: CONTEXT signal for the PM, not a claimed alpha. Free data only. The retail long/short ratio and an OI
history have no keyless source, so they come from the cached data/{asset}_positioning.csv when present
(scripts/37). For NEAR that file holds funding history only (open interest is a live snapshot), so the long/short
ratio defaults to a neutral 0.5 and the detail says so. Nothing is fabricated.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
EXCHANGE_API = "https://api.bitget.com"
PRODUCT_TYPE = "usdt-futures"


def perp_symbol(asset: str) -> str:
    return f"{asset.upper().replace('USDT', '')}USDT"


def positioning_signal(asset: str) -> dict | None:
    """{score 0..100, label, detail} or None when there is neither a live ticker nor a cache."""
    a = asset.upper()
    sym = perp_symbol(a)
    src = "live"
    fp = ROOT / "data" / f"{a.lower()}_positioning.csv"
    df = pd.read_csv(fp) if fp.exists() else None
    has_ratio = df is not None and "buy_ratio" in df and pd.notna(df["buy_ratio"].iloc[-1])
    buy_ratio = float(df["buy_ratio"].iloc[-1]) if has_ratio else 0.5
    oi_chg = 0.0
    if df is not None and "oi" in df and len(df) > 25 and pd.notna(df["oi"].iloc[-25]) and pd.notna(df["oi"].iloc[-1]):
        oi_chg = (float(df["oi"].iloc[-1]) / float(df["oi"].iloc[-25]) - 1) * 100
    funding = float(df["funding"].iloc[-1]) * 100 if (df is not None and "funding" in df and pd.notna(df["funding"].iloc[-1])) else 0.0
    try:
        j = requests.get(f"{EXCHANGE_API}/api/v2/mix/market/ticker",
                         params={"symbol": sym, "productType": PRODUCT_TYPE}, timeout=12).json()
        data = j.get("data")
        row = data[0] if isinstance(data, list) and data else (data or {})
        if row.get("fundingRate") is not None:
            funding = float(row["fundingRate"]) * 100  # refresh funding from the live exchange ticker
        elif not row:
            raise ValueError("empty ticker")
    except Exception:  # noqa: BLE001 — exchange ticker unavailable; keep cached funding
        if df is None:
            return None
        src = "cached"
    if df is None:
        src = "live (funding only; no positioning cache)"
    elif not has_ratio:
        src += ", no long/short feed -> neutral 0.5"
    # contrarian-to-crowding: heavy long-crowd -> contrarian bearish (low score); balanced -> 50
    score = int(round(100 - buy_ratio * 100))
    crowd = "long-crowded" if buy_ratio > 0.6 else ("short-crowded" if buy_ratio < 0.4 else "balanced")
    lbl = "contrarian-bull" if score >= 60 else ("contrarian-bear / crowded-long" if score <= 40 else "neutral")
    return {"score": score, "label": lbl,
            "detail": f"[{src}] OI 24h {oi_chg:+.1f}% · funding {funding:+.4f}% · long/short {buy_ratio:.2f} ({crowd})"}
