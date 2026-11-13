"""Bukti TEE untuk panggilan LLM lewat NEAR AI Cloud.

Alur per siklus `run_organization`:
  begin_cycle()  -> preflight atestasi (nonce segar, cek NVIDIA NRAS), buka penampung bukti
  record_call()  -> dipanggil llm_client tiap jawaban sukses: simpan hash request/response dan chat_id
  end_cycle()    -> ambil tanda tangan tiap chat_id, verifikasi ed25519, hitung biaya, kembalikan bundel

Yang diverifikasi: tanda tangan ed25519 atas `model:sha256(request):sha256(response)` dari kunci TEE model, kunci itu
ada di laporan atestasi siklus ini, nonce atestasi cocok, dan GPU lolos NVIDIA NRAS. Yang TIDAK diverifikasi: quote
Intel TDX, report_data, compose/mr_config, TLS, provenance image. Bukti tidak menjamin data pasar benar.
Semua fungsi publik tidak melempar error: kegagalan jadi `verified: false` beserta alasan, firm tetap jalan.
"""
from __future__ import annotations

import base64
import contextvars
import hashlib
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE = "https://cloud-api.near.ai/v1"
NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu"
ROOT = Path(__file__).resolve().parents[1]
PROOFS_FILE = ROOT / "data" / "tee_proofs.jsonl"
SPEND_KEY = "nearai_spend"
CYCLE_KEY = "tee:cycle:"        # satu bundel lengkap per siklus (state_store / Supabase)
INDEX_KEY = "tee:index"         # daftar ringkas siklus terbaru
INDEX_MAX = 300
CYCLE_ID_RE = re.compile(r"^[A-Za-z0-9]{1,12}-\d{8}T\d{6}Z$")
FALLBACK_PRICE = (0.04 / 1e6, 1.35 / 1e6)          # USD per token (masuk, keluar) kalau /v1/models tak terbaca
SIG_RETRIES, SIG_WAIT = 5, 2.0
PRICE_TTL = 3600

_SINK: contextvars.ContextVar[dict | None] = contextvars.ContextVar("tee_sink", default=None)
_LOCK = threading.Lock()
_PRICE: dict[str, tuple[float, tuple[float, float]]] = {}
_SPEND: dict = {}
_EXHAUSTED_UNTIL = 0.0
_RECENT: list[dict] = []                            # 50 bundel terakhir (untuk endpoint /tee)


# ───────────────────────── utilitas ─────────────────────────
def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def signature_text(model: str, request_sha256: str, response_sha256: str) -> str:
    return f"{model}:{request_sha256}:{response_sha256}"


def proofs_digest(calls: list[dict]) -> str:
    """sha256 JSON kanonik dari daftar bukti (kunci terurut, ringkas). Kunci `seconds` (waktu panggilan, informasi
    diagnosis) tidak ikut di-hash, jadi hash bundel lama tetap sah."""
    clean = [{k: v for k, v in c.items() if k != "seconds"} for c in calls]
    return sha256_hex(json.dumps(clean, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


_RANK = {"operations": 0, "debate:bull": 2, "debate:bear": 3, "debate:bull_rebut": 4, "debate:bear_rebut": 5, "pm": 6}


def _call_sort_key(c: dict) -> tuple:
    """Urutan stabil bukti: operations, desk (alfabet), pembuka bull/bear, bantahan, PM. Penting karena desk berjalan
    paralel dan selesai tidak berurutan, sedangkan `proofs_sha256` bergantung pada urutan."""
    label = str(c.get("label") or "")
    if label.startswith("desk:"):
        return (1, label)
    return (_RANK.get(label, 99), label)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _jwt_payload(token: str) -> dict:
    p = token.split(".")[1]
    p += "=" * (-len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p))


# ───────────────────────── preflight atestasi ─────────────────────────
def check_nvidia(payload: dict | str, nonce: str) -> tuple[bool, str]:
    """POST ke NVIDIA NRAS. Token JWT hasil di-decode TANPA verifikasi tanda tangan (sama dengan contoh resmi NEAR)."""
    try:
        body = json.loads(payload) if isinstance(payload, str) else payload
        if str(body.get("nonce", "")).lower() != nonce.lower():
            return False, "nvidia_payload_nonce_mismatch"
        r = requests.post(NRAS_URL, json=body, timeout=60)
        r.raise_for_status()
        res = r.json()
        overall = next(x[1] for x in res if isinstance(x, list) and len(x) == 2 and x[0] == "JWT")
        claims = _jwt_payload(overall)
        if str(claims.get("x-nvidia-overall-att-result")).lower() != "true":
            return False, "nvidia_attestation_failed"
        if str(claims.get("eat_nonce", "")).lower() != nonce.lower():
            return False, "nvidia_eat_nonce_mismatch"
        return True, "ok"
    except Exception as e:  # noqa: BLE001
        return False, f"nvidia_error:{type(e).__name__}"


def preflight(model: str) -> dict:
    """Laporan atestasi dengan nonce segar. Wajib dipanggil SEBELUM panggilan LLM pertama siklus."""
    nonce = secrets.token_hex(32)
    out = {"nonce": nonce, "at": _now(), "report_sha256": None, "model_signers": [], "gateway_signer": None,
           "nonce_ok": False, "nvidia_ok": False, "ok": False, "reason": None}
    try:
        r = requests.get(f"{BASE}/attestation/report", timeout=60,
                         params={"model": model, "signing_algo": "ed25519", "nonce": nonce})
        r.raise_for_status()
        out["report_sha256"] = sha256_hex(r.content)
        rep = r.json()
        atts = rep.get("model_attestations") or []
        gw = rep.get("gateway_attestation") or {}
        if not atts:
            out["reason"] = "no_model_attestations"
            return out
        out["gateway_signer"] = gw.get("signing_address")
        out["model_signers"] = sorted({a["signing_address"].lower() for a in atts if a.get("signing_address")})
        nonces = [str(a.get("request_nonce", "")).lower() for a in atts] + [str(gw.get("request_nonce", "")).lower()]
        out["nonce_ok"] = all(n == nonce for n in nonces)
        if not out["nonce_ok"]:
            out["reason"] = "nonce_mismatch"
            return out
        results = [check_nvidia(a.get("nvidia_payload"), nonce) for a in atts]
        out["nvidia_ok"] = all(ok for ok, _ in results)
        if not out["nvidia_ok"]:
            out["reason"] = next(why for ok, why in results if not ok)
            return out
        out["ok"] = bool(out["model_signers"])
        if not out["ok"]:
            out["reason"] = "no_signing_address"
    except Exception as e:  # noqa: BLE001
        out["reason"] = f"preflight_error:{type(e).__name__}"
    return out


# ───────────────────────── tanda tangan ─────────────────────────
def fetch_signature(chat_id: str, model: str, key: str) -> tuple[dict | None, str | None]:
    """Ambil tanda tangan untuk satu chat_id. Kembali (data, alasan_gagal)."""
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    use_model = True
    for attempt in range(SIG_RETRIES):
        try:
            params = {"signing_algo": "ed25519"}
            if use_model:
                params["model"] = model
            r = requests.get(f"{BASE}/signature/{chat_id}", headers=headers, params=params, timeout=30)
            if r.status_code == 400 and use_model:
                use_model = False                         # dokumen resmi hanya menulis signing_algo
                continue
            if r.status_code == 200:
                j = r.json()
                if j.get("signature") and j.get("text"):
                    return j, None
        except Exception:  # noqa: BLE001
            pass
        if attempt < SIG_RETRIES - 1:
            time.sleep(SIG_WAIT)
    return None, "signature_unavailable"


def verify_signature(sig: dict, model: str, request_sha256: str, response_sha256: str,
                     model_signers: list[str]) -> tuple[bool, str | None]:
    """Kembali (verified, alasan). Urutan cek mengikuti bagian 5.1.3."""
    if sig.get("signature_kind") not in (None, "provider_tee"):
        return False, "gateway_signature"
    if sig.get("signature_kind") is None:
        return False, "signature_kind_missing"
    if sig.get("text") != signature_text(model, request_sha256, response_sha256):
        return False, "text_mismatch"
    if str(sig.get("signing_algo", "")).lower() != "ed25519":
        return False, "algo_not_ed25519"
    try:
        from nacl.signing import VerifyKey
        pub, raw = bytes.fromhex(sig["signing_address"]), bytes.fromhex(sig["signature"])
        if len(pub) != 32 or len(raw) != 64:
            return False, "bad_key_or_signature_length"
        VerifyKey(pub).verify(sig["text"].encode("utf-8"), raw)
    except Exception:  # noqa: BLE001
        return False, "bad_signature"
    if str(sig["signing_address"]).lower() not in [s.lower() for s in model_signers]:
        return False, "signer_not_attested"
    return True, None


# ───────────────────────── biaya ─────────────────────────
def _price(model: str) -> tuple[float, float]:
    now = time.time()
    hit = _PRICE.get(model)
    if hit and now - hit[0] < PRICE_TTL:
        return hit[1]
    price = FALLBACK_PRICE
    try:
        j = requests.get(f"{BASE}/models", timeout=20).json()
        for m in j.get("data", []):
            if m.get("id") == model:
                p = m.get("pricing") or {}
                price = (float(p["prompt"]), float(p["completion"]))
                break
    except Exception:  # noqa: BLE001
        pass
    _PRICE[model] = (now, price)
    return price


def _load_spend() -> dict:
    global _SPEND
    if not _SPEND:
        try:
            from firm import state_store
            _SPEND = state_store.load(SPEND_KEY, None) or {}
        except Exception:  # noqa: BLE001
            _SPEND = {}
        _SPEND.setdefault("usd", 0.0)
        _SPEND.setdefault("since", _now())
    return _SPEND


def budget_usd() -> float:
    try:
        return float(os.environ.get("NEARAI_BUDGET_USD") or 8)
    except ValueError:
        return 8.0


def spend() -> dict:
    with _LOCK:
        s = dict(_load_spend())
    s["budget_usd"] = budget_usd()
    return s


def add_cost(usage: dict | None, model: str) -> float:
    """Tambah biaya satu panggilan ke total berjalan dan simpan. Kembali biaya panggilan (USD)."""
    u = usage or {}
    pin, pout = _price(model)
    cost = int(u.get("prompt_tokens") or 0) * pin + int(u.get("completion_tokens") or 0) * pout
    with _LOCK:
        s = _load_spend()
        s["usd"] = round(float(s["usd"]) + cost, 8)
        snap = dict(s)
    try:
        from firm import state_store
        state_store.save(SPEND_KEY, snap)
    except Exception:  # noqa: BLE001
        pass
    return cost


def mark_exhausted(seconds: int = 3600) -> None:
    global _EXHAUSTED_UNTIL
    _EXHAUSTED_UNTIL = time.time() + seconds


def available() -> bool:
    """False kalau batas biaya kode tercapai, atau API baru saja menolak karena saldo/batas."""
    if time.time() < _EXHAUSTED_UNTIL:
        return False
    with _LOCK:
        return float(_load_spend()["usd"]) < budget_usd()


# ───────────────────────── penampung per siklus ─────────────────────────
PRE_KEYS = ("nonce", "report_sha256", "model_signers", "gateway_signer", "nonce_ok", "nvidia_ok", "ok", "reason", "at")


def begin_cycle(model: str, asset: str = "", extra_models: tuple | list = ()) -> dict:
    """Buka penampung bukti untuk thread/konteks ini, lalu jalankan preflight.
    `extra_models`: model lain yang dipakai siklus ini (mis. model pembuka debat). Tiap model punya preflight sendiri
    (nonce segar) di `preflight["models"][model]`; tanda tangan dicek terhadap penanda tangan model-nya masing-masing."""
    pre = preflight(model)
    extras = {}
    for m in dict.fromkeys(x for x in extra_models if x and x != model):
        p = preflight(m)
        extras[m] = {k: p.get(k) for k in PRE_KEYS}
    if extras:
        pre["models"] = extras
    cid = f"{(asset or 'X').upper()}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    sink = {"cycle_id": cid, "asset": asset, "model": model, "preflight": pre, "calls": [], "pm_raw": None, "_key": None}
    _SINK.set(sink)
    return sink


def current() -> dict | None:
    return _SINK.get()


def record_call(label: str, model: str, body: bytes, raw: bytes, j: dict, key: str | None = None,
                seconds: float | None = None) -> None:
    sink = _SINK.get()
    if sink is None:
        return
    u = j.get("usage") or {}
    det = u.get("completion_tokens_details") or {}
    sink["_key"] = key or sink.get("_key")
    sink["calls"].append({
        "label": label, "provider": "nearai", "model": model, "chat_id": j.get("id"),
        "request_sha256": sha256_hex(body), "response_sha256": sha256_hex(raw),
        "signature": None, "signing_address": None, "signing_algo": "ed25519", "signature_kind": None,
        "verified": False, "reason": "pending", "seconds": None if seconds is None else round(float(seconds), 2),
        "usage": {"prompt_tokens": int(u.get("prompt_tokens") or 0),
                  "completion_tokens": int(u.get("completion_tokens") or 0),
                  "reasoning_tokens": int(det.get("reasoning_tokens") or 0)},
    })
    if label == "pm":                                  # A4: byte mentah hanya untuk PM
        sink["pm_raw"] = {"request_b64": base64.b64encode(body).decode(), "response_b64": base64.b64encode(raw).decode()}


def record_fallback(label: str, provider: str, model: str | None = None, error: str | None = None) -> None:
    """Catat panggilan yang pindah ke provider cadangan. `error` = alasan NEAR AI gagal (dipotong 160 huruf)."""
    sink = _SINK.get()
    if sink is None:
        return
    reason = f"fallback: {str(error)[:160]}" if error else "fallback"
    sink["calls"].append({"label": label, "provider": provider, "model": model, "verified": False, "reason": reason})


def end_cycle(sink: dict | None) -> dict | None:
    """Ambil dan verifikasi semua tanda tangan, tutup konteks, simpan bundel. Tidak melempar error."""
    if sink is None:
        return None
    try:
        pre, key = sink["preflight"], sink.get("_key") or _first_key()
        for c in sink["calls"]:
            if c.get("provider") != "nearai":
                continue
            ppre = pre if c.get("model") == sink["model"] else (pre.get("models") or {}).get(c.get("model"))                 or {"ok": False, "reason": "no_preflight_for_model"}
            signers = ppre.get("model_signers") or []
            if not ppre.get("ok"):
                c["reason"] = f"preflight_failed:{ppre.get('reason')}"
                continue
            if not (key and c.get("chat_id")):
                c["reason"] = "signature_unavailable"
                continue
            sig, why = fetch_signature(c["chat_id"], c["model"], key)
            if sig is None:
                c["reason"] = why
                continue
            c.update(signature=sig.get("signature"), signing_address=sig.get("signing_address"),
                     signing_algo=sig.get("signing_algo", "ed25519"), signature_kind=sig.get("signature_kind"))
            c["verified"], c["reason"] = verify_signature(sig, c["model"], c["request_sha256"], c["response_sha256"], signers)
        sink["calls"].sort(key=_call_sort_key)
        calls = sink["calls"]
        bundle = {
            "cycle_id": sink["cycle_id"], "asset": sink.get("asset"), "model": sink["model"], "at": _now(),
            "preflight": {**{k: pre.get(k) for k in PRE_KEYS}, **({"models": pre["models"]} if pre.get("models") else {})},
            "calls": calls, "pm_raw": sink.get("pm_raw"),
            "n_calls": len(calls), "n_verified": sum(1 for c in calls if c.get("verified")),
            "cost_usd": round(sum(_call_cost(c) for c in calls), 6),
            "proofs_sha256": proofs_digest(calls),
        }
        _store(bundle)
        return bundle
    except Exception as e:  # noqa: BLE001
        return {"cycle_id": sink.get("cycle_id"), "error": f"end_cycle:{type(e).__name__}", "n_calls": 0, "n_verified": 0}
    finally:
        _SINK.set(None)


def _first_key() -> str | None:
    try:
        from firm.llm_client import _collect_keys
        k = _collect_keys("NEARAI_API_KEY")
        return k[0] if k else None
    except Exception:  # noqa: BLE001
        return None


def _call_cost(c: dict) -> float:
    u = c.get("usage") or {}
    pin, pout = _price(c.get("model") or "")
    return int(u.get("prompt_tokens") or 0) * pin + int(u.get("completion_tokens") or 0) * pout


def _store(bundle: dict) -> None:
    """Simpan ke memori (50 terakhir), file JSONL, dan state_store (kunci tee:last)."""
    with _LOCK:
        _RECENT.append(bundle)
        del _RECENT[:-50]
    try:
        PROOFS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with PROOFS_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:  # noqa: BLE001
        pass
    try:   # persisten: Railway menghapus file dan memori saat deploy, jadi tiap bundel disimpan per siklus
        from firm import state_store
        state_store.save("tee:last", bundle)
        state_store.save(CYCLE_KEY + str(bundle.get("cycle_id")), bundle)
        idx = state_store.load(INDEX_KEY, None)
        idx = [r for r in (idx if isinstance(idx, list) else []) if r.get("cycle_id") != bundle.get("cycle_id")]
        idx.append({**summary(bundle), "asset": bundle.get("asset"), "at": bundle.get("at")})
        state_store.save(INDEX_KEY, idx[-INDEX_MAX:])
    except Exception:  # noqa: BLE001
        pass


def attach(analysts: dict, decision: dict | None, bundle: dict | None) -> None:
    """Tempel bukti ringkas ke hasil firm. Dipanggil SEBELUM `record_outputs`,
    jadi hash `{"asset","desk","output"}` otomatis mencakup bukti (rumus hash tidak berubah). Tidak melempar."""
    if not bundle or "error" in bundle:
        return
    try:
        for c in bundle.get("calls", []):
            label = str(c.get("label") or "")
            if label.startswith("desk:") and isinstance(analysts.get(label[5:]), dict):
                t = {"chat_id": c.get("chat_id"), "signing_address": c.get("signing_address"),
                     "signature": c.get("signature"), "verified": bool(c.get("verified"))}
                if not c.get("verified"):
                    t["reason"] = c.get("reason")
                analysts[label[5:]]["tee"] = t
        if isinstance(decision, dict):
            decision["tee"] = summary(bundle)
    except Exception:  # noqa: BLE001
        pass


def _file_bundles(limit: int = 200) -> list[dict]:
    """Bundel dari file JSONL (terbaru di akhir). Baris rusak dilewati."""
    try:
        lines = PROOFS_FILE.read_text(encoding="utf-8").splitlines()[-limit:]
    except OSError:
        return []
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out


def all_bundles() -> list[dict]:
    """Semua bundel yang diketahui, terbaru dulu, tanpa duplikat: memori, lalu file, lalu `state_store` (tee:last)."""
    with _LOCK:
        mem = list(_RECENT)
    seen, out = set(), []
    for b in list(reversed(mem)) + list(reversed(_file_bundles())):
        if b.get("cycle_id") and b["cycle_id"] not in seen:
            seen.add(b["cycle_id"])
            out.append(b)
    try:
        from firm import state_store
        last = state_store.load("tee:last", None)
        if isinstance(last, dict) and last.get("cycle_id") and last["cycle_id"] not in seen:
            out.append(last)
    except Exception:  # noqa: BLE001
        pass
    return out


def listing(limit: int = 20) -> list[dict]:
    """Daftar ringkas untuk `GET /tee`, terbaru dulu: bundel di memori/file, lalu indeks persisten (selamat dari deploy)."""
    rows, seen = [], set()
    for b in all_bundles():
        row = summary(b)
        row.update(asset=b.get("asset"), at=b.get("at"))
        rows.append(row)
        seen.add(row["cycle_id"])
    try:
        from firm import state_store
        idx = state_store.load(INDEX_KEY, None)
        for r in reversed(idx if isinstance(idx, list) else []):
            if r.get("cycle_id") and r["cycle_id"] not in seen:
                rows.append(r)
                seen.add(r["cycle_id"])
    except Exception:  # noqa: BLE001
        pass
    rows.sort(key=lambda r: str(r.get("at") or ""), reverse=True)
    return rows[:max(1, min(int(limit), 50))]


def get_bundle(cycle_id: str) -> dict | None:
    """Bundel lengkap satu siklus: memori/file dulu, lalu penyimpanan persisten per siklus."""
    if not isinstance(cycle_id, str) or not CYCLE_ID_RE.match(cycle_id):
        return None
    hit = next((b for b in all_bundles() if b.get("cycle_id") == cycle_id), None)
    if hit:
        return hit
    try:
        from firm import state_store
        b = state_store.load(CYCLE_KEY + cycle_id, None)
        return b if isinstance(b, dict) and b.get("cycle_id") == cycle_id else None
    except Exception:  # noqa: BLE001
        return None


def summary(bundle: dict) -> dict:
    """Ringkasan untuk keputusan (`decision["tee"]`) dan daftar endpoint."""
    return {"cycle_id": bundle.get("cycle_id"), "model": bundle.get("model"), "n_calls": bundle.get("n_calls"),
            "n_verified": bundle.get("n_verified"), "proofs_sha256": bundle.get("proofs_sha256"),
            "nonce": (bundle.get("preflight") or {}).get("nonce")}


def recent(limit: int = 20) -> list[dict]:
    with _LOCK:
        return list(reversed(_RECENT[-limit:]))
