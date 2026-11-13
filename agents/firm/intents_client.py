"""firm/intents_client.py — NEAR Intents (1Click) DRY quotes for position data.

On ENTER the firm asks 1Click for a `dry: true` quote, keeps it in the position data, uses it to ESTIMATE the DEX
route cost, and puts its hash in the anchor record. The quote is NEVER the ledger price: entry, SL, TP and PnL stay on
the live Bitget price.

Contract: nothing here raises and nothing here can stop a firm cycle. ANY failure (timeout, dead host, HTTP 400,
broken JSON, response without `quote.amountOut`, an empty list) falls back to `quote_source: "market"` (S-10.8..S-10.11).

Facts from S-10 that shape this code:
  * a good quote answers HTTP 201 (not 200) -> every 2xx is accepted
  * position data comes from three places: `quote` (amountIn, amountOut, minAmountOut, amountInUsd, amountOutUsd),
    `quoteRequest` (appFees, deadline) and the top level (timestamp, correlationId)
  * the hash covers `quoted_at` and `correlation_id`, so two quotes never hash the same. The hash is for the anchor
    only, never for comparing prices
  * `appFees` holds one entry with `fee: 20` (0.2%, competition rule Q-006)
  * it is NOT known whether `amountOut` is already net of the app fee -> `amountOut` and `appFees` are shown as is,
    labeled "quote, not necessarily net of fees"; the total cost is not computed from the quote
  * Intents is a SPOT swap: no SHORT, no leverage. A SHORT ticket only gets a sell-direction quote as a price reference
  * Intents has no testnet, so this path is separate from the testnet vault
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone

import requests

BASE = "https://1click.chaindefuser.com"
USDC_ID = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
USDC = f"nep141:{USDC_ID}"
UA = {"User-Agent": "heliquant/1.0"}

# asset -> (1Click asset id, decimals). LiNEAR is not on 1Click (S-10.3).
ASSET_IDS = {
    "NEAR": ("nep141:wrap.near", 24),
    "STNEAR": ("nep141:meta-pool.near", 24),
    "RHEA": ("nep141:token.rhealab.near", 18),
    "AURORA": ("nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", 18),
}
USDC_DECIMALS = 6
REQUIRED_FIELDS = ["amountIn", "amountOut", "minAmountOut", "amountInUsd", "amountOutUsd",
                   "appFees", "deadline", "quoted_at", "quote_source"]
LABEL = "quote, not necessarily net of fees"


def dry_account() -> str:
    """Placeholder account for DRY quotes. Not funded, nothing is signed. Replace with the owner's own
    mainnet account (env INTENTS_ACCOUNT) if a real demo swap is ever done."""
    return os.environ.get("INTENTS_ACCOUNT", "").strip() or "heliquant-dry.near"


def _deadline(minutes: int = 10) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _fallback(error, http: int | None = None, t0: float | None = None) -> dict:
    return {"ok": False, "quote_source": "market", "http": http, "data": None,
            "error": str(error)[:300], "latency_ms": int((time.time() - t0) * 1000) if t0 else 0}


def fetch_quote(origin: str, dest: str, amount, *, timeout: float = 10.0, base: str = BASE,
                body_override: dict | None = None) -> dict:
    """DRY quote. Never raises.

    Success: {ok: True, quote_source: "intents", http, data, error: None, latency_ms}.
    Any failure: {ok: False, quote_source: "market", http, data: None, error, latency_ms}.
    """
    t0 = time.time()
    try:
        acct = dry_account()
        body = {"dry": True, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
                "originAsset": origin, "depositType": "INTENTS", "destinationAsset": dest,
                "amount": str(amount), "refundTo": acct, "refundType": "INTENTS",
                "recipient": acct, "recipientType": "INTENTS", "deadline": _deadline()}
        if body_override:
            body.update(body_override)
        assert body["dry"] is True, "only dry quotes may be sent"
        r = requests.post(base + "/v0/quote", json=body, headers=UA, timeout=timeout)
        if not (200 <= r.status_code < 300):
            return _fallback(f"HTTP {r.status_code}: {r.text[:200]}", r.status_code, t0)
        try:
            data = r.json()
        except ValueError as e:
            return _fallback(f"broken JSON: {e}", r.status_code, t0)
        q = data.get("quote") if isinstance(data, dict) else None
        if not isinstance(q, dict) or not q.get("amountOut"):
            return _fallback("response without quote.amountOut", r.status_code, t0)
        return {"ok": True, "quote_source": "intents", "http": r.status_code, "data": data, "error": None,
                "latency_ms": int((time.time() - t0) * 1000)}
    except BaseException as e:  # noqa: BLE001 - contract: must not raise
        return _fallback(f"{type(e).__name__}: {e}", None, t0)


def to_position(resp: dict, side: str, asset: str) -> dict:
    """Turn a fetch_quote result into position data. On failure only `quote_source: market` (+ reason)."""
    if not resp.get("ok"):
        return {"quote_source": "market", "side": side, "asset": asset, "error": resp.get("error")}
    d = resp["data"]
    q, rq = d["quote"], d.get("quoteRequest") or {}
    return {
        "quote_source": "intents", "side": side, "asset": asset,
        "amountIn": q.get("amountIn"), "amountOut": q.get("amountOut"),
        "minAmountOut": q.get("minAmountOut"),
        "amountInUsd": q.get("amountInUsd"), "amountOutUsd": q.get("amountOutUsd"),
        "appFees": rq.get("appFees"), "deadline": rq.get("deadline"),
        "quoted_at": d.get("timestamp"), "correlation_id": d.get("correlationId"),
        "label": LABEL,
    }


def quote_hash(position: dict) -> str:
    """Stable SHA-256 of the position data (same function as the anchor records)."""
    from firm.onchain_recorder import record_hash

    return record_hash(position)


def route_cost_pct(position: dict, live_price: float) -> float | None:
    """INFORMATION ONLY: cost of the DEX route against the live Bitget price, for a BUY quote (USDC -> asset):
    (amountIn_usd - amountOut * live) / amountIn_usd * 100. S-10.7: median 0.135%, range 0.108%..0.176%.
    None when it cannot be computed. Not the ledger price, and not a total fee (net-of-fee status is unknown)."""
    try:
        if position.get("quote_source") != "intents" or position.get("side") != "buy" or live_price <= 0:
            return None
        decimals = ASSET_IDS[position["asset"]][1]
        paid = int(position["amountIn"]) / 10 ** USDC_DECIMALS      # USDC taken as $1 (1Click prices it ~0.9996)
        got = int(position["amountOut"]) / 10 ** decimals
        return round((paid - got * live_price) / paid * 100, 4) if paid > 0 else None
    except Exception:  # noqa: BLE001
        return None


def quote_for_entry(asset: str, direction: str, size_usd: float, price: float, *, timeout: float = 10.0) -> dict:
    """Quote for an ENTER. LONG -> buy `asset` with USDC. SHORT -> sell-direction quote (price reference only).
    Never raises. Assets without a 1Click id (BTC, ETH, LiNEAR ...) return a `market` position."""
    a = asset.strip().upper()
    side = "buy" if str(direction).upper() == "LONG" else "sell"
    ids = ASSET_IDS.get(a)
    if not ids:
        return to_position(_fallback(f"{a} is not on 1Click"), side, a)
    try:
        aid, dec = ids
        if side == "buy":
            origin, dest, amount = USDC, aid, int(size_usd * 10 ** USDC_DECIMALS)
        else:
            origin, dest, amount = aid, USDC, int(size_usd / price * 10 ** dec)
        return to_position(fetch_quote(origin, dest, amount, timeout=timeout), side, a)
    except Exception as e:  # noqa: BLE001
        return to_position(_fallback(f"{type(e).__name__}: {e}"), side, a)


def attach_quote(p: dict, log=print) -> dict:
    """Put the 1Click quote and its hash on position `p` (keys `intents`, `intents_hash`). Never raises and never
    changes entry/SL/TP. On failure the position is labeled `quote_source: market`."""
    try:
        pos = quote_for_entry(p["asset"], p["dir"], float(p.get("size_usd") or 0), float(p.get("entry") or 0))
        p["intents"] = pos
        p["intents_hash"] = quote_hash(pos) if pos.get("quote_source") == "intents" else None
        p["quote_source"] = pos["quote_source"]
        if pos["quote_source"] == "intents":
            cost = route_cost_pct(pos, float(p.get("entry") or 0))
            if cost is not None:
                p["intents_route_cost_pct"] = cost
    except Exception as e:  # noqa: BLE001
        p["quote_source"] = "market"
        try:
            log(f"  [intents] #{p.get('id')} quote skipped ({str(e)[:60]})")
        except Exception:  # noqa: BLE001
            pass
    return p
