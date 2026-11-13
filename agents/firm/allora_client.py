"""Allora macro signal for the Macro desk, read straight from the Allora chain via LCD (`firm/allora_lcd.py`).

The Allora consumer API (api.allora.network/v2) went down (502) and its replacement at
api.developer.allora.network charges per inference call. The LCD is free, needs no key, and returns the
same network value (`combined_value`).

Why a wrapper:
  - Single source of truth for which Allora topics we use and what "direction" they imply
  - Sane caching (one async call per heartbeat tick, not per request)
  - Typed return so the Signal Agent doesn't depend on the LCD response format
  - Easy mocking in tests

Topic selection (mainnet, confirmed live):
  - Topic 14 = BTC/USD Price Prediction 8h — cleanest USD price prediction
  - Topic 15 = BTC/USD Log Returns 24h — pure directional signal in log-return space

For the multi-scale validation in Signal Agent we use Topic 14: compute the
prediction's deviation from CURRENT spot BTC and treat as macro direction.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import requests

from firm import allora_lcd

BTC_PRICE_PREDICTION_8H_TOPIC = 14
BTC_LOG_RETURNS_24H_TOPIC = 15
ETH_PRICE_PREDICTION_8H_TOPIC = 9

COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price"


@dataclass(frozen=True)
class MacroSignal:
    asset: str
    spot_usd: float
    predicted_usd: float
    predicted_return: float       # (predicted - spot) / spot
    confidence_bps: int           # bookkeeping; the LCD gives no confidence number, default 7500
    direction_bull: bool          # predicted_return >= +threshold
    direction_bear: bool          # predicted_return <= -threshold
    timestamp: int                # time of the Allora block that holds the inference
    block_height: int


def _spot_price(coin_id: str) -> float:
    resp = requests.get(
        COINGECKO_PRICE_URL,
        params={"ids": coin_id, "vs_currencies": "usd"},
        timeout=10,
        headers={"User-Agent": "heliquant/1.0"},
    )
    resp.raise_for_status()
    return float(resp.json()[coin_id]["usd"])


async def fetch_macro_signal(
    topic_id: int,
    coin_id: str,
    asset: str,
    *,
    bull_threshold: float = 0.005,
    bear_threshold: float = -0.005,
) -> MacroSignal:
    """Return the latest Allora macro signal for a topic: predicted 8h price vs current spot."""
    inf = await asyncio.to_thread(allora_lcd.fetch_latest, topic_id)
    predicted = float(inf.value)

    spot = _spot_price(coin_id)
    predicted_return = (predicted - spot) / spot if spot > 0 else 0.0

    return MacroSignal(
        asset=asset,
        spot_usd=spot,
        predicted_usd=predicted,
        predicted_return=predicted_return,
        confidence_bps=7500,
        direction_bull=predicted_return >= bull_threshold,
        direction_bear=predicted_return <= bear_threshold,
        timestamp=inf.timestamp,
        block_height=inf.block_height,
    )


async def fetch_btc_macro_signal(**kw) -> MacroSignal:
    """BTC/USD 8h prediction (topic 14)."""
    return await fetch_macro_signal(BTC_PRICE_PREDICTION_8H_TOPIC, "bitcoin", "BTC", **kw)


async def fetch_eth_macro_signal(**kw) -> MacroSignal:
    """ETH/USD 8h prediction (topic 9)."""
    return await fetch_macro_signal(ETH_PRICE_PREDICTION_8H_TOPIC, "ethereum", "ETH", **kw)
