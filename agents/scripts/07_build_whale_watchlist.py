"""Build the NEAR whale watchlist from Rhea pool activity.

Discovers the top Rhea wNEAR pools (GeckoTerminal), pulls their trades, aggregates by trader
account, ranks by composite score (log-volume + realized PnL + activity), and
saves the top-20 watchlist as JSON for downstream Signal Agent consumption.

Usage:
    python scripts/07_build_whale_watchlist.py
Output:
    data/whale_watchlist.json
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from firm.sources.whale_indexer import build_watchlist, discover_pools  # noqa: E402

OUT_PATH = ROOT / "data" / "whale_watchlist.json"


def main() -> None:
    pools = discover_pools()
    print(f"Scanning {len(pools)} Rhea wNEAR pools: {pools}")
    profiles = build_watchlist(pools, top_k=20, out_path=OUT_PATH)

    print(f"\nTop {len(profiles)} whale candidates by composite score:\n")
    print(f"{'Rank':<5} {'Address':<44} {'Bias':<14} {'TotVol':>12} {'NetVol':>12} {'RealPnL':>10} {'Trades':>7} {'Score':>7}")
    print("-" * 122)
    for i, p in enumerate(profiles, 1):
        print(
            f"{i:<5} {p.address:<44} {p.direction_bias:<14} "
            f"${p.total_volume_usd:>10,.0f} ${p.net_volume_usd:>+10,.0f} "
            f"${p.realized_pnl_usd:>+8,.0f} {p.buy_count + p.sell_count:>7} {p.rank_score:>7.2f}"
        )

    print(f"\nSaved -> {OUT_PATH}")


if __name__ == "__main__":
    main()
