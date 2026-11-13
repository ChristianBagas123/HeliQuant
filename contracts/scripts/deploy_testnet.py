#!/usr/bin/env python3
"""Deploy HeliQuant ke NEAR testnet. Dipanggil oleh deploy-testnet.sh di WSL.

Pemakaian: deploy_testnet.py [--dry] <langkah ...>
Langkah: preflight accounts deploy register pool agents keys allora write smoke  (atau: all)

- Hanya testnet. Berhenti kalau chain_id RPC bukan testnet atau akun bukan .testnet.
- Idempoten: tiap langkah memeriksa keadaan on-chain dulu, jadi aman dijalankan ulang.
- Kunci privat tidak pernah dicetak. Semua output CLI disaring. Kunci baru ditulis ke
  contracts/deployments/keys.env (terabaikan git) dan ke .env di root.
- Semua transaksi memakai near-cli-rs; view memakai JSON-RPC langsung.
"""
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
ENV_PATH = ROOT / ".env"
KEYS_ENV = CONTRACTS / "deployments" / "keys.env"
DEPLOYMENTS = CONTRACTS / "deployments" / "near_testnet.json"
REGISTRY = ROOT / "agents" / "data" / "agent_registry.json"
WASM_DIR = Path(os.environ.get("HQ_WASM_DIR", str(Path.home() / "hq-wasm")))
Y = 10**24
DRY = False

KEY_RE = re.compile(r"ed25519:[1-9A-HJ-NP-Za-km-z]{40,}")
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

RHEA = "ref-finance-101.testnet"
WNEAR = "wrap.testnet"
TOPICS = [14]

# slug, nama desk, kind, ml, peran. Urutan = urutan token (Firm = 1, desk mulai dari 2).
DESKS = [
    ("regime", "Regime/Technical", "Signal", True, "XGBoost regime classifier + trend strength + dynamic R:R"),
    ("macro", "Macro (Allora)", "Signal", False, "Allora decentralised-AI price prediction"),
    ("onchain-risk", "On-chain/Risk", "Risk", False, "whale flow + watchlist health + on-chain token safety checks"),
    ("research", "Research", "Research", False, "external macro: Fear&Greed + global market via public APIs"),
    ("smart-money", "Smart-Money Flow", "Signal", False, "NEAR DEX flow + majors perp + Nansen netflow"),
    ("smart-social", "Smart-Social", "Research", False, "Elfa narrative/mindshare from smart accounts, not retail"),
    ("oi-contrarian", "OI-Contrarian", "Signal", False, "fade perp open-interest extremes (OOS-validated edge)"),
    ("flow-intel", "flow-intel", "Signal", False, "self-learning flow-signal validation (OI/funding/order-flow/momentum)"),
    ("whale", "whale", "Signal", False, "per-asset whale stance tracker"),
    ("carry", "Carry", "Signal", False, "delta-neutral funding-carry yield (market-neutral)"),
    ("near-fundamentals", "NEAR Fundamentals", "Research", False, "DeFiLlama NEAR chain TVL / fees / staking: ecosystem risk-on/off"),
    ("timesfm", "TimesFM Vol/Risk", "Risk", False, "TimesFM 2.5 next-day realized-vol forecast -> vol-targeting"),
]

# ---------------------------------------------------------------- env, kunci, redaksi
_secrets = set()


def load_env(path):
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").replace("\r", "").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


ENV = load_env(ENV_PATH)
ENV.update({k: v for k, v in os.environ.items() if k.startswith(("NEAR_", "AGENT_", "ALLORA_"))})
KEYS = load_env(KEYS_ENV)


def redact(text):
    text = KEY_RE.sub("ed25519:<disaring>", str(text))
    for s in _secrets:
        text = text.replace(s, "<disaring>")
    return text


def log(*a):
    print(redact(" ".join(str(x) for x in a)), flush=True)


def b58e(b):
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def b58d(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw


def pub_of(sk):
    raw = b58d(sk.split(":", 1)[1])
    k = Ed25519PrivateKey.from_private_bytes(raw[:32])
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return "ed25519:" + b58e(pub)


def gen_key():
    seed = os.urandom(32)
    k = Ed25519PrivateKey.from_private_bytes(seed)
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    sk = "ed25519:" + b58e(seed + pub)
    _secrets.add(sk)
    return sk, "ed25519:" + b58e(pub)


def save_kv(path, updates):
    """Tulis/ubah KEY=VALUE tanpa menyentuh baris lain. File dibuat kalau belum ada."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").replace("\r", "").split("\n") if path.exists() else []
    seen = set()
    for i, l in enumerate(lines):
        m = re.match(r"^([A-Za-z_][A-Za-z_0-9]*)=", l)
        if m and m.group(1) in updates:
            lines[i] = f"{m.group(1)}={updates[m.group(1)]}"
            seen.add(m.group(1))
    while lines and lines[-1] == "":
        lines.pop()
    for k, v in updates.items():
        if k not in seen:
            lines.append(f"{k}={v}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- konfigurasi
NETWORK = ENV.get("NEAR_NETWORK", "")
RPC = ENV.get("NEAR_RPC_URL", "")
PARENT = ENV.get("NEAR_PARENT_ACCOUNT", "")
OWNER_SK = ENV.get("NEAR_OWNER_PRIVATE_KEY", "")
ENDPOINT = ENV.get("AGENT_PUBLIC_URL", "").rstrip("/")
if OWNER_SK:
    _secrets.add(OWNER_SK)
for _k, _v in KEYS.items():
    _secrets.add(_v)


def acct(name):
    return f"{name}.{PARENT}"


CORE, MUSDC, ALLORA = acct("core"), acct("musdc"), acct("allora")
EXECUTOR, RELAYER = acct("executor"), acct("relayer")


# ---------------------------------------------------------------- RPC (view)
def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": "hq", "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
    last = None
    for i in range(6):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"RPC gagal: {last}")


def view_account(account_id):
    r = rpc("query", {"request_type": "view_account", "finality": "final", "account_id": account_id})
    return None if "error" in r else r["result"]


def view(contract, method, args=None):
    r = rpc("query", {"request_type": "call_function", "finality": "final", "account_id": contract,
                      "method_name": method, "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()})
    res = r.get("result", {})
    if "error" in r or "error" in res:
        return {"__error__": redact(json.dumps(r)[:300])}
    return json.loads(bytes(res["result"]).decode() or "null")


def access_keys(account_id):
    r = rpc("query", {"request_type": "view_access_key_list", "finality": "final", "account_id": account_id})
    return r.get("result", {}).get("keys", [])


def bal(account_id):
    a = view_account(account_id)
    return int(a["amount"]) if a else 0


def ft_bal(token, who):
    v = view(token, "ft_balance_of", {"account_id": who})
    return int(v) if not isinstance(v, dict) else 0


def is_registered(token, who):
    v = view(token, "storage_balance_of", {"account_id": who})
    return bool(v) and not (isinstance(v, dict) and "__error__" in v)


# ---------------------------------------------------------------- transaksi lewat near-cli-rs
def near_tx(signer_sk, cli_args, what):
    """Jalankan near-cli-rs yang ditutup dengan sign-with-plaintext-private-key. Kembali (tx_hash, output)."""
    cmd = ["near", *cli_args, "network-config", NETWORK, "sign-with-plaintext-private-key", signer_sk, "send"]
    if DRY:
        log("  [dry]", what)
        return None, ""
    last = ""
    for attempt in range(3):
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        out = redact(p.stdout + "\n" + p.stderr)
        m = re.search(r"Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})", out)
        if p.returncode == 0 and m:
            return m.group(1), out
        last = out
        time.sleep(3)
    raise RuntimeError(f"{what}: near-cli gagal\n{last[-1200:]}")


def tx_result(tx_hash, signer, wait=True):
    """Periksa hasil transaksi: (ok, nilai_balik, daftar_kegagalan). Semua receipt dihitung."""
    for _ in range(20):
        r = rpc("EXPERIMENTAL_tx_status", {"tx_hash": tx_hash, "sender_account_id": signer, "wait_until": "FINAL"})
        if "result" in r:
            break
        time.sleep(2)
    else:
        return False, None, [redact(json.dumps(r)[:300])]
    res = r["result"]
    fails, value = [], None
    st = res["status"]
    if isinstance(st, dict) and "SuccessValue" in st:
        sv = st["SuccessValue"]
        if sv:
            raw = base64.b64decode(sv).decode(errors="replace")
            try:
                value = json.loads(raw)
            except Exception:  # noqa: BLE001
                value = raw
    else:
        fails.append(redact(json.dumps(st)[:300]))
    for o in [res["transaction_outcome"]] + res["receipts_outcome"]:
        s = o["outcome"]["status"]
        if isinstance(s, dict) and "Failure" in s:
            fails.append(redact(json.dumps(s["Failure"])[:300]))
    return not fails, value, fails


def run_tx(signer, signer_sk, cli_args, what):
    h, _ = near_tx(signer_sk, cli_args, what)
    if h is None:
        return None
    ok, value, fails = tx_result(h, signer)
    if not ok:
        raise RuntimeError(f"{what}: transaksi {h} gagal: {fails}")
    log(f"  ok  {what}  tx {h}")
    return value


def fcall(signer, signer_sk, contract, method, args, gas_tgas=30, deposit_near="0", what=None):
    cli = ["contract", "call-function", "as-transaction", contract, method, "json-args", json.dumps(args),
           "prepaid-gas", f"{gas_tgas} Tgas", "attached-deposit", f"{deposit_near} NEAR", "sign-as", signer]
    return run_tx(signer, signer_sk, cli, what or f"{signer} -> {contract}.{method}")


def fcall_yocto1(signer, signer_sk, contract, method, args, gas_tgas=30, what=None):
    cli = ["contract", "call-function", "as-transaction", contract, method, "json-args", json.dumps(args),
           "prepaid-gas", f"{gas_tgas} Tgas", "attached-deposit", "1 yoctoNEAR", "sign-as", signer]
    return run_tx(signer, signer_sk, cli, what or f"{signer} -> {contract}.{method}")


# ---------------------------------------------------------------- bantu
def owner_pk():
    return pub_of(OWNER_SK)


def wasm(name):
    p = WASM_DIR / f"{name}.wasm"
    if not p.exists():
        raise SystemExit(f"{p} tidak ada. Jalankan scripts/build-wasm.sh dulu.")
    return p


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def code_hash_b58(account_id):
    a = view_account(account_id)
    return a["code_hash"] if a else None


def b58_of_sha(hexhash):
    return b58e(bytes.fromhex(hexhash))


def state_path():
    return CONTRACTS / "deployments" / ".state" / "deploy.json"


def load_state():
    p = state_path()
    return json.loads(p.read_text()) if p.exists() else {}


def save_state(**kw):
    s = load_state()
    s.update(kw)
    state_path().parent.mkdir(parents=True, exist_ok=True)
    state_path().write_text(json.dumps(s, indent=1))


def near_price():
    try:
        req = urllib.request.Request(
            "https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=NEARUSDT",
            headers={"User-Agent": "heliquant-deploy"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return float(json.loads(r.read())["data"][0]["lastPr"])
    except Exception as e:  # noqa: BLE001
        log("  harga NEAR gagal diambil, pakai 3.7:", e)
        return 3.7


# ---------------------------------------------------------------- langkah
def step_preflight():
    log("== preflight")
    assert NETWORK == "testnet", "NEAR_NETWORK harus testnet"
    assert RPC, "NEAR_RPC_URL kosong"
    chain = rpc("status", [])["result"]["chain_id"]
    assert chain == "testnet", f"chain_id RPC bukan testnet: {chain}"
    assert PARENT.endswith(".testnet"), "NEAR_PARENT_ACCOUNT bukan .testnet"
    assert OWNER_SK.startswith("ed25519:"), "NEAR_OWNER_PRIVATE_KEY kosong atau bukan ed25519"
    assert ENDPOINT.startswith("https://"), "AGENT_PUBLIC_URL kosong (isi URL Railway)"
    a = view_account(PARENT)
    assert a, f"akun {PARENT} tidak ada"
    keys = [k["public_key"] for k in access_keys(PARENT)]
    assert owner_pk() in keys, "NEAR_OWNER_PRIVATE_KEY bukan kunci akun induk"
    log(f"  chain {chain}, induk {PARENT} saldo {int(a['amount']) / Y:.2f} NEAR, endpoint {ENDPOINT}")
    for n in ("core", "musdc", "allora"):
        p = wasm(n)
        log(f"  {n}.wasm {p.stat().st_size} byte sha256 {sha(p)}")
    save_state(wasm_sha256={n: sha(wasm(n)) for n in ("core", "musdc", "allora")})


def step_accounts():
    log("== sub-akun")
    plan = [(CORE, 20), (MUSDC, 2), (ALLORA, 2.5), (EXECUTOR, 1), (RELAYER, 0.5)]
    plan += [(acct(d[0]), 0.5) for d in DESKS]
    for name, amount in plan:
        if view_account(name):
            log(f"  ada {name}")
            continue
        run_tx(PARENT, OWNER_SK,
               ["account", "create-account", "fund-myself", name, f"{amount} NEAR",
                "use-manually-provided-public-key", owner_pk(), "sign-as", PARENT],
               f"buat {name} ({amount} NEAR)")
        if not DRY:
            assert view_account(name), f"{name} belum terlihat"


def deploy_one(account_id, name, init_method, init_args):
    path = wasm(name)
    want = b58_of_sha(sha(path))
    if code_hash_b58(account_id) == want:
        log(f"  {account_id} sudah menjalankan {name}.wasm (hash sama)")
        return
    cur = code_hash_b58(account_id)
    assert cur in (None, "11111111111111111111111111111111"), \
        f"{account_id} sudah punya kode lain; pakai migrate secara manual, jangan deploy + new"
    run_tx(account_id, OWNER_SK,
           ["contract", "deploy", account_id, "use-file", str(path), "with-init-call", init_method,
            "json-args", json.dumps(init_args), "prepaid-gas", "50 Tgas", "attached-deposit", "0 NEAR"],
           f"deploy {name}.wasm ke {account_id} + {init_method}")


def step_deploy():
    log("== deploy kontrak")
    deploy_one(MUSDC, "musdc", "new", {})
    deploy_one(CORE, "core", "new", {"owner": PARENT, "principal_token": MUSDC, "base_token": WNEAR,
                                      "dex": RHEA, "executor": EXECUTOR})
    deploy_one(ALLORA, "allora", "new", {"owner": PARENT})
    for c, m in ((CORE, "version"), (ALLORA, "version")):
        log(f"  {c}.{m} ->", view(c, m))
    log("  core.config ->", view(CORE, "config"))


def reg_in(token, who, payer=PARENT):
    if is_registered(token, who):
        log(f"  {who} sudah terdaftar di {token}")
        return
    fcall(payer, OWNER_SK, token, "storage_deposit", {"account_id": who, "registration_only": True},
          30, "0.0125", f"daftarkan {who} di {token}")


def step_register():
    log("== pendaftaran storage dan Rhea untuk core")
    for tok in (MUSDC, WNEAR):
        reg_in(tok, CORE)
    reg_in(MUSDC, RHEA)
    reg_in(WNEAR, RHEA)
    st = view(RHEA, "storage_balance_of", {"account_id": CORE})
    if st:
        log("  core sudah terdaftar di Rhea")
    else:
        fcall(CORE, OWNER_SK, RHEA, "storage_deposit", {}, 30, "0.1", "core storage_deposit di Rhea")
    dep = view(RHEA, "get_deposits", {"account_id": CORE})
    if isinstance(dep, dict) and MUSDC in dep and WNEAR in dep:
        log("  core sudah register_tokens di Rhea")
    else:
        fcall_yocto1(CORE, OWNER_SK, RHEA, "register_tokens", {"token_ids": [MUSDC, WNEAR]}, 50,
                     "core register_tokens di Rhea")


def find_pool():
    n = view(RHEA, "get_number_of_pools")
    for pid in range(n - 1, max(-1, n - 200), -1):
        p = view(RHEA, "get_pool", {"pool_id": pid})
        if isinstance(p, dict) and p.get("token_account_ids") == [MUSDC, WNEAR] and p.get("total_fee") == 30:
            if int(p.get("shares_total_supply", "0")) > 0:
                return pid
    return None


def step_pool():
    log("== pool Rhea mUSDC/wNEAR")
    pid = load_state().get("pool_id")
    if pid is not None:
        p = view(RHEA, "get_pool", {"pool_id": pid})
        if isinstance(p, dict) and p.get("token_account_ids") == [MUSDC, WNEAR] and int(p["shares_total_supply"]) > 0:
            log(f"  pool {pid} sudah ada dan berisi likuiditas")
            return
    price = near_price()
    wn = 5 * Y
    mu = int(round(5 * price * 1_000_000))
    log(f"  harga NEAR {price} -> likuiditas 5 wNEAR + {mu / 1e6} mUSDC")
    o = PARENT
    reg_in(MUSDC, o)
    reg_in(WNEAR, o)
    if not view(RHEA, "storage_balance_of", {"account_id": o}):
        fcall(o, OWNER_SK, RHEA, "storage_deposit", {}, 30, "0.1", "owner storage_deposit di Rhea")
    # wNEAR dan mUSDC untuk likuiditas
    if ft_bal(WNEAR, o) < wn:
        fcall(o, OWNER_SK, WNEAR, "near_deposit", {}, 30, "5", "owner near_deposit 5 NEAR")
    if ft_bal(MUSDC, o) < mu:
        fcall(o, OWNER_SK, MUSDC, "mint", {"account_id": o, "amount": str(mu)}, 30, "0", "mint mUSDC untuk likuiditas")
    fcall_yocto1(o, OWNER_SK, RHEA, "register_tokens", {"token_ids": [MUSDC, WNEAR]}, 50, "owner register_tokens")
    value = fcall(o, OWNER_SK, RHEA, "add_simple_pool", {"tokens": [MUSDC, WNEAR], "fee": 30}, 50, "0.1",
                  "add_simple_pool fee 30")
    pid = value if isinstance(value, int) else None
    if pid is None:
        pid = None  # nilai balik tidak terbaca; pool dicari setelah likuiditas ditambah
    save_state(pool_id=pid)
    fcall_yocto1(o, OWNER_SK, MUSDC, "ft_transfer_call", {"receiver_id": RHEA, "amount": str(mu), "msg": ""}, 100,
                 "deposit mUSDC ke Rhea")
    fcall_yocto1(o, OWNER_SK, WNEAR, "ft_transfer_call", {"receiver_id": RHEA, "amount": str(wn), "msg": ""}, 100,
                 "deposit wNEAR ke Rhea")
    if pid is None:
        raise SystemExit("pool_id tidak terbaca dari nilai balik; hentikan dan periksa manual")
    fcall(o, OWNER_SK, RHEA, "add_liquidity", {"pool_id": pid, "amounts": [str(mu), str(wn)]}, 100, "0.01",
          "add_liquidity")
    p = view(RHEA, "get_pool", {"pool_id": pid})
    assert p["token_account_ids"] == [MUSDC, WNEAR] and int(p["shares_total_supply"]) > 0, p
    log(f"  pool_id {pid}, amounts {p['amounts']}, fee {p['total_fee']}")
    save_state(pool_id=pid, pool_liquidity={"musdc": str(mu), "wnear": str(wn)})


def step_agents():
    log("== pendaftaran Firm dan desk")
    total = int(view(CORE, "total_agents"))
    if total >= 1 + len(DESKS):
        log(f"  sudah {total} token terdaftar")
        return
    assert total == 0, f"keadaan setengah jadi ({total} token); periksa manual"
    meta = json.dumps({"name": "HeliQuant", "role": "autonomous multi-desk AI trading firm", "kind": "Firm"},
                      separators=(",", ":"))
    fcall(PARENT, OWNER_SK, CORE, "register_agent",
          {"kind": "Firm", "parent_token_id": None, "agent_account": PARENT, "metadata_uri": meta,
           "service_endpoint": ENDPOINT}, 100, "0.01", "register_agent Firm")
    for slug, name, kind, ml, role in DESKS:
        meta = json.dumps({"name": name, "role": role, "ml": ml, "firm": "HeliQuant"}, separators=(",", ":"))
        fcall(PARENT, OWNER_SK, CORE, "register_agent",
              {"kind": kind, "parent_token_id": "1", "agent_account": acct(slug), "metadata_uri": meta,
               "service_endpoint": ENDPOINT}, 100, "0.01", f"register_agent {name}")
    log("  total_agents ->", view(CORE, "total_agents"))


def has_fc_key(account_id, receiver, methods):
    for k in access_keys(account_id):
        perm = k["access_key"]["permission"]
        if isinstance(perm, dict) and "FunctionCall" in perm:
            fc = perm["FunctionCall"]
            if fc["receiver_id"] == receiver and sorted(fc["method_names"]) == sorted(methods):
                yield k["public_key"]


def add_limited_key(account_id, env_name, receiver, methods, allowance, env_updates, keys_updates):
    """Pasang kunci terbatas kalau belum ada. Kunci privat disimpan lokal (bukan di repo)."""
    existing_sk = KEYS.get(env_name)
    if existing_sk and pub_of(existing_sk) in list(has_fc_key(account_id, receiver, methods)):
        log(f"  kunci terbatas {account_id} sudah terpasang")
        env_updates[env_name] = existing_sk
        return existing_sk
    sk, pk = gen_key()
    keys_updates[env_name] = sk
    save_kv(KEYS_ENV, {env_name: sk})  # simpan dulu, sebelum kunci dipasang
    KEYS[env_name] = sk
    run_tx(account_id, OWNER_SK,
           ["account", "add-key", account_id, "grant-function-call-access", "--allowance", f"{allowance} NEAR",
            "--contract-account-id", receiver, "--function-names", ",".join(methods),
            "use-manually-provided-public-key", pk],
           f"kunci terbatas {account_id} -> {receiver}[{','.join(methods)}] allowance {allowance} NEAR")
    env_updates[env_name] = sk
    return sk


def step_keys():
    log("== kunci terbatas")
    env_updates, keys_updates = {}, {}
    ex = add_limited_key(EXECUTOR, "NEAR_EXECUTOR_PRIVATE_KEY", CORE,
                         ["trade", "recover_job", "reconcile_job", "anchor"], 1, env_updates, keys_updates)
    rl = add_limited_key(RELAYER, "NEAR_RELAYER_PRIVATE_KEY", ALLORA, ["submit_inference"], 0.5, env_updates,
                         keys_updates)
    desk_keys = {}
    for slug, *_ in DESKS:
        name = f"DESK_KEY_{slug.upper().replace('-', '_')}"
        desk_keys[acct(slug)] = add_limited_key(acct(slug), name, CORE, ["record_output"], 0.5, env_updates,
                                                keys_updates)
    for s in (ex, rl, *desk_keys.values()):
        _secrets.add(s)
    if DRY:
        return
    save_kv(ENV_PATH, {
        "NEAR_CORE_CONTRACT_ID": CORE,
        "ALLORA_CONTRACT_ID": ALLORA,
        "FIRM_TOKEN_ID": "1",
        "NEAR_EXECUTOR_PRIVATE_KEY": ex,
        "NEAR_RELAYER_PRIVATE_KEY": rl,
        "DESK_KEYS_JSON": json.dumps(desk_keys, separators=(",", ":")),
    })
    log("  .env diperbarui (NEAR_EXECUTOR_PRIVATE_KEY, NEAR_RELAYER_PRIVATE_KEY, DESK_KEYS_JSON, id kontrak)")


def step_allora():
    log("== allora")
    if not view(ALLORA, "is_trusted_relayer", {"account_id": RELAYER}):
        fcall(PARENT, OWNER_SK, ALLORA, "set_trusted_relayer", {"account_id": RELAYER, "trusted": True}, 30, "0",
              "allora set_trusted_relayer")
    for t in TOPICS:
        if not view(ALLORA, "is_topic_enabled", {"topic_id": t}):
            fcall(PARENT, OWNER_SK, ALLORA, "set_topic_enabled", {"topic_id": t, "enabled": True}, 30, "0",
                  f"allora set_topic_enabled {t}")
    log("  relayer tepercaya:", view(ALLORA, "is_trusted_relayer", {"account_id": RELAYER}),
        "topik 14:", view(ALLORA, "is_topic_enabled", {"topic_id": 14}))


def step_write():
    log("== near_testnet.json dan agent_registry.json")
    st = load_state()
    pool_id = st.get("pool_id")
    assert pool_id is not None, "pool_id belum ada (jalankan langkah pool)"
    shas = {n: sha(wasm(n)) for n in ("core", "musdc", "allora")}
    doc = {
        "network": "testnet",
        "rpc": RPC,
        "parent": PARENT,
        "contracts": {"core": CORE, "musdc": MUSDC, "allora": ALLORA},
        "tokens": {"principal": MUSDC, "base": WNEAR},
        "dex": {"id": RHEA, "pool_id": pool_id},
        "accounts": {"executor": EXECUTOR, "relayer": RELAYER},
        "firm_token_id": "1",
        "allora_topics": TOPICS,
        "wasm_sha256": shas,
        "deployed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if DRY:
        log("  [dry]", json.dumps(doc)[:200])
        return
    DEPLOYMENTS.parent.mkdir(parents=True, exist_ok=True)
    DEPLOYMENTS.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    desks = {}
    for i, (slug, name, kind, ml, role) in enumerate(DESKS):
        desks[name] = {"tokenId": str(i + 2), "kind": kind, "ml": ml, "account": acct(slug)}
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps({"network": "testnet", "core": CORE, "firm": {"tokenId": "1"}, "desks": desks},
                                   indent=2) + "\n", encoding="utf-8")
    # nilai untuk tes asap dan frontend
    log(f"  tulis {DEPLOYMENTS.relative_to(ROOT)} dan {REGISTRY.relative_to(ROOT)}")


def step_smoke():
    log("== uji asap")
    keys = load_env(ENV_PATH)
    ex_sk = keys["NEAR_EXECUTOR_PRIVATE_KEY"]
    desk_sk = json.loads(keys["DESK_KEYS_JSON"])[acct(DESKS[0][0])]
    for s in (ex_sk, desk_sk):
        _secrets.add(s)
    ver = view(CORE, "version")
    assert isinstance(ver, str) and ver.startswith("heliquant-core "), ver
    log("  version ->", ver)
    ident = view(CORE, "get_identity", {"token_id": "1"})
    assert ident and ident["kind"] == "Firm" and ident["owner_id"] == PARENT, ident
    log("  get_identity(1) -> Firm milik", ident["owner_id"], "endpoint", ident["service_endpoint"])
    before = int(view(CORE, "credential_count_for", {"token_id": "2"}))
    h = hashlib.sha256(b"heliquant-smoke " + str(time.time()).encode()).hexdigest()
    fcall(acct(DESKS[0][0]), desk_sk, CORE, "record_output",
          {"token_id": "2", "job_id": "0", "proof_kind": 1, "proof_hash": h}, 5, "0", "record_output (kunci desk)")
    after = int(view(CORE, "credential_count_for", {"token_id": "2"}))
    assert after == before + 1, (before, after)
    log(f"  credential_count_for(2): {before} -> {after}")
    fcall(EXECUTOR, ex_sk, CORE, "anchor", {"record_hash": h, "kind": "decision", "ref_id": "smoke"}, 5, "0",
          "anchor (kunci executor)")
    # job: 1 mUSDC dari akun induk lewat ft_transfer_call
    reg_in(MUSDC, PARENT)
    if ft_bal(MUSDC, PARENT) < 2_000_000:
        fcall(PARENT, OWNER_SK, MUSDC, "mint", {"account_id": PARENT, "amount": "2000000"}, 30, "0", "mint 2 mUSDC")
    jobs_before = int(view(CORE, "total_jobs"))
    msg = json.dumps({"firm_token_id": "1", "base_token": WNEAR, "duration_sec": 3600, "perf_fee_bps": 1000})
    fcall_yocto1(PARENT, OWNER_SK, MUSDC, "ft_transfer_call", {"receiver_id": CORE, "amount": "1000000", "msg": msg},
                 100, "ft_transfer_call 1 mUSDC ke core")
    jobs_after = int(view(CORE, "total_jobs"))
    assert jobs_after == jobs_before + 1, (jobs_before, jobs_after)
    job = view(CORE, "get_job", {"job_id": str(jobs_after)})
    assert job["status"] == "Active" and job["principal_in"] == "1000000", job
    log(f"  get_job({jobs_after}) -> {job['status']}, principal {job['principal_in']}")
    st = view_account(CORE)
    log(f"  core: saldo {int(st['amount']) / Y:.3f} NEAR, storage {st['storage_usage']} byte")
    log("UJI ASAP SUKSES")


STEPS = {
    "preflight": step_preflight, "accounts": step_accounts, "deploy": step_deploy, "register": step_register,
    "pool": step_pool, "agents": step_agents, "keys": step_keys, "allora": step_allora, "write": step_write,
    "smoke": step_smoke,
}
ORDER = ["preflight", "accounts", "deploy", "register", "pool", "agents", "keys", "allora", "write", "smoke"]


def main():
    global DRY
    args = [a for a in sys.argv[1:] if a != "--dry"]
    DRY = "--dry" in sys.argv
    todo = ORDER if not args or args == ["all"] else args
    for s in todo:
        if s not in STEPS:
            raise SystemExit(f"langkah tidak dikenal: {s}. Pilihan: {' '.join(ORDER)}")
    for s in todo:
        STEPS[s]()
    log("selesai:", " ".join(todo))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, RuntimeError) as e:
        log("GAGAL:", e)
        sys.exit(1)
