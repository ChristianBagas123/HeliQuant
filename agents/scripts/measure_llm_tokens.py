"""Ukur pemakaian token satu siklus `run_organization`.

    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/measure_llm_tokens.py NEAR

Membungkus `llm_client._request` dan `llm_client._complete_one`, lalu mencatat tiap percobaan: pemanggil, model,
status, max_tokens, token masuk/keluar/reasoning, dan apakah jawabannya kosong. Keluaran JSON ditulis ke
`data/llm_tokens_<aset>.json` (terabaikan git) dan ringkasan dicetak. `AGENT_ONCHAIN=0` dipaksa supaya tidak ada
transaksi NEAR. Panggilan LLM tetap nyata dan memakai kuota provider.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["AGENT_ONCHAIN"] = "0"

from firm import llm_client as lc  # noqa: E402

ATTEMPTS: list[dict] = []
LOGICAL: list[dict] = []
_LOCK = threading.Lock()
_ORIG_REQUEST = lc._request
_ORIG_ONE = lc._complete_one


def _caller() -> str:
    """Fungsi pemanggil pertama di luar llm_client (mis. `run_organization` atau `deep`)."""
    f = sys._getframe(2)
    while f and Path(f.f_code.co_filename).name in ("llm_client.py", "measure_llm_tokens.py"):
        f = f.f_back
    if f is None:
        return "?"
    # `deep` hanya pembungkus: naik satu lagi supaya terlihat siapa yang memanggilnya
    if f.f_code.co_name == "deep" and f.f_back:
        f = f.f_back
    return f"{f.f_code.co_name}:{f.f_lineno}"


def _request(cfg, key, model, system, user, max_tokens, *extra):
    t0 = time.time()
    rec = {"caller": _caller(), "provider": cfg["name"], "model": model, "max_tokens": max_tokens,
           "status": None, "prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0, "empty": False}
    try:
        r = _ORIG_REQUEST(cfg, key, model, system, user, max_tokens, *extra)
    except Exception as e:  # noqa: BLE001
        rec["status"] = f"{type(e).__name__}"
        with _LOCK:
            ATTEMPTS.append(rec)
        raise
    rec["status"] = r.status_code
    rec["seconds"] = round(time.time() - t0, 2)
    try:
        j = r.json()
        u = j.get("usage") or {}
        rec["prompt_tokens"] = int(u.get("prompt_tokens") or u.get("input_tokens") or 0)
        rec["completion_tokens"] = int(u.get("completion_tokens") or u.get("output_tokens") or 0)
        rec["reasoning_tokens"] = int((u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0)
        if r.status_code == 200:
            msg = (j.get("choices") or [{}])[0]
            text = lc._extract(cfg, j) if "choices" in j else None
            rec["empty"] = not (isinstance(text, str) and text.strip())
            rec["finish_reason"] = msg.get("finish_reason")
    except Exception:  # noqa: BLE001
        pass
    with _LOCK:
        ATTEMPTS.append(rec)
    return r


def _complete_one(system, user, max_tokens, start, expect_json, provider, model, *extra):
    rec = {"caller": _caller(), "max_tokens": max_tokens, "ok": False}
    try:
        out = _ORIG_ONE(system, user, max_tokens, start, expect_json, provider, model, *extra)
        rec["ok"], rec["used"] = True, out[1]
        return out
    except Exception as e:  # noqa: BLE001
        rec["error"] = str(e)[:120]
        raise
    finally:
        with _LOCK:
            LOGICAL.append(rec)


lc._request = _request
lc._complete_one = _complete_one


def summarize() -> dict:
    ok = [a for a in ATTEMPTS if a["status"] == 200]
    return {
        "logical_calls": len(LOGICAL),
        "logical_failed": sum(1 for x in LOGICAL if not x["ok"]),
        "attempts": len(ATTEMPTS),
        "http_not_200": sum(1 for a in ATTEMPTS if a["status"] != 200),
        "empty_answers": sum(1 for a in ok if a["empty"]),
        "hit_max_tokens": sum(1 for a in ok if a.get("finish_reason") == "length"),
        "prompt_tokens": sum(a["prompt_tokens"] for a in ATTEMPTS),
        "completion_tokens": sum(a["completion_tokens"] for a in ATTEMPTS),
        "reasoning_tokens": sum(a["reasoning_tokens"] for a in ATTEMPTS),
    }


def main(argv: list[str]) -> int:
    asset = (argv[0] if argv else "NEAR").upper()
    from firm import organization as org
    print("provider:", lc.active_provider_info())
    res = org.run_organization(asset, verbose=False)
    s = summarize()
    desks = res.get("analysts") or {}
    unavailable = [d for d, v in desks.items() if isinstance(v, dict) and v.get("unavailable")]
    s["desks_total"], s["desks_unavailable"] = len(desks), unavailable
    t = res.get("tee")
    if t:
        s["tee"] = {"n_calls": t.get("n_calls"), "n_verified": t.get("n_verified"), "cost_usd": t.get("cost_usd"),
                    "preflight_ok": (t.get("preflight") or {}).get("ok"),
                    "unverified": [(c.get("label"), c.get("reason")) for c in t.get("calls", []) if not c.get("verified")]}
    out = ROOT / "data" / f"llm_tokens_{asset.lower()}.json"
    out.write_text(json.dumps({"asset": asset, "summary": s, "logical": LOGICAL, "attempts": ATTEMPTS},
                              indent=1, ensure_ascii=False), encoding="utf-8")
    (ROOT / "data" / f"llm_result_{asset.lower()}.json").write_text(
        json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")   # untuk menilai mutu jawaban
    print(json.dumps(s, indent=1, ensure_ascii=False))
    print("ditulis:", out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
