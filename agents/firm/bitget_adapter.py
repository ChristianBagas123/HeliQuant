"""firm/bitget_adapter.py — Bitget Demo execution venue (API v3, header `paptrading: 1`).

Order demo BTC / ETH / XRP / NEAR memakai akun Bitget Demo (UTA) lewat `/api/v3` dengan header
`paptrading: 1` saat BITGET_DEMO=1 (bawaan). Tanpa header itu Bitget menolak (kode 40099). Simbol demo sama
dengan simbol live (tanpa awalan S). Data pasar publik (`_public`, ticker/kline/funding) tetap memakai pasar
live Bitget v2 tanpa header dan tanpa tanda tangan. Kunci dari agents/.env: BITGET_API_KEY /
BITGET_API_SECRET / BITGET_PASSPHRASE / BITGET_DEMO=1.

Kalau akun bukan UTA (`/api/v3/account/settings` gagal), order demo dimatikan: `supported()` False dan
semua aset jatuh ke paper.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from pathlib import Path

import requests

BASE = "https://api.bitget.com"
CATEGORY = "USDT-FUTURES"
MARGIN = "USDT"
DEMO_SYMBOLS = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "XRP": "XRPUSDT", "NEAR": "NEARUSDT"}  # aset yang boleh di-order
_ENV_LOADED = False


def _load_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    here = Path(__file__).resolve().parent.parent
    for p in (here / ".env", here.parent / ".env"):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    _ENV_LOADED = True


def _env(k: str, default: str = "") -> str:
    _load_env()
    return os.environ.get(k, default).strip()


def is_demo() -> bool:
    return _env("BITGET_DEMO", "1").lower() in {"1", "true", "yes"}


def _product() -> str:
    return CATEGORY


def _margin() -> str:
    return MARGIN


def _base_asset(asset: str) -> str:
    return asset.upper().replace("USDT", "")


def to_symbol(asset: str) -> str | None:
    """Aset firm (mis. 'BTC') -> simbol Bitget. Mode demo hanya BTC/ETH/XRP/NEAR (None untuk lainnya)."""
    a = _base_asset(asset)
    return DEMO_SYMBOLS.get(a) if is_demo() else f"{a}USDT"


# ── pemeriksaan akun UTA (sekali, di-cache) ────────────────────────────────
_UTA: dict = {"ok": None, "at": 0.0}
_UTA_RETRY_S = 60.0


def uta_ok() -> bool:
    """True kalau akun bisa dipakai lewat API v3 (UTA). Sukses di-cache selamanya; gagal dicoba lagi
    setelah 60 detik (jaringan bisa sementara putus). Tanpa kunci -> False tanpa panggilan jaringan."""
    if not is_demo():
        return True
    if _UTA["ok"]:
        return True
    if not all(_keys()):
        return False
    if _UTA["ok"] is False and time.time() - _UTA["at"] < _UTA_RETRY_S:
        return False
    try:
        d = _request("GET", "/api/v3/account/settings") or {}
        _UTA["ok"] = bool(d.get("accountMode") or d.get("holdMode"))
    except Exception:  # noqa: BLE001
        _UTA["ok"] = False
    _UTA["at"] = time.time()
    return bool(_UTA["ok"])


def supported(asset: str) -> bool:
    """Bisa di-order di venue demo: aset ada di daftar dan akun UTA terdeteksi."""
    return to_symbol(asset) is not None and uta_ok()


_SPEC_CACHE: dict = {}


def _norm_contract(c: dict) -> dict:
    """Kunci kontrak v3 -> kunci v2 yang dipakai kode lain. `online` dinormalkan menjadi `normal`."""
    return {**c, "symbolStatus": "normal" if c.get("status") == "online" else c.get("status"),
            "volumePlace": c.get("quantityPrecision"), "minTradeNum": c.get("minOrderQty"),
            "minTradeUSDT": c.get("minOrderAmount"), "sizeMultiplier": c.get("quantityMultiplier"),
            "pricePlace": c.get("pricePrecision"), "maxLever": c.get("maxLeverage")}


def contract_spec(asset: str) -> dict | None:
    sym = to_symbol(asset)
    if not sym:
        return None
    if not _SPEC_CACHE:
        for c in (_request("GET", "/api/v3/market/instruments", params={"category": CATEGORY}) or []):
            _SPEC_CACHE[c["symbol"]] = _norm_contract(c)
    return _SPEC_CACHE.get(sym)


def order_size(usd: float, price: float, spec: dict) -> str:
    """Ukuran order (string) untuk ~`usd` pada `price`: dibulatkan ke bawah ke langkah kontrak, dinaikkan ke
    minimum kontrak, lalu ke nilai minimal (5 USDT) memakai harga demo. Diformat sesuai quantityPrecision."""
    usd_d, price_d = Decimal(str(usd)), Decimal(str(price))
    place = int(spec.get("volumePlace", 0) or 0)
    step = Decimal(str(spec.get("sizeMultiplier") or 0)) or Decimal(1).scaleb(-place)
    minq = Decimal(str(spec.get("minTradeNum") or 0))
    min_usdt = Decimal(str(spec.get("minTradeUSDT") or 0))
    qty = (usd_d / price_d / step).to_integral_value(ROUND_FLOOR) * step
    qty = max(qty, minq)
    if qty * price_d < min_usdt:
        qty = (min_usdt / price_d / step).to_integral_value(ROUND_CEILING) * step
    return f"{qty:.{place}f}"


def round_size(asset: str, usd: float, price: float) -> str:
    """Ukuran order (string) untuk ~`usd` notional. `price` harus harga DEMO (get_ticker), karena batas
    5 USDT dihitung bursa dengan harga demo. Mengembalikan "0" kalau kontrak tidak ada atau harga <= 0."""
    spec = contract_spec(asset)
    if not spec or not price or float(price) <= 0:
        return "0"
    return order_size(usd, price, spec)


def _keys() -> tuple[str, str, str]:
    return _env("BITGET_API_KEY"), _env("BITGET_API_SECRET"), _env("BITGET_PASSPHRASE")


def _sign(ts: str, method: str, request_path: str, body: str = "") -> str:
    _, secret, _ = _keys()
    mac = hmac.new(secret.encode(), f"{ts}{method.upper()}{request_path}{body}".encode(), hashlib.sha256).digest()
    return base64.b64encode(mac).decode()


def _request(method: str, path: str, params: dict | None = None, body: dict | None = None):
    method = method.upper()
    query = ("?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))) if params else ""
    request_path = path + query
    body_str = json.dumps(body, separators=(",", ":")) if body else ""
    key, _, passph = _keys()
    ts = str(int(time.time() * 1000))
    headers = {
        "ACCESS-KEY": key,
        "ACCESS-SIGN": _sign(ts, method, request_path, body_str),
        "ACCESS-TIMESTAMP": ts,
        "ACCESS-PASSPHRASE": passph,
        "Content-Type": "application/json",
        "locale": "en-US",
    }
    if is_demo():
        headers["paptrading"] = "1"
    r = requests.request(method, BASE + request_path, headers=headers, data=(body_str or None), timeout=15)
    try:
        j = r.json()
    except ValueError:
        raise RuntimeError(f"Bitget {path} HTTP{r.status_code} respons bukan JSON") from None
    if str(j.get("code")) not in {"00000", "0"}:
        raise RuntimeError(f"Bitget {path} HTTP{r.status_code} code={j.get('code')} msg={j.get('msg')}")
    return j.get("data")


# ── reads (API v3) ─────────────────────────────────────────────────────────
def _usdt_asset(d: dict) -> dict:
    return next((x for x in (d.get("assets") or []) if x.get("coin") == MARGIN), {})


def accounts() -> dict:
    """Respons mentah `/api/v3/account/assets` (akun UTA)."""
    return _request("GET", "/api/v3/account/assets") or {}


def get_balance() -> tuple[float, float]:
    """(available, equity) USDT."""
    a = _usdt_asset(accounts())
    return float(a.get("available", 0) or 0), float(a.get("equity", 0) or 0)


def account_summary() -> dict:
    """Bacaan akun untuk UI: available + equity + PnL belum terealisasi (tingkat akun, dari API)."""
    d = accounts()
    a = _usdt_asset(d)
    return {
        "available_usd": float(a.get("available", 0) or 0),
        "equity_usd": float(a.get("equity", 0) or 0),
        "unrealized_pnl_usd": float(d.get("usdtUnrealisedPnl", d.get("unrealisedPnl", 0)) or 0),
    }


def get_ticker(asset: str) -> float:
    """Harga ticker DEMO (bukan harga live). `lastPrice` demo bergantian antara bid dan ask."""
    sym = to_symbol(asset)
    if not sym:
        raise ValueError(f"{asset} not on Bitget demo (supports {list(DEMO_SYMBOLS)})")
    d = _request("GET", "/api/v3/market/tickers", params={"category": CATEGORY, "symbol": sym})
    row = d[0] if isinstance(d, list) and d else (d or {})
    return float(row.get("lastPrice") or 0)


# ── public market data (keyless · MAINNET) — the firm's price/kline/funding feed, no API key needed ──
def _pub_symbol(asset: str) -> str:
    a = asset.upper().replace("USDT", "")
    return f"{a}USDT"


def _public(path: str, params: dict | None = None):
    """Unsigned public GET (mainnet market data — no key)."""
    r = requests.get(BASE + path, params=params, timeout=15)
    j = r.json()
    if str(j.get("code")) not in {"00000", "0"}:
        raise RuntimeError(f"Bitget {path} code={j.get('code')} msg={j.get('msg')}")
    return j.get("data")


def market_snapshot(asset: str) -> dict:
    """Public mainnet ticker (keyless): last, funding rate, open interest, 24h volume + change."""
    sym = _pub_symbol(asset)
    d = _public("/api/v2/mix/market/ticker", {"symbol": sym, "productType": "usdt-futures"})
    t = (d[0] if isinstance(d, list) and d else (d or {})) or {}
    return {
        "asset": asset.upper(), "symbol": sym,
        "last": float(t.get("lastPr") or 0),
        "funding_rate": float(t.get("fundingRate") or 0),
        "open_interest": float(t.get("holdingAmount") or 0),
        "vol_24h": float(t.get("baseVolume") or 0),
        "change_24h_pct": round(float(t.get("change24h") or 0) * 100, 2),
        "source": "bitget-mainnet",
    }


def public_candles(asset: str, granularity: str = "1H", limit: int = 100) -> list:
    """Public mainnet OHLCV (keyless). Returns [{t,o,h,l,c,vol}]."""
    sym = _pub_symbol(asset)
    rows = _public("/api/v2/mix/market/candles",
                   {"symbol": sym, "productType": "usdt-futures", "granularity": granularity, "limit": str(limit)}) or []
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "vol": float(r[5])}
            for r in rows]


def crowd_positioning(asset: str, period: str = "1h") -> dict:
    """Public mainnet CROWD positioning (keyless) — aggregate retail long/short, NOT individual whales
    (a CEX exposes no per-trader positions). Account ratio = % of accounts long/short; position ratio =
    % of open interest long/short; plus total open interest. A contrarian sentiment read."""
    sym = _pub_symbol(asset)
    out: dict = {"asset": asset.upper(), "symbol": sym, "long_acct_pct": None, "short_acct_pct": None,
                 "long_pos_pct": None, "short_pos_pct": None, "open_interest": None}
    try:
        a = _public("/api/v2/mix/market/account-long-short", {"symbol": sym, "period": period})
        row = (a[0] if isinstance(a, list) and a else a) or {}
        out["long_acct_pct"] = round(float(row.get("longAccountRatio", 0) or 0) * 100, 1)
        out["short_acct_pct"] = round(float(row.get("shortAccountRatio", 0) or 0) * 100, 1)
    except Exception:  # noqa: BLE001
        pass
    try:
        p = _public("/api/v2/mix/market/position-long-short", {"symbol": sym, "period": period})
        row = (p[0] if isinstance(p, list) and p else p) or {}
        out["long_pos_pct"] = round(float(row.get("longPositionRatio", 0) or 0) * 100, 1)
        out["short_pos_pct"] = round(float(row.get("shortPositionRatio", 0) or 0) * 100, 1)
    except Exception:  # noqa: BLE001
        pass
    try:
        oi = _public("/api/v2/mix/market/open-interest", {"symbol": sym, "productType": "usdt-futures"})
        lst = (oi or {}).get("openInterestList") or []
        if lst:
            out["open_interest"] = float(lst[0].get("size") or 0)
    except Exception:  # noqa: BLE001
        pass
    return out


def _norm_position(p: dict) -> dict:
    return {**p, "holdSide": p.get("posSide") or p.get("holdSide"),
            "total": p.get("size") or p.get("total") or p.get("available") or "0"}


def get_positions() -> list:
    """Posisi terbuka (ukuran > 0), dinormalkan ke `holdSide` dan `total`."""
    d = _request("GET", "/api/v3/position/current-position", params={"category": CATEGORY}) or {}
    rows = [_norm_position(p) for p in (d.get("list") or [])]
    return [p for p in rows if float(p["total"] or 0) > 0]


# ── trade ──────────────────────────────────────────────────────────────────
def place_market_order(asset: str, side: str, size: str | float, reduce_only: bool = False) -> dict:
    """side 'buy'(long)/'sell'(short); size dalam koin dasar (string dari round_size). Mode one-way.
    Mengembalikan {orderId, ...}."""
    sym = to_symbol(asset)
    if not sym:
        raise ValueError(f"{asset} not tradable on Bitget demo (supports {list(DEMO_SYMBOLS)})")
    body = {
        "category": CATEGORY, "symbol": sym, "qty": str(size), "side": side.lower(),
        "orderType": "market", "reduceOnly": "yes" if reduce_only else "no",
    }
    return _request("POST", "/api/v3/trade/place-order", body=body)


def order_fill_price(order_id: str, tries: int = 5) -> float | None:
    """Harga fill rata-rata sebuah order (`/api/v3/trade/order-info`), atau None kalau belum tersedia."""
    for _ in range(tries):
        d = _request("GET", "/api/v3/trade/order-info", params={"orderId": order_id}) or {}
        px = d.get("avgPrice") or d.get("priceAvg")
        if px not in (None, "", "0"):
            return float(px)
        time.sleep(0.6)
    return None


def flatten() -> list:
    """Close every open position with a market reduce-only order."""
    done = []
    for p in get_positions():
        size = p.get("total") or "0"
        if float(size) <= 0:
            continue
        sym = p.get("symbol", "")
        asset = next((a for a, s in DEMO_SYMBOLS.items() if s == sym), sym)
        side = "sell" if p.get("holdSide") == "long" else "buy"
        try:
            r = place_market_order(asset, side, size, reduce_only=True)
            done.append({"symbol": sym, "closed": size, "side": side, "orderId": r.get("orderId") if isinstance(r, dict) else r})
        except Exception as e:  # noqa: BLE001
            done.append({"symbol": sym, "error": str(e)[:120]})
    return done


_HOLD: dict = {"one_way": None}


def set_position_mode(one_way: bool = True) -> dict:
    """Setel mode posisi akun: one-way atau hedge. Akun demo baru mulai dengan `hedge_mode`. Idempoten:
    mode dibaca dulu dan hanya diubah kalau beda; hasilnya di-cache (satu panggilan jaringan per proses)."""
    if _HOLD["one_way"] is one_way:
        return {"holdMode": "one_way_mode" if one_way else "hedge_mode", "changed": False}
    want = "one_way_mode" if one_way else "hedge_mode"
    cur = (_request("GET", "/api/v3/account/settings") or {}).get("holdMode")
    if cur == want:
        _HOLD["one_way"] = one_way
        return {"holdMode": cur, "changed": False}
    r = _request("POST", "/api/v3/account/set-hold-mode", body={"holdMode": want})
    _HOLD["one_way"] = one_way
    return {"holdMode": want, "changed": True, "data": r}


def status() -> dict:
    out = {"demo": is_demo(), "product": _product(), "margin": _margin(), "symbols": list(DEMO_SYMBOLS),
           "keys_present": all(_keys())}
    try:
        avail, equity = get_balance()
        out.update(connected=True, available=avail, equity=equity, uta=uta_ok())
    except Exception as e:  # noqa: BLE001
        out.update(connected=False, error=str(e)[:200])
    return out


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    print("=== Bitget DEMO adapter (v3) ===")
    print(json.dumps(status(), indent=2))
    for a in ("BTC", "ETH", "XRP", "NEAR"):
        try:
            print(f"{a} ({to_symbol(a)}) last:", get_ticker(a))
        except Exception as e:  # noqa: BLE001
            print(f"{a} ticker error:", str(e)[:120])
    if "--order" in sys.argv:
        try:
            try:
                set_position_mode(True)
            except Exception as e:  # noqa: BLE001
                print("set-mode note:", str(e)[:120])
            px = get_ticker("NEAR")
            qty = round_size("NEAR", 10, px)
            print("TEST ORDER:", json.dumps(place_market_order("NEAR", "buy", qty), indent=2))
            time.sleep(1)
            print("positions:", json.dumps(get_positions(), indent=2)[:600])
            print("flatten:", json.dumps(flatten(), indent=2))
        except Exception as e:  # noqa: BLE001
            print("order error:", str(e)[:200])
