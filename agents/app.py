"""app.py — HeliQuant always-on web service (Railway-deployable).

Runs the autonomous firm in a background loop (self-learning -> org analysis -> firm-governed execution)
and exposes endpoints to watch it live:
  GET /            dashboard (HTML) — loop status, validated edges, recent decisions
  GET /logs        RAW logs, plain text (sanitized — secret env values are redacted)
  GET /status      JSON status (loop alive, last cycle, edges)
  GET /decisions   JSON of recent firm decisions
  GET /health      "ok" (Railway healthcheck)

CONFIG (Railway env vars):
  ASSETS=BTC,ETH,...    comma-list to analyze each cycle (default BTC,ETH,SOL,HYPE,SUI,XRP,NEAR — the Bitget basket)
  INTERVAL_MIN=12       minutes between LLM org cycles (multi-key rotation lifts the old >=15 limit; floor is 5)
  EXECUTE=0             1 = place firm-sanctioned LIVE orders (Bitget); 0 = analyze-only (default, safe)
  REFRESH_DATA=1        1 = re-fetch fresh market data each cycle (needs Bitget public reachable)
  + all the firm's API keys (LLM/Groq, Nansen, Elfa, NearBlocks, Supabase, Bitget...) — copy from your .env.
  NEVER commit secrets; set them in Railway's Variables tab.
"""
from __future__ import annotations

import contextlib
import io
import json
import asyncio
import os
import threading
import time
import traceback
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

# Load any locally-stored credentials (agents-localReady SQLite) into env BEFORE config reads them.
# NO-CUSTODY: reads only THIS machine's data/credentials.db (written via /register); never overwrites an
# env var already set, so Railway / .env always take precedence.
with contextlib.suppress(Exception):
    from firm import creds_store as _creds_store

    _creds_store.apply_to_env()

# ── config ──
ASSETS = [a.strip().upper() for a in os.environ.get("ASSETS", "BTC,ETH,SOL,HYPE,SUI,XRP,NEAR").split(",") if a.strip()]
INTERVAL_MIN = max(int(os.environ.get("INTERVAL_MIN", "30")), 5)  # org-cycle gap. 30min (not 12) keeps the
#   Groq FREE-tier daily quota alive: a 4–24h-horizon firm doesn't need to re-reason every 12min, and ~12min
#   cadence burned ~1800 calls/day across the 10 keys -> daily exhaustion (429 on every model). The no-LLM
#   floor is UNAFFECTED (its own 4min open / 60s resolve cadence). Override via INTERVAL_MIN env if needed.
EXECUTE = os.environ.get("EXECUTE", "0").strip() in {"1", "true", "yes"}
REFRESH_DATA = os.environ.get("REFRESH_DATA", "1").strip() in {"1", "true", "yes"}
# Self-learning tiap siklus memakai --apply: edge naik/turun kelas berdasarkan bukti, lalu registri
# disalin ke Supabase `edges_hq`. SELF_LEARN_APPLY=0 kembali ke mode lapor saja (dry).
SELF_LEARN_APPLY = os.environ.get("SELF_LEARN_APPLY", "1").strip() in {"1", "true", "yes"}

# ── log buffer + secret sanitizer (the /logs endpoint is PUBLIC) ──
LOGS: deque[str] = deque(maxlen=4000)
_SECRETS = [v for k, v in os.environ.items()
            if any(s in k.upper() for s in ("KEY", "SECRET", "TOKEN", "PASSWORD", "PRIVATE", "MNEMONIC"))
            and isinstance(v, str) and len(v) >= 8]


def _sanitize(s: str) -> str:
    for sec in _SECRETS:
        s = s.replace(sec, "***REDACTED***")
    return s


def log(msg: str) -> None:
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}Z {msg}"
    LOGS.append(_sanitize(line))


class _LogWriter(io.TextIOBase):
    """Captures stdout from the verbose org/self-learning into the log buffer (sanitized)."""
    def write(self, s):  # noqa: D401
        for part in str(s).splitlines():
            if part.strip():
                LOGS.append(_sanitize(part))
        return len(s)


STATE: dict = {"started_utc": datetime.now(timezone.utc).isoformat(), "cycles": 0,
               "last_cycle_utc": None, "last_error": None, "decisions": deque(maxlen=50),
               "assets": ASSETS, "interval_min": INTERVAL_MIN, "execute": EXECUTE, "last_ingest": None,
               "last_cycle_epoch": 0.0}

# Bulletproof external-trigger lock: an uptime pinger hits /run-cycle every few min — that keeps the
# container warm AND drives cycles independently of the internal sleep-loop (which a sleeping/suspended
# host can freeze). The gap guard means frequent pings are cheap keep-alive no-ops; a real cycle only
# fires every MIN_CYCLE_GAP_S. Lock prevents overlapping cycles.
_cycle_lock = threading.Lock()
MIN_CYCLE_GAP_S = max(INTERVAL_MIN * 60 - 120, 300)  # ~the interval, minus slack; >=5min floor


def _refresh(asset: str) -> None:
    if not REFRESH_DATA:
        return
    try:
        import scripts  # noqa: F401  (ensure path)
    except Exception:  # noqa: BLE001
        pass
    try:
        # reuse the generalized collector for fresh positioning data
        import importlib
        sys_path = str(ROOT)
        import sys
        if sys_path not in sys.path:
            sys.path.insert(0, sys_path)
        coll = importlib.import_module("scripts.73_collect_alt") if (ROOT / "scripts" / "73_collect_alt.py").exists() else None
        if coll and hasattr(coll, "collect"):
            with contextlib.redirect_stdout(_LogWriter()):
                coll.collect(asset)
            _persist_positioning(asset)
    except Exception as e:  # noqa: BLE001
        log(f"  [refresh {asset}] skipped: {str(e)[:80]}")


def _persist_positioning(asset: str) -> None:
    """Simpan CSV positioning ke Supabase (`hq_state` pos:<aset>) supaya riwayat snapshot OI tidak hilang saat
    redeploy. Dipulihkan saat boot oleh _restore_positioning. Hanya kalau ada minimal satu bar OI."""
    try:
        fp = DATA / f"{asset.lower()}_positioning.csv"
        text = fp.read_text(encoding="utf-8")
        import pandas as pd
        n_oi = int(pd.read_csv(fp)["oi"].notna().sum())
        if n_oi == 0:
            return
        from firm import state_store
        state_store.save(f"pos:{asset.lower()}", text)
        log(f"  [persist] positioning {asset}: {n_oi} bar OI → Supabase")
    except Exception as e:  # noqa: BLE001
        log(f"  [persist {asset}] skipped: {str(e)[:80]}")


_MEMORY: dict = {"store": None}


def _record_decision(asset: str, dec: dict) -> None:
    """Simpan keputusan siklus ke Supabase `decisions_hq` (sama dengan scripts/52). Hanya kalau
    SUPABASE_URL + SUPABASE_KEY ada; tanpa itu dilewati (tidak menulis SQLite/vault lokal).
    Gagal menulis tidak menghentikan siklus."""
    try:
        from firm import memory_store as ms
        if not (ms._env("SUPABASE_URL") and ms._env("SUPABASE_KEY")):
            return
        if _MEMORY["store"] is None:
            _MEMORY["store"] = ms.SupabaseMemoryStore()
        try:
            from firm import organization as org
            regime = str(org._state(asset)[2] or "")
        except Exception:  # noqa: BLE001
            regime = ""
        rid = _MEMORY["store"].record_decision(datetime.now(timezone.utc).isoformat(), asset, regime, dec)
        log(f"  [memory] decisions_hq id={rid} ({asset} {dec.get('decision')})")
    except Exception as e:  # noqa: BLE001
        log(f"  [memory] decisions_hq skipped: {_sanitize(str(e))[:100]}")


def _learn_desks(asset: str, res: dict) -> None:
    """Forward desk-learning (firm/desk_performance.py), the same hook scripts/52 runs locally:
    score every desk stance whose 24h window has matured against the live mark, stash THIS cycle's
    stances to be scored later, and refresh the reliability weights when something resolved.
    Advisory only — gates never change. Guarded: learning never breaks the cycle."""
    try:
        from firm import desk_performance as dp
        from firm.campaign import live_prices
        marks = {str(k).upper(): float(v) for k, v in live_prices().items() if v}
        now = time.time()
        scored = dp.resolve_matured(marks, now)
        if marks.get(asset.upper()):
            stashed = dp.stash_pending(asset, marks[asset.upper()], res.get("analysts", {}), now)
            if stashed:
                log(f"  [learn] stashed {stashed} desk stance(s) on {asset} — scored in 24h")
        if scored:
            dp.compute_weights()
            log(f"  [learn] {scored} matured desk stance(s) scored -> desk weights refreshed")
    except Exception as e:  # noqa: BLE001
        log(f"  [learn] skipped: {str(e)[:100]}")


def _refresh_desk_weights() -> None:
    """On boot, rebuild desk_weights.json from the stored outcomes so it covers every desk in
    desk_performance.DESKS (the shipped file can predate newly added desks)."""
    try:
        from firm import desk_performance as dp
        dp.compute_weights()
        log(f"[learn] desk weights rebuilt for {len(dp.DESKS)} desks")
    except Exception as e:  # noqa: BLE001
        log(f"[learn] weight rebuild skipped: {str(e)[:100]}")


def cycle() -> None:
    import sys
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    log("================ CYCLE START ================")
    # 1) self-learning: re-validate edges on current data (graduate/demote on evidence)
    try:
        from importlib import import_module
        sl = import_module("scripts.60_self_learn")
        log("-- self-learning (re-validate edges) --")
        with contextlib.redirect_stdout(_LogWriter()):
            old_argv = sys.argv
            sys.argv = ["60_self_learn.py"] + (["--apply"] if SELF_LEARN_APPLY else [])
            try:
                sl.main()
            finally:
                sys.argv = old_argv
    except Exception as e:  # noqa: BLE001
        log(f"  [self-learn] error: {str(e)[:120]}")

    # 2) org analysis — ROTATE one asset per cycle (cuts LLM calls/cycle ~in half -> avoids Groq 429
    #    daily-quota burn; each asset still re-analyzed every len(ASSETS) cycles, fine for a 24h horizon).
    from firm.organization import run_organization
    rotated = [ASSETS[STATE["cycles"] % len(ASSETS)]] if ASSETS else []
    for asset in rotated:
        _refresh(asset)
        log(f"-- ORG analysis: {asset} --")
        try:
            with contextlib.redirect_stdout(_LogWriter()):
                res = run_organization(asset, verbose=True)
            dec = (res or {}).get("decision", {})
            d = str(dec.get("decision", "?")).upper()
            log(f"  >> PM: {d} {dec.get('direction','')} — {str(dec.get('reasoning') or dec.get('ticket_note') or '')[:160]}")
            STATE["decisions"].appendleft({"utc": datetime.now(timezone.utc).isoformat(), "asset": asset,
                                           "decision": d, "direction": dec.get("direction"),
                                           "reason": str(dec.get("reasoning") or dec.get("ticket_note") or "")[:240]})
            _record_decision(asset, dec)
            _learn_desks(asset, res or {})
            try:  # seal each desk's output on NEAR (core.record_output; gated by AGENT_ONCHAIN)
                from firm.agent_onchain import record_outputs
                recs = record_outputs(res.get("analysts", {}), asset, STATE["cycles"])
                if recs:
                    log(f"  [onchain] sealed {len(recs)} desk output(s) on NEAR · {recs[-1]['tx'][:14]}...")
            except Exception as e:  # noqa: BLE001
                log(f"  [onchain] seal skipped ({str(e)[:60]})")
            if EXECUTE and d == "ENTER" and str(dec.get("direction", "")).upper() == "LONG" \
                    and (dec.get("trade_ticket") or {}).get("valid"):
                log(f"  >> EXECUTE enabled + firm ENTER LONG -> (live order path)")
                # execution is intentionally conservative on cloud; wire scripts/83 here when venue reachable.
        except Exception as e:  # noqa: BLE001
            log(f"  [org {asset}] error: {str(e)[:140]}")
    log("================ CYCLE DONE ================")


def _do_cycle() -> bool:
    """Run ONE cycle under the lock (skips if one is already running). BOTH the internal loop and the
    external /run-cycle trigger go through here — so cycles never overlap. Returns True if it ran."""
    if not _cycle_lock.acquire(blocking=False):
        return False
    try:
        cycle()
        STATE["cycles"] += 1
        STATE["last_cycle_utc"] = datetime.now(timezone.utc).isoformat()
        STATE["last_cycle_epoch"] = time.time()
        STATE["last_error"] = None
    except Exception as e:  # noqa: BLE001
        STATE["last_error"] = str(e)[:200]
        log("CYCLE ERROR: " + _sanitize(traceback.format_exc()[-400:]))
    finally:
        _cycle_lock.release()
    return True


_campaign_last = 0.0   # last time NEW positions were opened
_resolve_last = 0.0    # last time matured positions were RESOLVED (closed)
_campaign_lock = threading.Lock()
CAMPAIGN_STEP_MIN = int(os.environ.get("CAMPAIGN_STEP_MIN", "4"))     # open NEW positions at most this often
RESOLVE_MIN_S = int(os.environ.get("CAMPAIGN_RESOLVE_S", "60"))        # but RESOLVE (close matured: near-TP/SL/trail) this often — snappy exits
CAMPAIGN_ON = os.environ.get("CAMPAIGN", "1") == "1"


def _campaign_step(open_new: bool = True) -> None:
    """One campaign step. open_new=True -> resolve matured + open new (the latter throttled to
    CAMPAIGN_STEP_MIN). open_new=False -> RESOLVE-ONLY (close matured positions only) so exits — the
    near-TP lock, trailing stop, SL/TP — fire within RESOLVE_MIN_S instead of waiting a whole open-cycle.
    Lock-guarded so concurrent callers (loop + FE-traffic kicks) never overlap. firm/campaign.py."""
    global _campaign_last, _resolve_last
    if not CAMPAIGN_ON or not _campaign_lock.acquire(blocking=False):
        return
    _resolve_last = time.time()
    if open_new:
        _campaign_last = time.time()
    try:
        from firm.campaign import step
        st = step(log=log, open_new=open_new)
        log(f"[campaign] {'step' if open_new else 'resolve'} · open {st.get('open_now')} · closed {st.get('closed')} "
            f"· net ${st.get('net_usd'):+.2f}")
    except Exception as e:  # noqa: BLE001
        log(f"[campaign] step error: {str(e)[:120]}")
    finally:
        _campaign_lock.release()


def _kick_campaign() -> None:
    """Opportunistic self-driver: any FE read of /campaign or /trades (and every keep-alive ping) advances
    the floor in the BACKGROUND. RESOLVE (close matured positions) fires every RESOLVE_MIN_S so exits stay
    snappy; OPENING new positions stays throttled to CAMPAIGN_STEP_MIN. Keeps advancing even when Railway
    suspends the internal loop. Non-blocking + lock-guarded -> cheap."""
    if not CAMPAIGN_ON:
        return
    now = time.time()
    do_open = now - _campaign_last >= CAMPAIGN_STEP_MIN * 60
    do_resolve = now - _resolve_last >= RESOLVE_MIN_S
    if do_open or do_resolve:
        threading.Thread(target=_campaign_step, args=(do_open,), daemon=True).start()


def _loop() -> None:
    log(f"HeliQuant loop starting: assets={ASSETS} interval={INTERVAL_MIN}min execute={EXECUTE} "
        f"campaign={'ON' if CAMPAIGN_ON else 'off'}")
    while True:
        if time.time() - STATE["last_cycle_epoch"] >= MIN_CYCLE_GAP_S:
            _do_cycle()
        _kick_campaign()   # resolve (close matured) every ~60s · open new every CAMPAIGN_STEP_MIN
        time.sleep(60)  # wake every minute; the gap guard + external /run-cycle decide when a cycle fires


app = FastAPI(title="HeliQuant")

# CORS: the dApp (DAPP_URL) fetches these endpoints from the BROWSER (cross-origin). All
# routes are public, read-only GETs with no cookies/auth, so allow any origin — without this the
# browser blocks the fetch and the FE shows "floor unreachable" even though the API is up.
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # POST is needed by the browser onboarding form (POST /register from the dApp origin). Every POST
    # endpoint authenticates itself (/register: NEP-413 owner signature, /ingest: Bearer INGEST_TOKEN), and
    # allow_origins="*" never sends cookies/credentials, so opening the method adds no new access.
    allow_methods=["GET", "HEAD", "OPTIONS", "POST"],
    allow_headers=["*"],
)


def _restore_positioning() -> None:
    """On boot, pull the latest positioning CSVs from Supabase (ephemeral FS loses the /ingest-fed ones on
    redeploy). Keeps the cloud on fresh data across redeploys — no manual re-feed needed."""
    try:
        from firm import state_store
        for a in ASSETS:
            csv = state_store.load(f"pos:{a.lower()}")
            if isinstance(csv, str) and len(csv) > 50:
                (DATA / f"{a.lower()}_positioning.csv").write_text(csv, encoding="utf-8")
                log(f"[restore] positioning {a} from Supabase ({csv.count(chr(10))} rows)")
    except Exception as e:  # noqa: BLE001
        log(f"[restore] skipped: {str(e)[:80]}")


# ── NEAR Agent Market (market.near.ai): pembeli menyewa firm per job, hasilnya satu keputusan ber-anchor ──
_MARKET: dict = {"worker": None}
MARKET_LOCK_WAIT_S = 900   # tunggu siklus org yang sedang jalan selesai, supaya dua analisis LLM tidak bertumpuk


def _market_analyze(ticker: str) -> dict:
    """Satu analisis firm untuk job Agent Market. Memakai kunci siklus yang sama dengan loop utama."""
    import sys
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    if not _cycle_lock.acquire(timeout=MARKET_LOCK_WAIT_S):
        raise RuntimeError("siklus org lain masih berjalan")
    try:
        _refresh(ticker)
        from firm.organization import run_organization
        with contextlib.redirect_stdout(_LogWriter()):
            return run_organization(ticker, verbose=True)
    finally:
        _cycle_lock.release()


def _market_decision(ticker: str, dec: dict, anchor: dict) -> None:
    STATE["decisions"].appendleft({"utc": datetime.now(timezone.utc).isoformat(), "asset": ticker,
                                   "decision": str(dec.get("decision", "?")).upper(), "direction": dec.get("direction"),
                                   "reason": str(dec.get("reasoning") or dec.get("ticket_note") or "")[:240],
                                   "source": "agent-market", "anchor_tx": anchor.get("tx_hash")})


def _start_market_worker() -> None:
    from firm import market_worker as mw
    if not mw.enabled():
        log("[market] worker mati (AGENT_MARKET_TOKEN kosong atau MARKET_WORKER=0)")
        return
    w = mw.Worker(analyze=_market_analyze, log=log, on_decision=_market_decision,
                  send_anchor=os.environ.get("AGENT_ONCHAIN", "1") != "0")
    _MARKET["worker"] = w
    threading.Thread(target=w.run_forever, daemon=True).start()


def _loop_enabled() -> bool:
    """Loop otomatis (siklus org tiap INTERVAL_MIN + kampanye). Bawaan nyala; AGENT_LOOP=0 mematikannya
    (dipakai selama pengembangan supaya kredit NEAR AI tidak terpakai). Dibaca dari env atau .env."""
    from firm.llm_client import _env
    return (_env("AGENT_LOOP") or "1").strip().lower() not in {"0", "false", "no", "off"}


@app.on_event("startup")
def _start():
    if os.environ.get("AGENT_ONCHAIN", "1") != "0":
        from firm import near_client as _nc
        _nc.guard_config()   # berhenti kalau NEAR_NETWORK bukan testnet atau NEAR_RPC_URL kosong (sebelum ada tanda tangan)
    _restore_positioning()   # restore positioning from Supabase before the loop runs
    threading.Thread(target=_refresh_desk_weights, daemon=True).start()   # off the boot path (network read)
    if _loop_enabled():
        threading.Thread(target=_loop, daemon=True).start()
    else:
        log("[loop] mati (AGENT_LOOP=0): tidak ada siklus otomatis. Siklus manual lewat /run-cycle, job Agent Market tetap jalan")
    _start_market_worker()


@app.get("/health")
def health():
    return PlainTextResponse("ok")


@app.get("/tee")
def tee_list(limit: int = 20):
    """Bukti TEE per siklus (NEAR AI Cloud): ringkasan terbaru dulu. Publik, hanya baca, tanpa kunci."""
    from firm import tee
    return JSONResponse({"model": os.environ.get("NEARAI_MODEL") or "Qwen/Qwen3.8-27B",
                         "cycles": tee.listing(limit)})


@app.get("/tee/{cycle_id}")
def tee_get(cycle_id: str):
    """Bundel bukti lengkap satu siklus. Verifikasi sendiri: `python scripts/verify_tee.py --url <agen>/tee/<cycle_id>`."""
    from firm import tee
    b = tee.get_bundle(cycle_id)
    if b is None:
        return JSONResponse({"error": "not_found", "cycle_id": cycle_id}, status_code=404)
    return JSONResponse(b)


@app.get("/health/onchain")
def health_onchain():
    """On-chain recording health: key allowance per desk/executor, key status (ok/low/exhausted), failed-record
    counts, free balance of the core contract, and locked jobs. /health itself stays a plain "ok"."""
    try:
        from firm import near_client as nc
        reg_fp = Path(__file__).resolve().parent / "data" / "agent_registry.json"
        reg = json.loads(reg_fp.read_text(encoding="utf-8")) if reg_fp.exists() else {}
        return JSONResponse(nc.health(reg))
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"rpc_ok": False, "error": _sanitize(str(e))[:160]}, status_code=200)


@app.api_route("/run-cycle", methods=["GET", "HEAD"])
def run_cycle():
    """Keep-alive + external cycle driver. Point an uptime pinger here (every few min). Accepts HEAD too —
    UptimeRobot & most monitors send HEAD by default (a GET-only route returns 405 and the ping is a no-op).
    Frequent pings are cheap no-ops (keep the host warm); a real cycle fires only when MIN_CYCLE_GAP_S has
    elapsed — robust even if the internal loop is frozen by a suspended host."""
    _kick_campaign()  # every keep-alive ping also advances the trading floor (guarded to <=1 step / CAMPAIGN_STEP_MIN)
    now = time.time()
    gap = now - STATE["last_cycle_epoch"]
    if gap < MIN_CYCLE_GAP_S:
        return JSONResponse({"status": "alive — next cycle not due yet", "cycles": STATE["cycles"],
                             "mins_to_next": round((MIN_CYCLE_GAP_S - gap) / 60, 1)})
    if _cycle_lock.locked():
        return JSONResponse({"status": "cycle already running", "cycles": STATE["cycles"]})
    threading.Thread(target=_do_cycle, daemon=True).start()
    return JSONResponse({"status": "cycle triggered", "cycles": STATE["cycles"]})


@app.get("/logs")
def logs(n: int = 400):
    return PlainTextResponse("\n".join(list(LOGS)[-n:]) or "(no logs yet — loop warming up)")


@app.get("/status")
def status():
    import json
    edges = {}
    try:
        edges = json.loads((DATA / "validated_edges.json").read_text())
    except Exception:  # noqa: BLE001
        pass
    try:
        from firm import tee
        spend = tee.spend()
    except Exception:  # noqa: BLE001
        spend = None
    return JSONResponse({"started_utc": STATE["started_utc"], "cycles": STATE["cycles"], "loop": _loop_enabled(),
                         "nearai_spend": spend,
                         "last_cycle_utc": STATE["last_cycle_utc"], "last_error": STATE["last_error"],
                         "assets": ASSETS, "interval_min": INTERVAL_MIN, "execute": EXECUTE,
                         "last_ingest": STATE.get("last_ingest"),
                         "validated_edges": edges, "log_lines": len(LOGS),
                         "market": dict(_MARKET["worker"].stats) if _MARKET["worker"] else None})


@app.get("/decisions")
def decisions():
    return JSONResponse(list(STATE["decisions"]))


@app.get("/campaign")
def campaign_status():
    """THE LIVE CAMPAIGN progress — 100 desk-justified paper positions at live prices. Each open
    position carries the desk votes that justified it (auditable bravery; PM real-capital gate
    untouched). Watch it fill: opened/closed/win%/net + the live book."""
    _kick_campaign()  # FE traffic self-drives the floor — advances even if the keep-alive pinger lapses
    try:
        from firm.campaign import status
        return JSONResponse(status())
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:120]}, status_code=500)


@app.get("/trades")
def trades(limit: int = 120):
    """THE TRADE LEDGER — every resolved campaign trade with its full data (entry/exit/PnL/exit-reason/
    desk-votes). Honest: these are paper trades at live prices (real fills on Bitget testnet when armed);
    the chain anchors the DECISIONS, not each paper fill."""
    _kick_campaign()  # FE traffic self-drives the floor — advances even if the keep-alive pinger lapses
    try:
        from firm.campaign import trade_log
        return JSONResponse(trade_log(limit))
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:120], "trades": []}, status_code=500)


@app.api_route("/campaign/rebaseline", methods=["GET", "POST"])
def campaign_rebaseline(token: str = ""):
    """OPS: reset the floor to a clean slate — the prior trades were under a superseded (broken-TP) config,
    so every asset is benched on losses that don't reflect the current logic. Discards that record and
    re-measures from zero. Token-gated. Do this ONCE after a config change, not to shop for a good run.
    Usage: /campaign/rebaseline?token=<INGEST_TOKEN>"""
    tok = os.environ.get("INGEST_TOKEN")
    if not tok or token != tok:
        return JSONResponse({"error": "bad or missing token — append ?token=<INGEST_TOKEN>"}, status_code=403)
    try:
        from firm.campaign import rebaseline
        r = rebaseline(log=log)
        _kick_campaign()
        return JSONResponse(r)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:160]}, status_code=500)


@app.api_route("/campaign/unstick", methods=["GET", "POST"])
def campaign_unstick(token: str = ""):
    """OPS: clear leftover cooldowns / condition-bans (e.g. set under an older, longer COOLDOWN_H) so the
    floor re-evaluates all assets next step. Record-based bench + the discipline gates stay. Token-gated.
    Usage: /campaign/unstick?token=<INGEST_TOKEN>"""
    tok = os.environ.get("INGEST_TOKEN")
    if not tok or token != tok:
        return JSONResponse({"error": "bad or missing token — append ?token=<INGEST_TOKEN>"}, status_code=403)
    try:
        from firm.campaign import clear_bans
        r = clear_bans(log=log)
        _kick_campaign()  # advance a step now so freed assets get re-evaluated immediately
        return JSONResponse(r)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:160]}, status_code=500)


@app.api_route("/campaign/test-open", methods=["GET", "POST"])
def campaign_test_open(asset: str = "SUI", side: str = "long", token: str = ""):
    """OPS/TEST: force-open ONE paper position now to verify the live mechanics (calibrated TP/SL, dynamic
    horizon, trailing) without waiting for an organic setup. Token-gated (INGEST_TOKEN). Counts in the
    ledger — use sparingly. Usage: /campaign/test-open?asset=SUI&token=<INGEST_TOKEN>"""
    tok = os.environ.get("INGEST_TOKEN")
    if not tok or token != tok:
        return JSONResponse({"error": "bad or missing token — append ?token=<INGEST_TOKEN>"}, status_code=403)
    try:
        from firm.campaign import test_open
        return JSONResponse(test_open(asset, side=side, log=log))
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:160]}, status_code=500)


_AGENTS_CACHE: dict = {}


def _agent_reps(reg: dict) -> dict:
    """Per-agent on-chain state read live from the core contract (cached ~120s): reputation (get_reputation) +
    credentials sealed (credential_count_for = how many desk outputs were recorded on-chain). Honest:
    reputation reads zero until jobs settle; credentials grow as the org seals each cycle's outputs."""
    hit = _AGENTS_CACHE.get("reps")
    if hit and time.time() - hit[0] < 120:
        return hit[1]
    out: dict = {}
    try:
        from firm import near_client as nc
        core = nc.core_id()
        ids = [reg.get("firm", {}).get("tokenId")] + [d.get("tokenId") for d in (reg.get("desks") or {}).values()]
        for tid in [i for i in ids if i is not None]:
            rec: dict = {"credentials": 0}
            try:
                rec["credentials"] = int(nc.view(core, "credential_count_for", {"token_id": str(tid)}))
            except Exception:  # noqa: BLE001
                pass
            try:
                r = nc.view(core, "get_reputation", {"token_id": str(tid)})
                pnl = int(r["cumulative_pnl"])
                rec.update({"total_jobs": int(r["total_jobs"]), "successful_jobs": int(r["successful_jobs"]),
                            "cum_pnl": pnl, "cum_pnl_usd": pnl / 1_000_000,
                            "win_rate_bps": nc.view(core, "win_rate_bps", {"token_id": str(tid)})})
            except Exception:  # noqa: BLE001
                pass
            out[str(tid)] = rec
    except Exception:  # noqa: BLE001
        pass
    _AGENTS_CACHE["reps"] = (time.time(), out)
    return out


@app.get("/agents")
def agents():
    """THE AGENT ROSTER — the firm + 12 desks as on-chain identities (NFT NEP-171 in the core contract). Each
    agent's tokenId, kind, ml flag, role + its live ON-CHAIN reputation and sealed-output count, plus the
    off-chain desk_performance reliability weight for cross-reference. Honest: reputation accrues forward."""
    try:
        reg_fp = Path(__file__).resolve().parent / "data" / "agent_registry.json"
        if not reg_fp.exists():
            return JSONResponse({"agents": [], "error": "agents not registered yet"})
        reg = json.loads(reg_fp.read_text(encoding="utf-8"))
        try:
            from firm.desk_performance import load_weights
            weights = load_weights()
        except Exception:  # noqa: BLE001
            weights = {}
        reps = _agent_reps(reg)
        from firm import near_client as nc
        firm = reg.get("firm", {})
        out = [{"name": "HeliQuant", "kind": "Firm", "tokenId": firm.get("tokenId"), "ml": False,
                "role": "autonomous multi-desk AI trading firm", "reputation": reps.get(str(firm.get("tokenId")))}]
        for name, d in (reg.get("desks") or {}).items():
            out.append({"name": name, "kind": d.get("kind"), "tokenId": d.get("tokenId"), "ml": d.get("ml", False),
                        "account": d.get("account"), "weight": weights.get(name),
                        "reputation": reps.get(str(d.get("tokenId")))})
        return JSONResponse({"agents": out, "network": reg.get("network", "testnet"), "core": reg.get("core"),
                             "explorer": nc.EXPLORER})
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"agents": [], "error": str(e)[:120]}, status_code=200)


@app.get("/desks")
def desks():
    """DESK RELIABILITY (strategic self-learning) — each of the 9 desks earns a weight 0.6-1.4 by
    track record (its stance vs realized direction, >=15 samples). Neutral 1.0 until a desk proves
    itself; OI-Contrarian is seeded from its OOS replay. Surfaced for the /learning Tuning Bay."""
    try:
        from firm import desk_performance as dp
        out = {"desks": dp.DESKS, "bounds": [dp.LO, dp.HI], "min_samples": dp.MIN_SAMPLES,
               "weights": dp.load_weights(), "detail": {}}
        if dp.WEIGHTS.exists():
            out["detail"] = json.loads(dp.WEIGHTS.read_text()).get("detail", {})
        return JSONResponse(out)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:120]}, status_code=500)


@app.get("/edges")
def edges():
    """THE EDGE REGISTRY (edge-discovery self-learning) — validated_edges GATE real aggression;
    candidate_edges are on PROBATION (passed cost-aware OOS + walk-forward but awaiting fresh-data
    confirmation before graduating). Honest: 0 validated right now — the firm hunts, never fakes one."""
    try:
        from firm.desk_performance import ROOT

        def _rd(name: str) -> dict:
            fp = ROOT / "data" / name
            try:
                return json.loads(fp.read_text()) if fp.exists() else {}
            except (ValueError, OSError):
                return {}

        validated, candidate = _rd("validated_edges.json"), _rd("candidate_edges.json")
        # last_run = the latest REAL probation-confirmation bar stored on a candidate (scripts/60 writes
        # last_confirm_bar on a genuine new-data run). The registry stores no run-wide timestamp, so if no
        # entry carries one, last_run is null — honest, never a fabricated/mtime-derived time.
        bars = [e["last_confirm_bar"] for e in {**validated, **candidate}.values()
                if isinstance(e, dict) and e.get("last_confirm_bar")]
        return JSONResponse({"validated": validated, "candidate": candidate,
                             "last_run": max(bars) if bars else None})
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:120]}, status_code=500)


@app.get("/performance")
def performance():
    """RIGOROUS analytics on the real trade ledger — Sharpe/Sortino/Calmar/maxDD/profit-factor, computed
    from resolved trades (return = pnl/size). quantstats-grade metrics, numpy-only (no deploy bloat).
    Honest: annualized figures are suppressed until the sample is meaningful (>=30d & >=30 trades) so a
    3-day high-frequency window can't extrapolate to a fantasy CAGR; per-trade stats always show."""
    _kick_campaign()
    try:
        from firm.campaign import trade_log
        from firm import perf_stats
        return JSONResponse(perf_stats.compute(trade_log(500).get("trades", [])))
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:120]}, status_code=500)


@app.get("/sentiment")
def sentiment():
    """FREE market-context feeds (keyless): crypto Fear & Greed (alternative.me) + BTC network backdrop
    (blockchain.com). CONTEXT, not edge — a slow contrarian mood gauge surfaced for the dashboard, never
    a hard trade gate. Fails soft (fields go null on a feed outage)."""
    try:
        from firm import sentiment_feeds
        return JSONResponse(sentiment_feeds.read())
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:120]}, status_code=500)


_ONCHAIN_CACHE: dict = {}   # account -> (epoch, payload). NearBlocks free tier is rate-limited; cache ~60s.
_ACCOUNT_RE = r"[a-z0-9][a-z0-9_.\-]{1,62}\.testnet|[0-9a-f]{64}"   # named testnet account or 64-hex implicit (custody wallet)


@app.get("/onchain")
def onchain(account: str = "", wallet: str = "", limit: int = 40):
    """THE ON-CHAIN LEDGER — recent transactions of the core contract (decision/trade anchors, desk outputs, job
    flow), fetched LIVE from NearBlocks API v3 (testnet). `anchor` seals a record's SHA-256 as a NEP-297 event —
    verifiable on testnet.nearblocks.io, not a claim. Pass ?account=<name>.testnet to inspect another account
    (only the most recent page is shown). Cached ~60s."""
    import re

    from firm import near_client as nc
    addr = (account or wallet).strip().lower() or nc.core_id()
    if not addr or not re.fullmatch(_ACCOUNT_RE, addr):
        return JSONResponse({"error": "bad account (expected <name>.testnet or a 64-hex implicit account)", "txs": []}, status_code=400)
    hit = _ONCHAIN_CACHE.get(addr)
    if hit and time.time() - hit[0] < 60:
        return JSONResponse(hit[1])
    try:
        rows = nc.nearblocks_txns(addr, per_page=max(1, min(limit, 100)))
        txs = []
        for t in rows[:max(1, min(limit, 100))]:
            methods = [a.get("method") for a in (t.get("actions") or []) if a.get("method")]
            txs.append({"hash": t.get("transaction_hash"), "ts": int(int(t.get("block_timestamp") or 0) / 1e9),
                        "block": int((t.get("block") or {}).get("block_height") or 0),
                        "from": t.get("signer_account_id", ""), "to": t.get("receiver_account_id", ""),
                        "method": methods[0] if methods else "",
                        "is_error": not (t.get("outcomes") or {}).get("status", True),
                        "self_anchor": "anchor" in methods,
                        "explorer": nc.tx_url(t.get("transaction_hash", ""))})
        payload = {"account": addr, "chain": "NEAR testnet", "network": nc.network(),
                   "explorer": nc.EXPLORER, "total": len(rows), "txs": txs}
        _ONCHAIN_CACHE[addr] = (time.time(), payload)
        return JSONResponse(payload)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"account": addr, "txs": [], "error": _sanitize(str(e))[:120]}, status_code=200)


_CANDLE_CACHE: dict = {}   # (asset,interval) -> (epoch, payload). Bitget mainnet kline (keyless).
_BG_GRAN = {"1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1H", "120": "2H",
            "240": "4H", "360": "6H", "720": "12H", "D": "1D", "1D": "1D", "W": "1W"}


@app.get("/candles")
def candles(asset: str = "BTC", interval: str = "60", limit: int = 120):
    """Recent OHLC candles for an asset (Bitget mainnet perp, keyless — served from the cloud so any
    viewer gets them regardless of their own geo). Cached ~45s. Feeds the live-floor candlestick that
    shows each open campaign position against its entry / SL / TP."""
    import requests
    key = (asset.upper(), interval)
    hit = _CANDLE_CACHE.get(key)
    if hit and time.time() - hit[0] < 45:
        return JSONResponse(hit[1])
    try:
        gran = _BG_GRAN.get(interval, "1H")
        r = requests.get("https://api.bitget.com/api/v2/mix/market/candles",
                         params={"symbol": f"{asset.upper()}USDT", "productType": "usdt-futures",
                                 "granularity": gran, "limit": str(min(max(limit, 10), 200))}, timeout=12).json()
        rows = r.get("data") or []  # Bitget returns oldest-first
        out = [{"t": int(x[0]), "o": float(x[1]), "h": float(x[2]), "l": float(x[3]), "c": float(x[4])} for x in rows]
        payload = {"asset": asset.upper(), "interval": interval, "candles": out}
        _CANDLE_CACHE[key] = (time.time(), payload)
        return JSONResponse(payload)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"asset": asset.upper(), "interval": interval, "candles": [], "error": str(e)[:120]})


@app.get("/carry")
def carry():
    """Current carry desk reads — delta-neutral funding carry per symbol, computed live from keyless
    Bitget mainnet funding (cloud-reachable; falls back to the scripts/88 cache on a feed hiccup)."""
    try:
        from firm.carry_signal import carry_brief, live_carry
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:120]}, status_code=500)
    out = {}
    asofs = []
    for s in ("HYPEUSDT", "SUIUSDT", "BTCUSDT", "ETHUSDT", "XRPUSDT"):
        c = live_carry(s)
        if c and c.get("asof"):
            asofs.append(c["asof"])
        out[s] = ({"carry_ann_pct": c.get("carry_ann_pct"), "crash_class": c.get("crash_class"),
                   "verdict": c.get("verdict"), "source": c.get("source", "live")} if c else None)
    # asof = real compute time (funding fetched live from Bitget this request), or the cache's stamp on
    # fallback. Most-recent across symbols, or null if none carry a timestamp yet — a null is honest; a
    # fabricated freshness time is not.
    return JSONResponse({"asof": max(asofs) if asofs else None, "carry": out,
                         "best_harvestable": carry_brief() or "none harvestable now (all thin/lumpy — honest skip)"})


@app.get("/whales")
def whales():
    """THE WHALE DESK — what Hyperliquid's top-30 traders (by 30d PnL) are DOING right now in each
    HL-covered asset: net long vs short, notional, avg ROE, stance. Live positions (clearinghouse +
    leaderboard, cached internally), reachable from Railway. NEAR is NOT used on Hyperliquid here -> excluded.
    Honest: HL is ONE venue; on a read error an asset returns a neutral empty shape, never a guess."""
    from firm.hl_whales import whale_read, whale_detail
    assets = []
    for a in ("BTC", "ETH", "SOL", "HYPE", "SUI"):
        try:
            r = whale_read(a, n=30)
            r["whales"] = whale_detail(a, n=30)  # the individual wallets, clickable on the page
            assets.append(r)
        except Exception:  # noqa: BLE001  -> honest empty shape, never fabricated data
            assets.append({"asset": a, "whales_in_position": 0, "long": 0, "short": 0, "long_usd": 0,
                           "short_usd": 0, "net_usd": 0, "avg_roe_pct": None, "stance": "NEUTRAL",
                           "n_tracked": 0, "brief": f"{a}: whale read unavailable", "whales": []})
    return JSONResponse({"asof": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                         "source": "Hyperliquid top-30 by 30d PnL — live positions", "assets": assets})


@app.get("/probe")
def probe():
    """Test which exchange/data hosts are reachable FROM RAILWAY's IP (answers: can HeliQuant fetch Bitget here?)."""
    import requests
    targets = {
        "bitget_mainnet": ("GET", "https://api.bitget.com/api/v2/public/time", None),
        "bitget_mix": ("GET", "https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=usdt-futures", None),
        "hyperliquid": ("POST", "https://api.hyperliquid.xyz/info", {"type": "meta"}),
        "groq": ("GET", "https://api.groq.com/openai/v1/models", None),
    }
    out = {}
    for name, (method, url, body) in targets.items():
        try:
            t = time.time()
            r = requests.post(url, json=body, timeout=12) if method == "POST" else requests.get(url, timeout=12)
            try:
                r.json(); json_ok = True
            except Exception:  # noqa: BLE001
                json_ok = False
            # ANY HTTP response = the host was REACHED. A 401/403 here just means this probe sent no API
            # key (it tests reachability, not auth) — it does NOT mean the firm's real keys are bad.
            out[name] = {"status": r.status_code, "reachable": True,
                         "note": "reachable (auth not tested — 401/403 here is expected, probe sends no key)"
                                 if r.status_code in (401, 403) else "reachable",
                         "ms": int((time.time() - t) * 1000), "json_ok": json_ok, "snippet": _sanitize(r.text[:70])}
        except Exception as e:  # noqa: BLE001
            out[name] = {"reachable": False, "error": f"{type(e).__name__}: {str(e)[:90]}"}
    return JSONResponse(out)


@app.get("/bitget-probe")
def bitget_probe(order: int = 0, token: str = ""):
    """Can HeliQuant place Bitget DEMO orders FROM THIS REGION? Runs SIGNED private calls on API v3 with the
    `paptrading: 1` header (balance + account settings) — unlike /probe (reachability only), this answers
    whether orders are geo-ALLOWED here. Reads `bitget.connected` / `bitget.uta`, and records region + egress IP.
    ?order=1 → DECISIVE test: open+close a tiny NEAR demo LONG then SHORT from THIS region.
    ?order=1 places demo orders, so it needs ?token=<INGEST_TOKEN> (403 without it)."""
    import os
    import requests
    if order:
        tok = os.environ.get("INGEST_TOKEN")
        if not tok or token != tok:
            return JSONResponse({"error": "order=1 places demo orders — append ?token=<INGEST_TOKEN>"}, status_code=403)
    region = (os.environ.get("RAILWAY_REGION") or os.environ.get("RAILWAY_REPLICA_REGION")
              or os.environ.get("FLY_REGION") or os.environ.get("REGION") or "unknown")
    out = {"region": region, "api": "v3", "header": "paptrading: 1"}
    try:
        out["egress_ip"] = requests.get("https://api.ipify.org", timeout=8).text.strip()
    except Exception:  # noqa: BLE001
        out["egress_ip"] = None
    try:
        from firm import bitget_adapter as bg
        out["bitget"] = bg.status()  # signed private get-balance → connected:true iff account reachable here
        if order:
            res: dict = {}
            try:
                bg.set_position_mode(True)
                qty = bg.round_size("NEAR", 10, bg.get_ticker("NEAR"))
                for label, side in (("long", "buy"), ("short", "sell")):
                    bg.place_market_order("NEAR", side, qty)
                    time.sleep(1.0)
                    pos = bg.get_positions()
                    res[label] = {"opened": (pos[0].get("holdSide") if pos else None) == label,
                                  "holdSide": pos[0].get("holdSide") if pos else None, "qty": qty}
                    bg.flatten()
                    time.sleep(0.8)
                both = res.get("long", {}).get("opened") and res.get("short", {}).get("opened")
                out["order_test"] = {**res, "verdict": "LONG + SHORT WORK FROM THIS REGION" if both else "partial — check holdSide"}
            except Exception as e:  # noqa: BLE001
                out["order_test"] = {**res, "verdict": "ORDER BLOCKED/FAILED HERE", "error": str(e)[:200]}
    except Exception as e:  # noqa: BLE001
        out["bitget"] = {"error": str(e)[:200]}
    return JSONResponse(out)


@app.get("/bitget-data")
def bitget_data(asset: str = "BTC", candles: int = 0):
    """Public Bitget MAINNET market data (keyless) — funding, open-interest, last, 24h vol; optional 1H
    candles (?asset=BTC&candles=50). A keyless read of the firm's own execution venue."""
    try:
        from firm import bitget_adapter as bg
        out: dict = {"snapshot": bg.market_snapshot(asset)}
        if candles:
            out["candles"] = bg.public_candles(asset, "1H", min(int(candles), 200))
        return JSONResponse(out)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:160]}, status_code=200)


@app.get("/bitget-crowd")
def bitget_crowd():
    """Bitget aggregate CROWD positioning per basket asset (keyless) — retail long/short account ratio,
    position ratio, open interest. The crowd, to set against the Hyperliquid smart-money whales."""
    try:
        from firm import bitget_adapter as bg
        try:
            from firm.campaign import BASKET
        except Exception:  # noqa: BLE001
            BASKET = ["BTC", "ETH", "SOL", "HYPE", "SUI", "XRP", "NEAR"]
        rows = []
        for a in BASKET:
            try:
                rows.append(bg.crowd_positioning(a))
            except Exception:  # noqa: BLE001
                pass
        return JSONResponse({"asof": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                             "source": "Bitget mainnet (keyless) — aggregate crowd, not individual whales",
                             "assets": rows})
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)[:160]}, status_code=200)


@app.get("/setup-status")
def setup_status():
    """Onboarding status — which credential KEY NAMES this engine has on file (never values) + whether
    /register is enabled (HQ_OWNER_ACCOUNT set) and who the owner is. The onboarding form reads this."""
    from firm import creds_store, nep413
    owner = nep413.owner_account()
    return JSONResponse({"register_enabled": bool(owner), "auth": "nep413", "owner": owner or None,
                         "recipient": nep413.RECIPIENT, "stored_keys": creds_store.stored_keys()})


@app.get("/register/nonce")
def register_nonce():
    """One-time nonce (32 bytes, base64, 5 min) for the NEP-413 register signature."""
    from firm import nep413
    owner = nep413.owner_account()
    if not owner:
        return JSONResponse({"error": "register disabled — set HQ_OWNER_ACCOUNT on the engine to enable onboarding"}, status_code=503)
    return JSONResponse({"nonce": nep413.issue_nonce(), "recipient": nep413.RECIPIENT, "owner": owner,
                         "ttl_sec": nep413.NONCE_TTL_SEC})


@app.post("/register")
async def register(req: Request):
    """NO-CUSTODY onboarding (agents-localReady). The user's OWN onboarding form POSTs their keys to THEIR
    OWN engine (this process) over their tunnel — the secrets never touch the shared FE server. Stored in
    this engine's local SQLite + applied to the running process.
    Auth: NEP-413 signature by HQ_OWNER_ACCOUNT's full-access key over a message that carries the sha256 of
    the creds, with a nonce from GET /register/nonce (firm/nep413.py). No owner set -> 503 (Railway: always).
    Body: {"auth": {"account_id", "public_key", "signature", "nonce"}, "creds": {"GROQ_API_KEY": "...", ...}}."""
    from firm import creds_store, nep413
    owner = nep413.owner_account()
    if not owner:
        return JSONResponse({"error": "register disabled — set HQ_OWNER_ACCOUNT on the engine to enable onboarding"}, status_code=503)
    try:
        body = await req.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "bad json"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "body must be an object"}, status_code=400)
    creds = body.get("creds")
    if not isinstance(creds, dict) or not creds:
        return JSONResponse({"error": "creds must be a non-empty object"}, status_code=400)
    if not all(isinstance(k, str) and isinstance(v, str) for k, v in creds.items()):
        return JSONResponse({"error": "creds keys and values must be strings"}, status_code=400)
    try:
        account = await asyncio.to_thread(nep413.verify_register, body.get("auth"), creds, owner)
    except nep413.AuthError as e:
        return JSONResponse({"error": str(e)}, status_code=e.status)
    log(f"[register] {account} stored {len(creds)} credential(s) (NEP-413 verified)")
    n = creds_store.save_creds(creds)
    creds_store.apply_to_env()
    return JSONResponse({"ok": True, "saved": n, "keys": creds_store.stored_keys(),
                         "note": "stored in this engine's local SQLite + applied to the running process"})


@app.post("/ingest")
async def ingest(req: Request):
    """CONNECTOR: the local engine POSTs supplementary data here (carry, positioning) so the cloud brain
    has it even when a particular feed is thin. Auth: Bearer INGEST_TOKEN (set in Railway).
    Body: {"asset": "BTC", "csv": "<full positioning csv text>"} or a carry payload."""
    token = os.environ.get("INGEST_TOKEN")
    if not token:
        return JSONResponse({"error": "ingest disabled — set INGEST_TOKEN in Railway to enable"}, status_code=503)
    if req.headers.get("authorization", "") != f"Bearer {token}":
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        body = await req.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "bad json"}, status_code=400)
    asset = str(body.get("asset", "")).upper()
    if not asset:
        return JSONResponse({"error": "need asset"}, status_code=400)
    # CARRY payload: a fallback path — the cloud now computes carry live from Bitget directly, but the
    # local engine can still push a precomputed result here in case the live fetch is thin.
    carry = body.get("carry")
    if isinstance(carry, dict):
        try:
            (DATA / f"{asset.lower()}_carry.json").write_text(json.dumps(carry), encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            return JSONResponse({"error": f"carry write failed: {str(e)[:80]}"}, status_code=500)
        log(f"[ingest] received {asset} carry: {carry.get('carry_ann_pct')}%/yr ({str(carry.get('verdict',''))[:40]})")
        return JSONResponse({"ok": True, "asset": asset, "carry_ann_pct": carry.get("carry_ann_pct")})
    # POSITIONING csv payload (default)
    csv_text = body.get("csv")
    if not isinstance(csv_text, str) or len(csv_text) < 50:
        return JSONResponse({"error": "need asset + csv (positioning) OR carry (dict)"}, status_code=400)
    try:
        (DATA / f"{asset.lower()}_positioning.csv").write_text(csv_text, encoding="utf-8")
        from firm import state_store
        state_store.save(f"pos:{asset.lower()}", csv_text)   # persist -> survives redeploys (restored on boot)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"write failed: {str(e)[:80]}"}, status_code=500)
    rows = csv_text.count("\n")
    last = csv_text.strip().splitlines()[-1].split(",")[1] if "\n" in csv_text else "?"
    STATE["last_ingest"] = {"asset": asset, "rows": rows, "last_bar": last,
                            "utc": datetime.now(timezone.utc).isoformat()}
    log(f"[ingest] received {asset}: {rows} rows, last bar {last} (from local engine)")
    return JSONResponse({"ok": True, "asset": asset, "rows": rows, "last_bar": last})


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    """Local control panel — what a user sees at their engine's localhost:8000 (and at their tunnel URL).
    Confirms the engine is running, auto-detects the URL to register, and walks the connect-to-dApp steps."""
    import os as _os
    last = STATE["last_cycle_utc"] or "warming up"
    owner = _os.environ.get("HQ_OWNER_ACCOUNT", "").strip()
    armed = bool(owner)
    bitget_armed = _os.environ.get("BITGET_EXECUTE", "0").strip().lower() in {"1", "true", "yes"}
    try:
        from firm import creds_store
        keys = creds_store.stored_keys()
    except Exception:  # noqa: BLE001
        keys = []
    dapp = _os.environ.get("DAPP_URL", "").rstrip("/")
    my_url = str(request.base_url).rstrip("/")
    is_local = "localhost" in my_url or "127.0.0.1" in my_url or my_url.endswith(":8000")
    url_note = ("⚠ this is a LOCAL address — expose it with a tunnel (ngrok) and register the public URL"
                if is_local else "✓ public URL — paste THIS on the dApp to register")
    url_color = "#ff5a1f" if is_local else "#1ce5cf"
    decs = "".join(
        f"<tr><td>{d['utc'][11:19]}</td><td>{d['asset']}</td>"
        f"<td><b style='color:#c9f24b'>{d['decision']}</b> {d.get('direction') or ''}</td>"
        f"<td style='color:#8b8b80'>{(d.get('reason') or '')[:110]}</td></tr>"
        for d in list(STATE['decisions'])[:12])

    def pill(ok: bool, yes: str, no: str) -> str:
        c = "#c9f24b" if ok else "#8b8b80"
        return f"<b style='color:{c}'>{yes if ok else no}</b>"

    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HeliQuant — your local engine</title><style>
*{{box-sizing:border-box}}body{{font:14px ui-monospace,Menlo,monospace;background:#0b0b0b;color:#f2efe6;margin:0;padding:28px;max-width:980px;margin:0 auto}}
a{{color:#1ce5cf;text-decoration:none}}a:hover{{text-decoration:underline}}h2{{margin:0;font-size:26px;letter-spacing:.5px}}
.dot{{display:inline-block;width:10px;height:10px;border-radius:50%;background:#c9f24b;box-shadow:0 0 10px #c9f24b;animation:p 1.4s infinite}}
@keyframes p{{50%{{opacity:.3}}}}.card{{border:2px solid #2a2a26;background:#161614;padding:14px 16px;margin-top:14px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:#2a2a26;border:2px solid #2a2a26;margin-top:16px}}
.cell{{background:#161614;padding:12px 14px}}.k{{color:#8b8b80;font-size:10px;text-transform:uppercase;letter-spacing:1.5px}}
.v{{font-size:22px;font-weight:800;margin-top:3px}}.urlbox{{border:2px solid {url_color};background:#161614;padding:14px 16px;margin-top:16px;word-break:break-all}}
.steps li{{margin:7px 0;line-height:1.5}}code{{background:#0b0b0b;border:1px solid #2a2a26;padding:1px 6px;color:#c9f24b}}
table{{border-collapse:collapse;width:100%;margin-top:10px;font-size:12px}}td,th{{border:1px solid #222;padding:4px 8px;text-align:left}}
th{{color:#8b8b80;font-weight:600;text-transform:uppercase;font-size:10px}}.muted{{color:#8b8b80}}</style></head>
<body>
<h2><span class="dot"></span> HeliQuant · your engine is <span style="color:#c9f24b">RUNNING</span></h2>
<p class="muted">an autonomous multi-desk AI trading firm, running on your machine — your keys, no custody.</p>

<div class="urlbox"><div class="k">your engine URL</div>
<div style="font-size:18px;color:{url_color};margin-top:4px">{my_url}</div>
<div class="muted" style="margin-top:4px">{url_note}</div></div>

<div class="grid">
<div class="cell"><div class="k">cycles run</div><div class="v">{STATE['cycles']}</div></div>
<div class="cell"><div class="k">last cycle</div><div class="v" style="font-size:13px">{last}</div></div>
<div class="cell"><div class="k">assets</div><div class="v" style="font-size:13px">{','.join(ASSETS)}</div></div>
<div class="cell"><div class="k">register endpoint</div><div class="v" style="font-size:16px">{pill(armed,'ARMED · '+owner,'OFF — set HQ_OWNER_ACCOUNT')}</div></div>
<div class="cell"><div class="k">credentials on file</div><div class="v" style="font-size:16px">{pill(bool(keys), str(len(keys))+' keys', 'none yet')}</div></div>
<div class="cell"><div class="k">Bitget execution</div><div class="v" style="font-size:16px">{pill(bitget_armed,'ARMED (demo)','paper')}</div></div>
</div>

<div class="card"><b style="color:#c9f24b">▸ Connect this engine to the dApp</b>
<ol class="steps">
<li><b>Expose it</b> with a tunnel: <code>ngrok http 8000</code> → copy the <code>https://…ngrok-free.app</code> URL{(' (or just use the URL above)' if not is_local else '')}.</li>
<li><b>Open the dApp</b> → <a href="{dapp}/onboarding">Register your engine →</a></li>
<li><b>Connect your NEAR wallet</b> (the account in <code>HQ_OWNER_ACCOUNT</code>), paste your engine URL + your keys (Groq, Bitget…) → <b>Register</b> and sign the NEP-413 message. Only the owner's full-access key is accepted. The keys POST straight here, land in this engine's local SQLite — they never touch the hosted site.</li>
</ol>
<div class="muted" style="margin-top:6px">Next time: use <b>"Already set up → connect"</b> on the dApp to reconnect — your keys are already saved in this engine's SQLite, so you never re-enter them.</div></div>

<h3 style="margin-top:24px">recent firm decisions</h3>
<table><tr><th>utc</th><th>asset</th><th>decision</th><th>why</th></tr>{decs or '<tr><td colspan=4 class="muted">warming up… first cycle within a few minutes</td></tr>'}</table>
<p class="muted" style="margin-top:10px">Disciplined by design — it ABSTAINS far more than it trades. Few trades = the gates working, not a bug.</p>
<p class="muted" style="font-size:12px">live: <a href="/logs">/logs</a> · <a href="/status">/status</a> · <a href="/decisions">/decisions</a> · <a href="/campaign">/campaign</a> · <a href="/bitget-crowd">/bitget-crowd</a> · <a href="/setup-status">/setup-status</a></p>
</body></html>"""
