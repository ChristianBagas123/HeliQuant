"""Whale Indexer — auto-detect smart-money wallets via on-chain trade history on NEAR.

Architecture (honest scope):
  - Data source: GeckoTerminal API (free tier, no auth, up to 300 trades per pool request)
  - Coverage:    the top Rhea pools that contain wNEAR and traded in the last 24h (discovered dynamically)
  - Window:      whatever 300 trades cover. It differs a lot per pool (about 13 minutes to 15 hours, S-12),
                 so it is NOT a clean 24h window.
  - Ranking:     net volume + simplified realized PnL per trader account.

Direction comes from the TOKENS, never from `kind`. `kind` is relative to the first token in the pool name:
in a USDC/wNEAR pool `kind = sell` means the trader BOUGHT NEAR (S-12.6, 10 of 10 trades matched the Rhea
contract logs).
  - BUY  NEAR  when to_token_address   == wrap.near
  - SELL NEAR  when from_token_address == wrap.near
Anything else (a trade without wNEAR) is skipped.

Pools named like `nep141:...___nep141:...` (omft/intents pools) are dropped: their trader addresses and tx hashes
are 32 hex characters, not NEAR accounts, so they cannot be matched to a transaction (S-12.5).

This is trade data from GeckoTerminal, not a direct read of pool events. We do NOT pretend to be Nansen.
Trader concentration is high (top-3 hold about 51% of volume), so the result is context, not a validated edge.

Output:
  - WhaleProfile dataclass per trader
  - Ranked top-K watchlist saved to data/whale_watchlist.json
"""

from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable

import requests

GECKO_BASE = "https://api.geckoterminal.com/api/v2/networks/near"
NEAR_TOKEN = "wrap.near"
STABLES = {"USDC", "USDT", "USD1", "DAI", "USDE", "USDC.E", "USDT.E", "USDS", "FDUSD", "PYUSD"}
RHEA_PREFIXES = ("refv1-", "refv2-")
MIN_GAP_S = 4.0            # 2.3 s between requests triggered HTTP 429 in the spike (S-12)
POOL_CACHE_S = 3600.0      # pool discovery is cached for an hour (request budget)
HEADERS = {"User-Agent": "heliquant/1.0", "Accept": "application/json"}

_last_call = {"t": 0.0}
_pool_cache: dict = {"at": 0.0, "pools": []}


class Throttled(Exception):
    """GeckoTerminal answered HTTP 429 and retries are used up."""


@dataclass
class TraderActivity:
    address: str
    pools: set[str] = field(default_factory=set)
    buy_volume_usd: float = 0.0
    sell_volume_usd: float = 0.0
    buy_count: int = 0
    sell_count: int = 0
    avg_buy_price: float = 0.0
    avg_sell_price: float = 0.0
    realized_pnl_usd: float = 0.0
    first_seen_utc: str | None = None
    last_seen_utc: str | None = None

    @property
    def net_volume_usd(self) -> float:
        return self.buy_volume_usd - self.sell_volume_usd

    @property
    def total_volume_usd(self) -> float:
        return self.buy_volume_usd + self.sell_volume_usd

    @property
    def trade_count(self) -> int:
        return self.buy_count + self.sell_count


@dataclass
class WhaleProfile:
    """Snapshot summary of a single trader account — suitable for JSON dump."""
    address: str
    pools: list[str]
    total_volume_usd: float
    net_volume_usd: float
    buy_volume_usd: float
    sell_volume_usd: float
    buy_count: int
    sell_count: int
    realized_pnl_usd: float
    avg_buy_price: float
    avg_sell_price: float
    first_seen_utc: str | None
    last_seen_utc: str | None
    rank_score: float           # composite score for ranking
    direction_bias: str         # "accumulating" | "distributing" | "neutral"


# ── HTTP ───────────────────────────────────────────────────────────────────
def _get(path: str, params: dict | None = None, retries: int = 2) -> dict:
    """GET JSON from GeckoTerminal with a minimum gap between calls. HTTP 429: wait, retry, then Throttled."""
    for attempt in range(retries + 1):
        wait = MIN_GAP_S - (time.time() - _last_call["t"])
        if wait > 0:
            time.sleep(wait)
        _last_call["t"] = time.time()
        r = requests.get(GECKO_BASE + path, params=params, headers=HEADERS, timeout=15)
        if r.status_code == 429:
            if attempt < retries:
                time.sleep(10 * (attempt + 1))
                continue
            raise Throttled("GeckoTerminal HTTP 429")
        r.raise_for_status()
        return r.json()
    raise Throttled("GeckoTerminal HTTP 429")  # pragma: no cover


def fetch_trades(pool_id: str, retries: int = 2) -> tuple[list[dict], str | None]:
    """Latest trades of a pool as (trades, None), or ([], reason). Never raises. The pool id goes in the URL
    path as-is (raw ids such as `refv2-...:wrap.near:100` work without URL-encoding, S-12.3)."""
    try:
        d = _get(f"/pools/{pool_id}/trades", retries=retries)
        return d.get("data") or [], None
    except Throttled:
        return [], "GeckoTerminal HTTP 429 (request limit)"
    except Exception as e:  # noqa: BLE001
        return [], f"{type(e).__name__}: {str(e)[:100]}"


# ── pool discovery ─────────────────────────────────────────────────────────
def split_symbols(name: str) -> tuple[str, str]:
    parts = [p.strip() for p in name.split("/")]
    return (parts[0], parts[1]) if len(parts) == 2 else (name, "")


def keep_pool(name: str) -> tuple[bool, str]:
    """Drop same-asset pools (USDT/USDT) and stable/stable pools (USDC/USDT)."""
    a, b = split_symbols(name)
    if a.upper() == b.upper():
        return False, "same asset"
    if a.upper() in STABLES and b.upper() in STABLES:
        return False, "stablecoin pair"
    return True, ""


def is_rhea_wnear_pool(pool: dict) -> bool:
    """A Rhea pool with wNEAR that traded in the last 24h. `nep141:...___nep141:...` pools are dropped."""
    pid = str(pool.get("id", "")).removeprefix("near_")
    a = pool.get("attributes", {})
    if "___" in pid or not pid.startswith(RHEA_PREFIXES):
        return False
    if "wNEAR" not in str(a.get("name", "")) or not keep_pool(str(a.get("name", "")))[0]:
        return False
    h24 = (a.get("transactions") or {}).get("h24") or {}
    return (int(h24.get("buys") or 0) + int(h24.get("sells") or 0)) > 0


def select_pools(pools: Iterable[dict], top_n: int = 5) -> list[str]:
    """Top `top_n` pool ids (without the `near_` prefix) by 24h volume."""
    ok = [p for p in pools if is_rhea_wnear_pool(p)]
    ok.sort(key=lambda p: float(((p.get("attributes") or {}).get("volume_usd") or {}).get("h24") or 0), reverse=True)
    return [p["id"].removeprefix("near_") for p in ok[:top_n]]


def discover_pools(top_n: int = 5, pages: int = 3, force: bool = False) -> list[str]:
    """Dynamic pool discovery (3 listing pages). Cached for an hour. Returns [] if GeckoTerminal fails."""
    now = time.time()
    if not force and _pool_cache["pools"] and now - _pool_cache["at"] < POOL_CACHE_S:
        return list(_pool_cache["pools"])
    pools: list[dict] = []
    try:
        for page in range(1, pages + 1):
            pools += _get("/pools", params={"page": page}).get("data") or []
    except Exception:  # noqa: BLE001
        if not pools:
            return list(_pool_cache["pools"])  # stale cache beats nothing
    chosen = select_pools(pools, top_n)
    if chosen:
        _pool_cache.update(at=now, pools=chosen)
    return chosen


def is_anomalous(attrs: dict) -> bool:
    return bool(attrs.get("is_anomalous"))


def trade_side(attrs: dict) -> str | None:
    """'buy' / 'sell' of NEAR from the tokens, or None for a trade without wNEAR."""
    if attrs.get("to_token_address") == NEAR_TOKEN:
        return "buy"
    if attrs.get("from_token_address") == NEAR_TOKEN:
        return "sell"
    return None


# ── aggregation ────────────────────────────────────────────────────────────
def aggregate_traders(pools: Iterable[str] | None = None,
                      trades_by_pool: dict[str, list[dict]] | None = None) -> dict[str, TraderActivity]:
    """Walk pools, aggregate trader activity. Returns account->TraderActivity.

    `trades_by_pool` skips the network (tests, or trades already fetched)."""
    if trades_by_pool is None:
        trades_by_pool = {}
        for pool in (pools if pools is not None else discover_pools()):
            trades, _err = fetch_trades(pool)
            trades_by_pool[pool] = trades

    traders: dict[str, TraderActivity] = defaultdict(lambda: TraderActivity(address=""))
    buy_value_sum: dict[str, float] = defaultdict(float)
    buy_volume_sum: dict[str, float] = defaultdict(float)
    sell_value_sum: dict[str, float] = defaultdict(float)
    sell_volume_sum: dict[str, float] = defaultdict(float)

    for pool, trades in trades_by_pool.items():
        for t in trades:
            a = t.get("attributes", {})
            addr = (a.get("tx_from_address") or "").lower()
            if not addr or is_anomalous(a):
                continue
            side = trade_side(a)
            if side is None:
                continue
            vol_usd = float(a.get("volume_in_usd") or 0.0)
            # price of NEAR in USD: the token received on a buy, the token sold on a sell
            price_usd = float(a.get("price_to_in_usd") or 0.0) if side == "buy" else float(a.get("price_from_in_usd") or 0.0)
            ts = a.get("block_timestamp")

            tr = traders[addr]
            tr.address = addr
            tr.pools.add(pool)
            if tr.first_seen_utc is None or (ts and ts < tr.first_seen_utc):
                tr.first_seen_utc = ts
            if tr.last_seen_utc is None or (ts and ts > tr.last_seen_utc):
                tr.last_seen_utc = ts

            if side == "buy":
                tr.buy_volume_usd += vol_usd
                tr.buy_count += 1
                buy_value_sum[addr] += vol_usd * price_usd
                buy_volume_sum[addr] += vol_usd
            else:
                tr.sell_volume_usd += vol_usd
                tr.sell_count += 1
                sell_value_sum[addr] += vol_usd * price_usd
                sell_volume_sum[addr] += vol_usd

    for addr, tr in traders.items():
        if buy_volume_sum[addr] > 0:
            tr.avg_buy_price = buy_value_sum[addr] / buy_volume_sum[addr]
        if sell_volume_sum[addr] > 0:
            tr.avg_sell_price = sell_value_sum[addr] / sell_volume_sum[addr]
        if tr.avg_buy_price > 0 and tr.avg_sell_price > 0:
            # Realized PnL = pct gain * matched volume. Cap at 2x total volume to discard anomalies.
            matched_vol = min(tr.buy_volume_usd, tr.sell_volume_usd)
            raw_pnl = (tr.avg_sell_price - tr.avg_buy_price) * matched_vol / max(tr.avg_buy_price, 1e-9)
            tr.realized_pnl_usd = 0.0 if abs(raw_pnl) > 2.0 * tr.total_volume_usd else raw_pnl
    return dict(traders)


def rank_whales(
    traders: dict[str, TraderActivity],
    *,
    top_k: int = 20,
    min_volume_usd: float = 500.0,
) -> list[WhaleProfile]:
    """Rank traders by composite score (volume + PnL + activity). Threshold: $500 volume, top 20."""
    import math

    candidates = [t for t in traders.values() if t.total_volume_usd >= min_volume_usd]

    def score(t: TraderActivity) -> float:
        vol_score = math.log10(max(t.total_volume_usd, 1.0))
        pnl_score = math.tanh(t.realized_pnl_usd / 1000.0)  # saturate at $1K
        activity = math.log10(max(t.trade_count, 1))
        return vol_score + pnl_score + 0.5 * activity

    ranked = sorted(candidates, key=score, reverse=True)[:top_k]
    profiles: list[WhaleProfile] = []
    for t in ranked:
        bias = "neutral"
        if t.buy_volume_usd > 1.25 * t.sell_volume_usd:
            bias = "accumulating"
        elif t.sell_volume_usd > 1.25 * t.buy_volume_usd:
            bias = "distributing"
        profiles.append(WhaleProfile(
            address=t.address,
            pools=sorted(t.pools),
            total_volume_usd=round(t.total_volume_usd, 2),
            net_volume_usd=round(t.net_volume_usd, 2),
            buy_volume_usd=round(t.buy_volume_usd, 2),
            sell_volume_usd=round(t.sell_volume_usd, 2),
            buy_count=t.buy_count,
            sell_count=t.sell_count,
            realized_pnl_usd=round(t.realized_pnl_usd, 2),
            avg_buy_price=round(t.avg_buy_price, 6),
            avg_sell_price=round(t.avg_sell_price, 6),
            first_seen_utc=t.first_seen_utc,
            last_seen_utc=t.last_seen_utc,
            rank_score=round(score(t), 4),
            direction_bias=bias,
        ))
    return profiles


def addr_kind(a: str) -> str:
    """'implicit64' (64 hex), 'hex32' (not a NEAR account), 'named' (name.near, name.tg ...) or 'other'."""
    if re.fullmatch(r"[0-9a-f]{64}", a):
        return "implicit64"
    if re.fullmatch(r"[0-9a-f]{32}", a):
        return "hex32"
    if "." in a or re.fullmatch(r"[a-z0-9_-]{2,64}", a):
        return "named"
    return "other"


def save_watchlist(profiles: list[WhaleProfile], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([asdict(p) for p in profiles], indent=2), encoding="utf-8")


def build_watchlist(
    pools: Iterable[str] | None = None,
    top_k: int = 20,
    out_path: Path | None = None,
) -> list[WhaleProfile]:
    """End-to-end: discover pools (unless given), fetch trades, aggregate, rank, save watchlist."""
    traders = aggregate_traders(pools)
    profiles = rank_whales(traders, top_k=top_k)
    if out_path:
        save_watchlist(profiles, out_path)
    return profiles
