"""Per-asset strategy configuration — MODULAR, one config per market.

STATE (re-researched for NEAR, 2026-11-09). Nothing below is carried over from the earlier chain's research;
every number is measured on NEAR data or read from a JSON source of truth:

  * Data:   data/near_hourly.csv (Binance data mirror klines, 1h, ~365 days) -> data/near_features.csv
            (scripts/14 + scripts/02). Perp history for edge research: data/near_perp_hourly.csv (Bitget public,
            ~368 days, scripts/35) and data/near_positioning.csv (funding history; open interest is a live
            snapshot only, so there is NO historical OI series for NEAR — the OI-change hypotheses cannot be tested).
  * Regime classifier (scripts/05 -> models/regime_metadata.json): forward-4h regime accuracy on the held-out test
    split vs a persistence baseline. Read it with `regime_accuracy()`; never hard-code it.
  * Edge lab (scripts/59 NEAR, firm/edge_lab.py gate: OOS ROI > 0, > buy-and-hold, avg > 11 bps, >= 20 trades,
    FDR, walk-forward): no hypothesis passed (see data/onboarding_report.json). data/validated_edges.json stays empty,
    so the firm ABSTAINS on NEAR (no validated trading edge).
  * Self-learn cycle (scripts/60): nothing to graduate or demote.

Accurate regime-reading != trading profit; the org's job is to read the regime and stay disciplined (abstain)
when no validated edge applies.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class AssetConfig:
    ticker: str
    coingecko_id: str

    oversold_rsi: float = 25.0
    overbought_rsi: float = 75.0
    mr_sl_atr_mult: float = 1.0
    mr_tp_atr_mult: float = 1.8

    momentum_adx_min: float = 60.0
    momentum_breakout_window: int = 20
    momentum_volume_min_ratio: float = 1.10
    mo_sl_atr_mult: float = 1.2
    mo_tp_atr_mult: float = 2.5

    mr_flat_threshold_pct: float = 3.0
    forward_conf_threshold: float = 0.65
    momentum_enabled: bool = False

    validation: str = "default"


# NEAR: default strategy parameters. No per-asset tuning has an out-of-sample pass (edge lab: none), so the
# conservative defaults are used and momentum stays disabled.
_NEAR = AssetConfig(
    ticker="NEAR",
    coingecko_id="near",
    validation=(
        "NOT validated for live trading — edge lab (scripts/59, 1-split OOS, cost-aware): funding_fade and "
        "price_momentum both fail the gate on NEAR; no per-asset tuning has an OOS pass. Defaults used."
    ),
)

# Only assets with a REAL out-of-sample pass get a tuned config. None yet; NEAR is listed so the validation text
# is explicit, and every other asset gets the conservative DEFAULT.
ASSET_CONFIGS: dict[str, AssetConfig] = {
    "NEAR": _NEAR,
}


# Honest data-source map for the NEAR ecosystem tokens.
_DATA_SOURCE = {
    "NEAR": "binance data mirror klines 1h (~365d, scripts/14) | bitget perp candles (~368d, scripts/35) | "
            "coingecko:near (scripts/01, 90d fallback)",
    "LINEAR": "coingecko:linear-protocol (monitored only, no perp)",
    "STNEAR": "coingecko:staked-near (monitored only, no perp)",
    "RHEA": "coingecko:rhea-2 (monitored only, no perp)",
    "AURORA": "coingecko:aurora-near (monitored only, no perp)",
}

# ID CoinGecko `rhea` adalah token lain; yang benar untuk RHEA adalah `rhea-2`.
_COINGECKO_IDS = {
    "NEAR": "near",
    "LINEAR": "linear-protocol",
    "STNEAR": "staked-near",
    "RHEA": "rhea-2",
    "AURORA": "aurora-near",
}


def get_config(ticker: str) -> AssetConfig:
    """Return the config for a ticker, or a conservative DEFAULT.

    DEFAULT is returned for any asset without a real validated config. Trading on a
    DEFAULT config is "explore only" — it has NOT been proven out-of-sample.
    """
    ticker = ticker.upper()
    if ticker in ASSET_CONFIGS:
        return ASSET_CONFIGS[ticker]
    return AssetConfig(
        ticker=ticker,
        coingecko_id=_COINGECKO_IDS.get(ticker, ticker.lower()),
        validation="UNVALIDATED (default config — not proven out-of-sample)",
    )


# No asset has a validated out-of-sample TRADING edge for NEAR (edge lab, 2026-11-09).
_VALIDATED_TRADING_EDGE: set[str] = set()


def is_validated(ticker: str) -> bool:
    """True only if the asset has a validated out-of-sample TRADING edge. Currently NONE."""
    return ticker.upper() in _VALIDATED_TRADING_EDGE


def get_data_source(ticker: str) -> str:
    return _DATA_SOURCE.get(ticker.upper(), "unknown")


def regime_accuracy() -> dict:
    """Measured regime-classifier accuracy from models/regime_metadata.json (held-out test split). Empty dict when
    the model has not been trained yet. Use this instead of any hard-coded accuracy claim."""
    try:
        m = json.loads((ROOT / "models" / "regime_metadata.json").read_text(encoding="utf-8"))
        return {"asset": m.get("asset"), "test_accuracy": m.get("test_accuracy"),
                "persistence_baseline": m.get("persistence_baseline_test"), "n_test": m.get("n_test")}
    except (FileNotFoundError, ValueError):
        return {}


def regime_accuracy_text() -> str:
    r = regime_accuracy()
    if not r or r.get("test_accuracy") is None:
        return "regime classifier not trained"
    return (f"{r['test_accuracy'] * 100:.1f}% on the held-out test split vs {r['persistence_baseline'] * 100:.1f}% "
            f"persistence baseline (n={r['n_test']}, {r['asset']})")
