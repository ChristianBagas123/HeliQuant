"""Whale Tracker — "smart money" flow on NEAR from Rhea pool trades (GeckoTerminal).

For each Rhea pool that holds wNEAR it reads the latest trades (up to 300 per pool) and aggregates:
  - Notional volume per swap (filter: > min_notional_usd)
  - Direction from the TOKENS: BUY NEAR when `to_token_address == wrap.near`, SELL NEAR when
    `from_token_address == wrap.near`. (`kind` is relative to the first token of the pool name and would flip
    the sign in USDC/wNEAR pools — S-12.6.)
  - Net flow = sum(BUY notional) - sum(SELL notional)

Bullish if net flow >> 0, bearish if << 0.

SOURCE: GeckoTerminal pool trades, NOT a direct read of pool events. One request returns at most 300 trades, and
coverage differs a lot per pool (about 13 minutes to 15 hours), so the window is not a clean 24h.

THRESHOLD: any swap > $10K counts as "whale-tier" (same as the earlier version). On NEAR almost no single swap
reaches that size, so this tracker is normally `neutral` with confidence 0 and `is_mocked = False`. The main
smart-money path is whale_indexer + whale_manager (trader volume, thresholds $500 / $1,000).

Cache: one cycle (30 minutes), one fetch per pool per cycle. If GeckoTerminal answers HTTP 429 (or any
failure), the signal is `neutral` with `is_mocked = True` and a source label in `reasoning`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

from firm.sources import whale_indexer as wi

CACHE_SECONDS = 1800.0   # one firm cycle


@dataclass(frozen=True)
class WhaleFlowSignal:
    direction: Literal["bullish", "bearish", "neutral"]
    score: float                        # [-1, +1]
    confidence: float                   # 0..1 (data quality)
    net_flow_usd: float                 # raw value
    buy_volume_usd: float
    sell_volume_usd: float
    trade_count: int
    window_blocks: int                  # block-number span covered by the trades
    pool_address: str | None
    is_mocked: bool
    reasoning: str


def mock_signal(why: str, pool: str | None = None) -> WhaleFlowSignal:
    return WhaleFlowSignal("neutral", 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0, pool, True, f"MOCK: {why}")


def build_signal(trades_by_pool: dict[str, list[dict]], min_notional: float = 10_000.0) -> WhaleFlowSignal:
    """WhaleFlowSignal for NEAR from the trades of several pools."""
    buy = sell = 0.0
    n = 0
    anomalous = 0
    blocks: list[int] = []
    for _pool, trades in trades_by_pool.items():
        for t in trades:
            a = t.get("attributes", {})
            if wi.is_anomalous(a):
                anomalous += 1
                continue
            if a.get("block_number") is not None:
                blocks.append(int(a["block_number"]))
            v = float(a.get("volume_in_usd") or 0)
            if v < min_notional:
                continue
            side = wi.trade_side(a)
            if side == "buy":
                buy += v
            elif side == "sell":
                sell += v
            else:
                continue
            n += 1
    total = buy + sell
    norm = (buy - sell) / total if total else 0.0
    direction = "bullish" if norm > 0.15 else ("bearish" if norm < -0.15 else "neutral")
    return WhaleFlowSignal(
        direction=direction,                                  # type: ignore[arg-type]
        score=norm,
        confidence=min(1.0, n / 20.0),
        net_flow_usd=buy - sell,
        buy_volume_usd=buy,
        sell_volume_usd=sell,
        trade_count=n,
        window_blocks=(max(blocks) - min(blocks)) if blocks else 0,
        pool_address=",".join(trades_by_pool) or None,
        is_mocked=False,
        reasoning=(
            f"{direction.upper()} score={norm:+.3f}: {n} trades > ${min_notional:,.0f}; "
            f"buy=${buy:,.0f}, sell=${sell:,.0f}, net=${buy - sell:+,.0f} "
            f"(source: GeckoTerminal pool trades, not pool events; anomalous dropped={anomalous})"
        ),
    )


class WhaleTracker:
    _cache: dict = {"at": 0.0, "key": None, "sig": None}

    def __init__(self, *, pools: list[str] | None = None, min_notional_usd: float = 10_000.0,
                 cache_seconds: float = CACHE_SECONDS) -> None:
        self.pools = pools
        self.min_notional_usd = min_notional_usd
        self.cache_seconds = cache_seconds

    def fetch(self) -> WhaleFlowSignal:
        key = (tuple(self.pools) if self.pools else None, self.min_notional_usd)
        now = time.time()
        c = self._cache
        if c["sig"] is not None and c["key"] == key and now - c["at"] < self.cache_seconds:
            return c["sig"]

        pools = self.pools or wi.discover_pools()
        if not pools:
            return mock_signal("no Rhea wNEAR pool found (GeckoTerminal unavailable)")
        trades_by_pool: dict[str, list[dict]] = {}
        errors: list[str] = []
        for pool in pools:
            trades, err = wi.fetch_trades(pool)
            if err:
                errors.append(err)
                if "429" in err:
                    break   # throttled: stop hammering
            else:
                trades_by_pool[pool] = trades
        if any("429" in e for e in errors) or (errors and not trades_by_pool):
            return mock_signal(errors[0], ",".join(pools))   # neutral + mocked, labeled with the source; not cached
        sig = build_signal(trades_by_pool, self.min_notional_usd)
        if errors:
            sig = WhaleFlowSignal(**{**sig.__dict__, "reasoning": sig.reasoning + f" [partial: {errors[0]}]"})
        self._cache.update(at=now, key=key, sig=sig)
        return sig
