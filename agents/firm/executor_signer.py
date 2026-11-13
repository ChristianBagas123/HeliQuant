"""Penanda tangan akun executor: kunci terbatas (mode `key`) atau OutLayer Agent Custody (mode `custody`).

Mode dipilih lewat env `EXECUTOR_MODE` (bawaan `key`, perilaku lama). Di mode `custody` agen TIDAK memegang kunci
executor: transaksi ditandatangani di TEE OutLayer dengan aturan pengeluaran (policy) milik pemilik. Layanan masih
alpha, jadi jalur rollback ke mode `key` wajib ada (agents/DEPLOY.md).

    call(method, args, gas_tgas=None) -> {ok, tx_hash, error, explorer, latency_ms, ...}   tidak pernah melempar
    account() / configured() / status()

Hanya method `anchor`, `trade`, `recover_job`, `reconcile_job` yang diterima.
Sumber: https://app.outlayer.ai/docs/agent-custody dan https://testnet-api.outlayer.ai/openapi.json
"""
from __future__ import annotations

import threading
import time

import requests

from firm import near_client as nc

ALLOWED = ("anchor", "trade", "recover_job", "reconcile_job")
DEFAULT_API = "https://testnet-api.outlayer.ai"
# Satuan field `gas` di POST /wallet/v1/call. OpenAPI menulis "TGas" tetapi bawaannya 30000000000000 (satuan gas).
# TERUJI 2026-11-10 dengan wallet sungguhan: gas="5000000000000" -> gas prepaid on-chain 5000000000000 (5 TGas),
# jadi satuannya "gas" (bukan "tgas"). Tx 957KoNFAfXpiKhK2pZm5LGRZzUxPtpNT3yYnYM4jB7k8.
OUTLAYER_GAS_UNIT = "gas"
POLL_EVERY_S, POLL_MAX_S = 2.0, 60.0
RETRIES_5XX = 2
LOW_NEAR, EXHAUSTED_NEAR = 0.3, 0.05
OK_STATUS = {"success", "completed"}
WAIT_STATUS = {"processing", "pending_deposit", "approved"}

_LOCK = threading.Lock()   # batas per jam OutLayer best-effort saat request bersamaan -> kirim berurutan


# ───────────────────────── konfigurasi ─────────────────────────
def mode() -> str:
    m = (nc._env("EXECUTOR_MODE") or "key").strip().lower()
    return m if m in ("key", "custody") else "key"


def _api() -> str:
    return (nc._env("OUTLAYER_API_BASE") or DEFAULT_API).rstrip("/")


def account() -> str | None:
    """Akun NEAR executor untuk pesan dan `from_account`."""
    if mode() == "custody":
        return nc._env("OUTLAYER_WALLET_ACCOUNT")
    explicit = nc._env("NEAR_EXECUTOR_ACCOUNT")
    parent = nc._env("NEAR_PARENT_ACCOUNT")
    return explicit or (f"executor.{parent}" if parent else None)


def configured() -> bool:
    if mode() == "custody":
        return bool(nc._env("OUTLAYER_API_KEY") and nc._env("OUTLAYER_WALLET_ACCOUNT"))
    return bool(nc._env("NEAR_EXECUTOR_PRIVATE_KEY") and account())


def missing_hint() -> str:
    if mode() == "custody":
        return "set OUTLAYER_API_KEY, OUTLAYER_WALLET_ACCOUNT, NEAR_CORE_CONTRACT_ID"
    return "set NEAR_EXECUTOR_PRIVATE_KEY, NEAR_PARENT_ACCOUNT, NEAR_CORE_CONTRACT_ID"


def _scrub(text) -> str:
    text = nc.redact(text)
    k = nc._env("OUTLAYER_API_KEY")
    return text.replace(k, "<disaring>") if k else text


def _fail(r: dict, error: str, t0: float, **extra) -> dict:
    r["ok"], r["error"] = False, _scrub(error)[:400]
    r["latency_ms"] = int((time.time() - t0) * 1000)
    r.update(extra)
    return r


def _gas_param(tgas: float) -> str:
    return str(int(tgas)) if OUTLAYER_GAS_UNIT == "tgas" else str(int(tgas * 10**12))


# ───────────────────────── panggilan ─────────────────────────
def call(method: str, args: dict, gas_tgas: float | None = None, *, timeout: float = 60) -> dict:
    """Satu panggilan kontrak `core` sebagai executor. Tidak pernah melempar. `nc.note_result("executor", ok)` dicatat."""
    r = nc._new_result()
    t0 = time.time()
    if method not in ALLOWED:
        return _fail(r, f"method {method} tidak diizinkan untuk executor (hanya {', '.join(ALLOWED)})", t0)
    try:
        if mode() == "custody":
            out = _custody_call(r, method, args, gas_tgas, timeout, t0)
        else:
            out = _key_call(r, method, args, gas_tgas, timeout, t0)
    except BaseException as e:  # noqa: BLE001
        out = _fail(r, f"{type(e).__name__}: {str(e)[:300]}", t0)
    nc.note_result("executor", bool(out["ok"]))
    return out


def _key_call(r: dict, method, args, gas_tgas, timeout, t0) -> dict:
    key, acct, core = nc._env("NEAR_EXECUTOR_PRIVATE_KEY"), account(), nc.core_id()
    if not (key and acct and core):
        return _fail(r, missing_hint(), t0)
    return nc.send_sync(acct, key, core, method, args, gas_tgas, timeout=timeout)


def _headers() -> dict:
    return {"Authorization": f"Bearer {nc._env('OUTLAYER_API_KEY')}", "Content-Type": "application/json"}


def _err_of(resp: requests.Response) -> tuple[str, dict]:
    try:
        j = resp.json()
    except ValueError:
        return resp.text[:200], {}
    if not isinstance(j, dict):
        return str(j)[:200], {}
    err = j.get("error")
    msg = err if isinstance(err, str) else (err or {}).get("code") or (err or {}).get("message") or ""
    return str(msg or j.get("message") or resp.text[:200]), j


def _custody_call(r: dict, method, args, gas_tgas, timeout, t0) -> dict:
    if not (nc._env("OUTLAYER_API_KEY") and nc.core_id()):
        return _fail(r, missing_hint(), t0)
    tgas = gas_tgas if gas_tgas is not None else nc.GAS_TGAS[method]
    body = {"receiver_id": nc.core_id(), "method_name": method, "args": args, "gas": _gas_param(tgas), "deposit": "0"}
    with _LOCK:
        resp, last = None, "tidak ada percobaan"
        for attempt in range(RETRIES_5XX + 1):
            try:
                resp = requests.post(f"{_api()}/wallet/v1/call", json=body, headers=_headers(), timeout=timeout)
            except requests.RequestException as e:
                last, resp = f"jaringan: {type(e).__name__}", None
            else:
                if resp.status_code < 500:
                    break
                last = f"HTTP {resp.status_code}"
            if attempt < RETRIES_5XX:
                time.sleep(1.0)
        if resp is None or resp.status_code >= 500:
            return _fail(r, f"outlayer tidak terjangkau ({last})", t0)
        if resp.status_code == 429:
            return _fail(r, "rate_limited", t0, retry_after=resp.headers.get("Retry-After"))
        if resp.status_code == 403:
            return _fail(r, "policy_denied: " + _err_of(resp)[0], t0)
        if resp.status_code >= 400:
            msg, j = _err_of(resp)
            return _fail(r, msg or f"HTTP {resp.status_code}", t0, tx_hash=j.get("tx_hash"),
                         explorer=nc.tx_url(j["tx_hash"]) if j.get("tx_hash") else None)
        return _finish(r, resp.json(), t0, timeout)


def _finish(r: dict, j: dict, t0: float, timeout: float) -> dict:
    """Tangani respons 200: poll kalau masih diproses, lalu bentuk hasil."""
    rid, status, deadline = j.get("request_id"), str(j.get("status") or ""), time.time() + POLL_MAX_S
    while status in WAIT_STATUS and rid and time.time() < deadline:
        time.sleep(POLL_EVERY_S)
        try:
            p = requests.get(f"{_api()}/wallet/v1/requests/{rid}", headers=_headers(), timeout=timeout)
            if p.status_code == 200:
                j = {**j, **p.json()}
                status = str(j.get("status") or "")
        except requests.RequestException:
            continue
    tx = j.get("tx_hash")
    extra = {"request_id": rid, "status": status, "tx_hash": tx, "explorer": nc.tx_url(tx) if tx else None}
    if status in OK_STATUS and tx:
        r.update(extra, ok=True, value=j.get("result"), latency_ms=int((time.time() - t0) * 1000))
        return r
    if status == "pending_approval":
        return _fail(r, "pending_approval", t0, **extra)
    if status in WAIT_STATUS:
        return _fail(r, f"timeout menunggu status ({status})", t0, **extra)
    res = j.get("result")
    detail = res.get("error") if isinstance(res, dict) else ""
    return _fail(r, f"{status or 'status kosong'}{(': ' + str(detail)) if detail else ''}", t0, **extra)


# ───────────────────────── status untuk /health/onchain ─────────────────────────
def status() -> dict | None:
    """Baris executor untuk /health/onchain di mode custody. None di mode `key` (ditangani near_client.health)."""
    if mode() != "custody":
        return None
    acct = account()
    row = {"role": "executor", "name": "executor", "mode": "custody", "account": acct, "balance_near": None,
           "policy": None, "frozen": None, "status": "ok", "failed": 0, "last_ok_at": ""}
    with nc._HEALTH_LOCK:
        row["failed"], row["last_ok_at"] = nc.FAILS.get("executor", 0), nc.LAST_OK.get("executor", "")
    if not nc._env("OUTLAYER_API_KEY"):
        row["status"] = "missing"
        return row
    try:
        b = requests.get(f"{_api()}/wallet/v1/balance", params={"chain": "near"}, headers=_headers(), timeout=15)
        if b.status_code == 200:
            row["balance_near"] = f"{int(b.json()['balance']) / nc.YOCTO:.4f}"
        p = requests.get(f"{_api()}/wallet/v1/policy", headers=_headers(), timeout=15)
        if p.status_code == 200:
            row["policy"], row["frozen"] = p.json().get("policy"), bool(p.json().get("frozen"))
    except Exception:  # noqa: BLE001
        row["status"] = "unreachable"
        return row
    bal = float(row["balance_near"]) if row["balance_near"] is not None else None
    if row["frozen"]:
        row["status"] = "frozen"
    elif bal is not None and bal < EXHAUSTED_NEAR:
        row["status"] = "exhausted"
    elif bal is not None and bal < LOW_NEAR:
        row["status"] = "low"
    return row
