"""Nansen smart-money client — CREDIT-FRUGAL (50 credits/call, ~1000 total → cache hard).

Used by the org's Smart-Money desk for MACRO smart-money context: what funds/smart-traders are
net-accumulating vs distributing on Ethereum (the macro reference).
NEAR-direct smart-money coverage is not assumed, so Nansen's value here = the
rich majors signal as macro context.

CACHE: one call costs ~15 credits (measured 2026-11-12: 95 -> 80), so results are cached for
NANSEN_CACHE_MIN minutes (default 240 = 4 hours; the signal is a 24h net flow). A good result is also
stored in Supabase (`hq_state` nansen:<chains>) so a redeploy does not spend credits again. A failed
call is cached only FAIL_TTL_SEC in memory, so a short outage does not block Nansen for hours.

KEY ROTATION: keys are read from NANSEN_API_KEY, NANSEN_API_KEY_2 ... NANSEN_API_KEY_9 (process env first,
then agents/.env, then the project-root .env). The client sticks to the key that last worked. A key that
answers 401/402/403 (invalid, or credits used up) is parked for KEY_PARK_SEC; one that answers 429 is parked
for RATE_PARK_SEC. The next key is tried in the same call. Logs and notes name the key slot ("key 2/4"),
never the key itself.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://api.nansen.ai"
DEFAULT_CACHE_MIN = 240
FAIL_TTL_SEC = 600
_CACHE: dict[str, tuple[float, dict]] = {}   # {chains: (time.time() saat diambil, hasil)}

KEY_NAMES = ["NANSEN_API_KEY"] + [f"NANSEN_API_KEY_{i}" for i in range(2, 10)]
KEY_PARK_SEC = 6 * 3600   # 401/402/403: kunci salah atau kredit habis; jangan dicoba lagi selama 6 jam
RATE_PARK_SEC = 60        # 429: batas laju; coba kunci lain, kunci ini boleh dipakai lagi setelah 1 menit
_PARK_STATUS = {401: KEY_PARK_SEC, 402: KEY_PARK_SEC, 403: KEY_PARK_SEC, 429: RATE_PARK_SEC}

_ROT: dict = {"current": 0, "parked": {}}   # parked: {nama env: time.time() saat kunci boleh dipakai lagi}


def _env_file_values() -> dict[str, str]:
    out: dict[str, str] = {}
    for envfile in (ROOT / ".env", ROOT.parent / ".env"):
        for enc in ("utf-8-sig", "utf-16", "latin-1"):
            try:
                text = envfile.read_text(encoding=enc)
            except (UnicodeError, ValueError, FileNotFoundError):
                continue
            for line in text.splitlines():
                line = line.lstrip("﻿").strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    k = k.strip()
                    if k in KEY_NAMES and k not in out and v.strip():
                        out[k] = v.strip().strip('"').strip("'")
            break
    return out


def _keys() -> list[tuple[str, str]]:
    """[(nama env, kunci)] berurutan sesuai KEY_NAMES, tanpa kunci kosong atau ganda."""
    files = _env_file_values()
    seen, out = set(), []
    for name in KEY_NAMES:
        v = (os.environ.get(name) or files.get(name) or "").strip()
        if v and v not in seen:
            seen.add(v)
            out.append((name, v))
    return out


def _key() -> str | None:
    """Kunci pertama (kompatibel dengan pemanggil lama)."""
    ks = _keys()
    return ks[0][1] if ks else None


def cache_ttl_sec() -> int:
    try:
        return max(1, int(float(os.environ.get("NANSEN_CACHE_MIN") or DEFAULT_CACHE_MIN) * 60))
    except ValueError:
        return DEFAULT_CACHE_MIN * 60


def _store_load(ck: str):
    try:
        from firm import state_store
        return state_store.load(f"nansen:{ck}")
    except Exception:  # noqa: BLE001
        return None


def _store_save(ck: str, at: float, out: dict) -> None:
    try:
        from firm import state_store
        state_store.save(f"nansen:{ck}", {"at": at, "out": out})
    except Exception:  # noqa: BLE001
        pass


def _cached(ck: str, now: float) -> dict | None:
    """Hasil yang masih berlaku: memori dulu, lalu Supabase (hanya hasil sukses yang disimpan di sana)."""
    if ck in _CACHE:
        at, out = _CACHE[ck]
        if now - at < (cache_ttl_sec() if out.get("available") else FAIL_TTL_SEC):
            return out
    stored = _store_load(ck)
    if isinstance(stored, dict) and isinstance(stored.get("out"), dict) and stored["out"].get("available"):
        try:
            at = float(stored.get("at"))
        except (TypeError, ValueError):
            return None
        if 0 <= now - at < cache_ttl_sec():
            _CACHE[ck] = (at, stored["out"])
            return stored["out"]
    return None


def _order(n: int) -> list[int]:
    start = _ROT["current"] % n if n else 0
    return [(start + i) % n for i in range(n)]


def _request(key: str, body: dict) -> requests.Response:
    return requests.post(f"{BASE}/api/v1/smart-money/netflow",
                         headers={"apikey": key, "Content-Type": "application/json"}, json=body, timeout=30)


def _parse(r: requests.Response, chains: list[str], limit: int, slot: str) -> dict:
    cred = r.headers.get("X-Nansen-Credits-Remaining") or r.headers.get("xnansencreditsremaining")
    data = r.json().get("data", [])
    top = [{"sym": d.get("token_symbol"), "net24h_usd": round(d.get("net_flow_24h_usd", 0)),
            "net7d_usd": round(d.get("net_flow_7d_usd", 0)), "traders": d.get("trader_count")}
           for d in data[:limit]]
    net_total = sum(t["net24h_usd"] for t in top)
    read = ("smart money net-ACCUMULATING (risk-on)" if net_total > 0
            else "smart money net-DISTRIBUTING (risk-off)" if net_total < 0 else "neutral")
    return {"available": True, "credits_remaining": cred, "key_slot": slot, "chains": chains, "top": top,
            "net24h_total_usd": net_total, "read": read,
            "source": "Nansen smart-money netflow (funds + smart traders, DEX + CEX)"}


def smart_money_netflow(chains: list[str], limit: int = 6) -> dict:
    """Top tokens by smart-money 24h net flow on `chains`. CACHED (memory + Supabase) to save credits; rotates keys.
    Returns {available, credits_remaining, key_slot, top:[{sym,net24h_usd,net7d_usd,traders}], read}."""
    keys = _keys()
    if not keys:
        return {"available": False, "note": "no NANSEN_API_KEY"}
    ck = ",".join(sorted(chains))
    now = time.time()
    hit = _cached(ck, now)
    if hit is not None:
        return hit
    body = {"chains": chains, "pagination": {"page": 1, "per_page": limit},
            "order_by": [{"field": "net_flow_24h_usd", "direction": "DESC"}],
            "filters": {"include_native_tokens": True, "include_stablecoins": False}}
    n = len(keys)
    errors: list[str] = []
    out: dict | None = None
    for i in _order(n):
        name, key = keys[i]
        slot = f"key {i + 1}/{n}"
        if _ROT["parked"].get(name, 0) > now:
            errors.append(f"{slot} parked")
            continue
        try:
            r = _request(key, body)
        except Exception as e:  # noqa: BLE001 — jaringan: kunci lain tidak akan menolong
            out = {"available": False, "note": f"error {str(e)[:50]}"}
            break
        if r.ok:
            _ROT["current"] = i
            _ROT["parked"].pop(name, None)
            try:
                out = _parse(r, chains, limit, slot)
            except Exception as e:  # noqa: BLE001
                out = {"available": False, "note": f"bad response {str(e)[:50]}"}
            break
        park = _PARK_STATUS.get(r.status_code)
        errors.append(f"{slot} HTTP {r.status_code}: {r.text[:60]}")
        if park is None:   # 5xx dan lainnya: masalah server, bukan kunci
            out = {"available": False, "note": f"HTTP {r.status_code}: {r.text[:80]}"}
            break
        _ROT["parked"][name] = now + park
        print(f"   [nansen] {slot} ({name}) HTTP {r.status_code} -> diparkir {park // 60} menit, coba kunci berikutnya")
    if out is None:
        out = {"available": False, "note": f"all {n} Nansen keys unavailable — " + " | ".join(errors)[:240]}
    _CACHE[ck] = (now, out)
    if out.get("available"):
        _store_save(ck, now, out)
    return out
