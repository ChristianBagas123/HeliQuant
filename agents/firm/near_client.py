"""firm/near_client.py — satu-satunya pintu akses NEAR untuk agen (testnet).

Menyatukan: baca kontrak lewat JSON-RPC, kirim transaksi dengan kunci tertentu (py-near), tautan
explorer, dan kesehatan kunci.

Aturan yang dijaga di sini:
  * `send_sync` TIDAK PERNAH melempar exception. Kegagalan kembali sebagai `ok: False` beserta pesan
    panic kontrak / error protokol (`NotEnoughAllowance`, ...), supaya siklus firm tidak berhenti.
    `ok: False` setelah batas waktu berarti hasil BELUM DIKETAHUI, bukan pasti gagal: periksa state
    kontrak sebelum mengulang.
  * Hanya `make_account` yang membuat `Account` (py-near memakai mainnet kalau `rpc_addr` kosong).
    Satu `Account` baru per panggilan; satu objek Account lintas `asyncio.run` gagal total (S-02.8).
  * `guard_testnet` berhenti sebelum ada tanda tangan kalau RPC kosong, `NEAR_NETWORK` bukan
    `testnet`, `chain_id` RPC bukan testnet, atau akun berakhiran `.near`.
  * Gas diisi eksplisit per method (`GAS_TGAS`), tidak pernah memakai default 200 TGas py-near.
  * Satu kunci dipakai berurutan. Beberapa akun boleh paralel (`send_many`).
  * Kegagalan RPC sementara (HTTP 429, `SSL: UNEXPECTED_EOF_WHILE_READING`) diulang.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
YOCTO = 10**24
EXPLORER = "https://testnet.nearblocks.io"
NEARBLOCKS_API = "https://api-testnet.nearblocks.io/v3"
DEFAULT_RPC = "https://test.rpc.fastnear.com"

# Gas prepaid per method (TGas). Biaya cek allowance = gas prepaid x 10 x harga gas + sekitar 0,00092 NEAR.
GAS_TGAS = {
    "record_output": 5,
    "anchor": 5,
    "trade": 220,
    "recover_job": 100,
    "reconcile_job": 150,
    "submit_inference": 10,
}

KEY_RE = re.compile(r"ed25519:[1-9A-HJ-NP-Za-km-z]{32,}")
_TRANSIENT = ("429", "too many requests", "ssl", "unexpected_eof", "connection reset", "timed out", "temporar",
              "502", "503", "504")


class NearGuardError(RuntimeError):
    """Konfigurasi NEAR tidak aman atau salah. Tidak ada tanda tangan yang dibuat."""


# ---------------------------------------------------------------- env
def _env(key: str) -> str | None:
    """Env proses dulu, lalu .env (agents/.env, lalu .env di root proyek)."""
    v = os.environ.get(key)
    if v:
        return v
    for envfile in (ROOT / ".env", ROOT.parent / ".env"):
        try:
            for line in envfile.read_text(encoding="utf-8-sig").replace("\r", "").splitlines():
                line = line.strip()
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].split("#")[0].strip().strip('"').strip("'") or None
        except (OSError, UnicodeError):
            continue
    return None


def network() -> str:
    return _env("NEAR_NETWORK") or "testnet"


def rpc_url() -> str:
    return _env("NEAR_RPC_URL") or ""


def core_id() -> str:
    return _env("NEAR_CORE_CONTRACT_ID") or ""


def desk_keys() -> dict[str, str]:
    """Peta akun desk -> kunci privat terbatas, dari DESK_KEYS_JSON."""
    raw = _env("DESK_KEYS_JSON")
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        return {str(k): str(v) for k, v in d.items()} if isinstance(d, dict) else {}
    except ValueError:
        return {}


def redact(text) -> str:
    text = KEY_RE.sub("ed25519:<disaring>", str(text))
    for k in ("NEAR_EXECUTOR_PRIVATE_KEY", "NEAR_RELAYER_PRIVATE_KEY", "NEAR_OWNER_PRIVATE_KEY", "OUTLAYER_API_KEY"):
        v = _env(k)
        if v:
            text = text.replace(v, "<disaring>")
    return text


def tx_url(tx_hash: str) -> str:
    return f"{EXPLORER}/txns/{tx_hash}"


def account_url(account_id: str) -> str:
    return f"{EXPLORER}/address/{account_id}"


# ---------------------------------------------------------------- RPC
def rpc_call(method: str, params, timeout: int = 12, retries: int = 5):
    """JSON-RPC dengan ulang untuk 429 dan gangguan sesaat. Melempar RuntimeError kalau tetap gagal."""
    url = rpc_url()
    if not url:
        raise NearGuardError("NEAR_RPC_URL kosong")
    body = json.dumps({"jsonrpc": "2.0", "id": "hq", "method": method, "params": params}).encode()
    last: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
            msg = str(e).lower()
            if not any(t in msg for t in _TRANSIENT) and not isinstance(e, (urllib.error.URLError, TimeoutError)):
                break
            time.sleep(min(1.5 * (i + 1), 6))
    raise RuntimeError(f"RPC gagal: {redact(str(last))[:200]}")


_CHAIN_OK: set[str] = set()


def guard_config(*accounts: str) -> str:
    """Pemeriksaan tanpa jaringan. Dipakai saat boot dan sebelum tiap tanda tangan."""
    if network() != "testnet":
        raise NearGuardError("NEAR_NETWORK harus testnet")
    url = rpc_url()
    if not url:
        raise NearGuardError("NEAR_RPC_URL kosong")
    for a in accounts:
        if a.endswith(".near"):
            raise NearGuardError(f"akun mainnet ditolak: {a}")
        if not a.endswith(".testnet"):
            raise NearGuardError(f"akun bukan .testnet: {a}")
    return url


def guard_testnet(*accounts: str) -> str:
    """Seperti guard_config, ditambah cek chain_id RPC (sekali per URL). Dipanggil sebelum tanda tangan."""
    url = guard_config(*accounts)
    if url not in _CHAIN_OK:
        chain = rpc_call("status", [])["result"]["chain_id"]
        if chain != "testnet":
            raise NearGuardError(f"chain_id RPC bukan testnet: {chain}")
        _CHAIN_OK.add(url)
    return url


def view_account(account_id: str) -> dict | None:
    r = rpc_call("query", {"request_type": "view_account", "finality": "final", "account_id": account_id})
    return None if "error" in r or "error" in r.get("result", {}) else r["result"]


def view(contract: str, method: str, args: dict | None = None):
    """Panggil view kontrak. Kembali nilai JSON, atau melempar RuntimeError kalau gagal."""
    r = rpc_call("query", {"request_type": "call_function", "finality": "final", "account_id": contract,
                           "method_name": method,
                           "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()})
    res = r.get("result", {})
    if "error" in r or "error" in res:
        raise RuntimeError(f"view {contract}.{method} gagal: {redact(json.dumps(r.get('error') or res)[:200])}")
    raw = bytes(res["result"]).decode()
    return json.loads(raw) if raw else None


def view_safe(contract: str, method: str, args: dict | None = None, default=None):
    try:
        return view(contract, method, args)
    except Exception:  # noqa: BLE001
        return default


def gas_price() -> int:
    return int(rpc_call("gas_price", [None])["result"]["gas_price"])


def check_cost_near(gas_tgas: float) -> float:
    """Biaya yang dicek protokol sebelum transaksi kunci terbatas diterima (S-03):
    gas prepaid x 10 x harga gas + konstanta 0,92 mNEAR. Ditolak (NotEnoughAllowance) kalau sisa allowance lebih kecil."""
    return (gas_tgas * 1e12 * gas_price() * 10 + 919874069992000000000) / YOCTO


def _b58(b: bytes) -> str:
    alpha = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = alpha[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def _b58d(s: str) -> bytes:
    alpha = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = 0
    for c in s:
        n = n * 58 + alpha.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw


def public_key_of(private_key: str) -> str:
    """Kunci publik dari kunci privat `ed25519:<base58 64 byte>` (32 byte seed + 32 byte publik)."""
    raw = _b58d(private_key.split(":", 1)[1])
    return "ed25519:" + _b58(raw[32:64])


def key_info(account_id: str, private_key: str) -> dict | None:
    """Allowance dan metode kunci terbatas, atau None kalau kunci tidak ada di akun."""
    r = rpc_call("query", {"request_type": "view_access_key", "finality": "optimistic",
                           "account_id": account_id, "public_key": public_key_of(private_key)}).get("result", {})
    if "permission" not in r:
        return None
    fc = r["permission"].get("FunctionCall") if isinstance(r["permission"], dict) else None
    if fc is None:
        return {"nonce": r["nonce"], "allowance": None, "full": True}
    a = fc.get("allowance")
    return {"nonce": r["nonce"], "allowance": int(a) if a is not None else None, "full": False,
            "receiver": fc["receiver_id"], "methods": fc["method_names"]}


# ---------------------------------------------------------------- transaksi
def make_account(account_id: str, private_key: str):
    """Satu-satunya tempat membuat Account. Berhenti kalau konfigurasi atau jaringan salah."""
    from py_near.account import Account

    url = guard_testnet(account_id)
    return Account(account_id, private_key, rpc_addr=url)


def _new_result() -> dict:
    return {"ok": False, "tx_hash": None, "error": None, "latency_ms": 0, "gas_burnt": None, "logs": [],
            "value": None, "explorer": None}


def _decode_value(sv):
    if not sv:
        return None
    raw = base64.b64decode(sv).decode(errors="replace")
    try:
        return json.loads(raw)
    except ValueError:
        return raw


async def _send(account_id: str, key: str, contract: str, method: str, args: dict, gas_tgas: float,
                deposit: int, timeout: float) -> dict:
    out = _new_result()
    t0 = time.time()
    holder: dict = {"acc": None}

    async def _do():
        acc = make_account(account_id, key)
        holder["acc"] = acc
        acc.provider.timeout = timeout
        await acc.startup()
        res = None
        for attempt in range(3):
            try:
                res = await acc.function_call(contract, method, args, gas=int(gas_tgas * 10**12), amount=deposit)
                break
            except Exception as e:  # noqa: BLE001
                if attempt < 2 and any(t in str(e).lower() for t in ("429", "ssl", "unexpected_eof", "502", "503")):
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                raise
        out["tx_hash"] = res.transaction.hash
        out["gas_burnt"] = (sum(int(o.gas_burnt) for o in res.receipt_outcome) + int(res.transaction_outcome.gas_burnt))
        out["logs"] = list(res.logs)
        st = res.status
        failures = []
        if isinstance(st, dict) and "SuccessValue" in st:
            out["value"] = _decode_value(st["SuccessValue"])
        else:
            failures.append(redact(json.dumps(st)[:400]))
        for o in res.receipt_outcome:
            s = getattr(o, "status", None)
            if isinstance(s, dict) and "Failure" in s:
                failures.append(redact(json.dumps(s["Failure"])[:300]))
        out["ok"] = not failures
        if failures:
            out["error"] = " | ".join(dict.fromkeys(failures))[:500]

    try:
        # batas total: timeout + 2 detik. Kalau terlewat, transaksi bisa saja tetap masuk (hasil belum diketahui).
        await asyncio.wait_for(_do(), timeout + 2)
    except BaseException as e:  # noqa: BLE001 - kontrak: tidak boleh melempar
        out["ok"] = False
        out["error"] = redact(f"{type(e).__name__}: {str(e)[:400]}")
        out["tx_hash"] = out["tx_hash"] or getattr(e, "trx_hash", None)
    finally:
        acc = holder["acc"]
        if acc is not None:
            try:
                await asyncio.wait_for(acc.shutdown(), 5)
            except BaseException:  # noqa: BLE001
                pass
    out["latency_ms"] = int((time.time() - t0) * 1000)
    if out["tx_hash"]:
        out["explorer"] = tx_url(out["tx_hash"])
    return out


def _run(coro):
    """asyncio.run yang aman: kalau thread ini sudah punya event loop, jalankan di thread lain."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(1) as ex:
        return ex.submit(asyncio.run, coro).result()


def send_sync(account_id: str, key: str, contract: str, method: str, args: dict, gas_tgas: float | None = None, *,
              deposit: int = 0, timeout: float = 30) -> dict:
    """Kirim satu transaksi function call. Kembali {ok, tx_hash, error, latency_ms, gas_burnt, logs, value, explorer}.
    Tidak boleh melempar exception. Gas bawaan dari GAS_TGAS[method]."""
    gas = gas_tgas if gas_tgas is not None else GAS_TGAS.get(method)
    if gas is None:
        r = _new_result()
        r["error"] = f"gas untuk method {method} belum ditetapkan"
        return r
    try:
        return _run(_send(account_id, key, contract, method, args, gas, deposit, timeout))
    except BaseException as e:  # noqa: BLE001
        r = _new_result()
        r["error"] = redact(f"{type(e).__name__}: {str(e)[:400]}")
        return r


async def _send_many(calls: list[dict], timeout: float) -> list[dict]:
    async def one(c):
        return await _send(c["account"], c["key"], c["contract"], c["method"], c["args"],
                           c.get("gas_tgas") or GAS_TGAS[c["method"]], c.get("deposit", 0), timeout)

    return list(await asyncio.gather(*(one(c) for c in calls)))


def send_many(calls: list[dict], *, timeout: float = 30) -> list[dict]:
    """Beberapa akun sekaligus (paralel). Tiap item: {account, key, contract, method, args, gas_tgas?}.
    Kembali daftar hasil dengan urutan yang sama. Tidak melempar exception."""
    try:
        return _run(_send_many(calls, timeout))
    except BaseException as e:  # noqa: BLE001
        err = redact(f"{type(e).__name__}: {str(e)[:300]}")
        out = []
        for _ in calls:
            r = _new_result()
            r["error"] = err
            out.append(r)
        return out


# ---------------------------------------------------------------- kesehatan pencatatan
_HEALTH_LOCK = threading.Lock()
FAILS: dict[str, int] = {}
LAST_OK: dict[str, str] = {}


def note_result(name: str, ok: bool) -> None:
    """Catat hasil pencatatan on-chain per nama kunci (desk, executor, relayer)."""
    with _HEALTH_LOCK:
        if ok:
            LAST_OK[name] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        else:
            FAILS[name] = FAILS.get(name, 0) + 1


def key_status(allowance_near: float | None, cost_near: float, low_factor: float = 10) -> str:
    """exhausted: sisa di bawah biaya cek. low: di bawah `low_factor` kali biaya cek. Selain itu ok.
    Desk memakai faktor 10 (biaya cek 5 TGas kecil). Executor memakai faktor 2, karena biaya cek `trade`
    (220 TGas) sudah 0,22 NEAR dan faktor 10 akan menandai kunci 1 NEAR sebagai `low` selamanya."""
    if allowance_near is None:
        return "ok"
    if allowance_near < cost_near:
        return "exhausted"
    if allowance_near < low_factor * cost_near:
        return "low"
    return "ok"


def free_balance_near(account_id: str) -> tuple[float, int] | None:
    """(saldo bebas dalam NEAR, storage_usage). Saldo bebas = saldo - 10^19 yocto per byte tersimpan."""
    a = view_account(account_id)
    if not a:
        return None
    amount, used = int(a["amount"]), int(a["storage_usage"])
    return max(amount - used * 10**19, 0) / YOCTO, used


def health(registry: dict | None = None) -> dict:
    """Status untuk /health/onchain."""
    out: dict = {"network": network(), "rpc_ok": False, "core": None, "keys": [], "failed_total": 0,
                 "locked_jobs": []}
    try:
        guard_config()
        out["rpc_ok"] = bool(rpc_call("status", [], timeout=8, retries=2)["result"]["chain_id"])
    except Exception as e:  # noqa: BLE001
        out["error"] = redact(str(e))[:160]
        return out
    core = core_id()
    try:
        fb = free_balance_near(core)
        if fb:
            out["core"] = {"account": core, "free_balance_near": f"{fb[0]:.4f}", "storage_usage": fb[1]}
    except Exception:  # noqa: BLE001
        pass
    registry = registry or {}
    roles: list[tuple[str, str, str | None, str, str]] = []  # role, name, account, key, method
    dk = desk_keys()
    for name, d in (registry.get("desks") or {}).items():
        acct = d.get("account")
        if acct and acct in dk:
            roles.append(("desk", name, acct, dk[acct], "record_output"))
    ex = _env("NEAR_EXECUTOR_PRIVATE_KEY")
    custody_row = None
    try:
        from firm import executor_signer as _es
        custody_row = _es.status()           # mode custody: baris executor dari API OutLayer (tanpa kunci di agen)
    except Exception:  # noqa: BLE001
        custody_row = None
    if custody_row is not None:
        out["keys"].append(custody_row)
    elif ex:
        ex_acct = (_env("NEAR_EXECUTOR_ACCOUNT") or f"executor.{_env('NEAR_PARENT_ACCOUNT') or ''}").strip(".")
        roles.append(("executor", "executor", ex_acct, ex, "trade"))
    for role, name, acct, key, method in roles:
        try:
            info = key_info(acct, key)
            cost = check_cost_near(GAS_TGAS[method])
        except Exception:  # noqa: BLE001
            info, cost = None, 0.0
        if info is None:
            status, al = "missing", None
        else:
            al = None if info["allowance"] is None else info["allowance"] / YOCTO
            status = key_status(al, cost, 2 if role == "executor" else 10)
        with _HEALTH_LOCK:
            failed, last_ok = FAILS.get(name, 0), LAST_OK.get(name, "")
        out["keys"].append({"role": role, "name": name, "account": acct,
                            "allowance_near": None if al is None else f"{al:.4f}",
                            "check_cost_near": f"{cost:.4f}", "status": status, "failed": failed,
                            "last_ok_at": last_ok})
    with _HEALTH_LOCK:
        out["failed_total"] = sum(FAILS.values())
    # job terkunci (alur swap tersangkut)
    try:
        total = int(view(core, "total_jobs"))
        for jid in range(max(1, total - 49), total + 1):
            j = view(core, "get_job", {"job_id": str(jid)})
            if j and j.get("locked"):
                out["locked_jobs"].append({"job_id": str(jid), "status": j.get("status")})
    except Exception:  # noqa: BLE001
        pass
    return out


def nearblocks_txns(account_id: str, per_page: int = 25) -> list[dict]:
    """Halaman terbaru transaksi akun dari NearBlocks API v3 (tanpa API key tetap bisa, dengan batas tier gratis)."""
    headers = {"User-Agent": "heliquant-agent"}
    key = _env("NEARBLOCKS_API_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    url = f"{NEARBLOCKS_API}/accounts/{account_id}/txns?per_page={per_page}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.loads(r.read())
    return d.get("data") or d.get("txns") or []
