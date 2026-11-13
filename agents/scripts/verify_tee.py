"""Verifikasi bundel bukti TEE HeliQuant (NEAR AI Cloud) secara mandiri. Hanya butuh `requests` dan `pynacl`.

    python agents/scripts/verify_tee.py --url https://<agen>/tee/<cycle_id>
    python agents/scripts/verify_tee.py --file bundle.json [--fresh-attestation]

Yang dicek:
  1. `proofs_sha256` dihitung ulang dari `calls`.
  2. Tiap panggilan nearai: tanda tangan ed25519 atas `model:request_sha256:response_sha256`, dan penanda tangan
     ada di `preflight.model_signers` (kunci dari laporan atestasi siklus itu).
  3. `pm_raw`: sha256 byte request/response PM cocok dengan bukti `pm`; jawaban PM ditampilkan.
  4. `--fresh-attestation`: ambil laporan atestasi baru (nonce acak) dan cek penanda tangan masih ada di sana.
     Ini mengecek KUNCI, bukan instance: instance model yang sama berbagi satu kunci.
Keluar kode 0 kalau tidak ada FAIL. Panggilan cadangan (Groq) ditandai SKIP.

Tidak diverifikasi: quote Intel TDX, report_data, compose/mr_config, TLS, provenance image. Tanda tangan TEE
membuktikan model dan input persis yang menghasilkan jawaban, bukan kebenaran data pasar.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import sys

import requests

API = "https://cloud-api.near.ai/v1"
FAILS = 0


def say(status: str, msg: str) -> None:
    global FAILS
    if status == "FAIL":
        FAILS += 1
    print(f"[{status:<4}] {msg}")


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def proofs_digest(calls: list) -> str:
    clean = [{k: v for k, v in c.items() if k != "seconds"} for c in calls]   # `seconds` = diagnosis, tidak di-hash
    return sha256_hex(json.dumps(clean, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def verify_call(c: dict, signers: set[str]) -> tuple[bool, str]:
    from nacl.signing import VerifyKey
    try:
        text = f"{c['model']}:{c['request_sha256']}:{c['response_sha256']}".encode("utf-8")
        pub, sig = bytes.fromhex(c["signing_address"]), bytes.fromhex(c["signature"])
        if len(pub) != 32 or len(sig) != 64:
            return False, "panjang kunci/tanda tangan salah"
        VerifyKey(pub).verify(text, sig)
    except Exception as e:  # noqa: BLE001
        return False, f"tanda tangan tidak valid ({type(e).__name__})"
    if c["signing_address"].lower() not in signers:
        return False, "penanda tangan tidak ada di atestasi siklus"
    return True, "ok"


def load(args) -> dict:
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            return json.load(f)
    r = requests.get(args.url, timeout=60)
    r.raise_for_status()
    return r.json()


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--url")
    g.add_argument("--file")
    ap.add_argument("--fresh-attestation", action="store_true")
    args = ap.parse_args(argv)
    try:
        b = load(args)
    except Exception as e:  # noqa: BLE001
        print(f"gagal memuat bundel: {type(e).__name__}: {e}")
        return 2
    calls, pre = b.get("calls") or [], b.get("preflight") or {}
    def signers_for(model):
        src = pre if model == b.get("model") else (pre.get("models") or {}).get(model) or {}
        return {s.lower() for s in src.get("model_signers") or []}

    print(f"siklus {b.get('cycle_id')} · model {b.get('model')} · {len(calls)} panggilan")

    # 1. digest
    if proofs_digest(calls) == b.get("proofs_sha256"):
        say("OK", "proofs_sha256 cocok dengan isi calls")
    else:
        say("FAIL", "proofs_sha256 tidak cocok: calls diubah setelah dibuat")

    # preflight (hasil yang tercatat di bundel)
    say("OK" if pre.get("ok") else "FAIL",
        f"preflight {b.get('model')}: nonce_ok={pre.get('nonce_ok')} nvidia_ok={pre.get('nvidia_ok')} reason={pre.get('reason')}")
    for m, p in (pre.get("models") or {}).items():
        say("OK" if p.get("ok") else "FAIL",
            f"preflight {m}: nonce_ok={p.get('nonce_ok')} nvidia_ok={p.get('nvidia_ok')} reason={p.get('reason')}")

    # 2. tiap panggilan
    n_ok = 0
    for c in calls:
        label = c.get("label")
        if c.get("provider") != "nearai":
            say("SKIP", f"{label}: dijalankan di {c.get('provider')} (cadangan), tanpa bukti TEE")
            continue
        if not c.get("signature"):
            say("FAIL", f"{label}: tidak punya tanda tangan ({c.get('reason')})")
            continue
        ok, why = verify_call(c, signers_for(c.get("model")))
        n_ok += ok
        say("OK" if ok else "FAIL", f"{label}: {why} · chat_id {c.get('chat_id')}")
        if ok != bool(c.get("verified")):
            say("FAIL", f"{label}: flag verified di bundel ({c.get('verified')}) beda dari hasil cek ({ok})")
    if b.get("n_verified") != n_ok:
        say("FAIL", f"n_verified di bundel {b.get('n_verified')} beda dari hasil cek {n_ok}")

    # 3. byte mentah PM
    raw = b.get("pm_raw")
    pm = next((c for c in calls if c.get("label") == "pm" and c.get("provider") == "nearai"), None)
    if raw and pm:
        try:
            rq, rs = base64.b64decode(raw["request_b64"]), base64.b64decode(raw["response_b64"])
            same = sha256_hex(rq) == pm["request_sha256"] and sha256_hex(rs) == pm["response_sha256"]
            say("OK" if same else "FAIL", "pm_raw: sha256 byte request/response cocok dengan bukti pm" if same
                else "pm_raw: sha256 tidak cocok dengan bukti pm")
            if same:
                msg = json.loads(rs)["choices"][0]["message"].get("content") or ""
                print("       jawaban PM:", msg.strip().replace("\n", " ")[:400])
        except Exception as e:  # noqa: BLE001
            say("FAIL", f"pm_raw tidak bisa dibaca ({type(e).__name__})")
    else:
        say("SKIP", "pm_raw: tidak ada (PM berjalan di cadangan atau bundel tanpa PM)")

    # 4. atestasi baru
    if args.fresh_attestation:
        try:
            gone = []
            for m in sorted({c.get("model") for c in calls if c.get("signature")}):
                nonce = secrets.token_hex(32)
                rep = requests.get(f"{API}/attestation/report", timeout=60,
                                   params={"model": m, "signing_algo": "ed25519", "nonce": nonce}).json()
                now = {a.get("signing_address", "").lower() for a in rep.get("model_attestations") or []}
                gone += [s for s in {c.get("signing_address", "").lower() for c in calls
                                     if c.get("signature") and c.get("model") == m} if s not in now]
            say("OK" if not gone else "FAIL",
                "kunci penanda tangan masih ada di atestasi baru" if not gone
                else f"kunci tidak ada di atestasi baru: {gone}")
        except Exception as e:  # noqa: BLE001
            say("FAIL", f"atestasi baru gagal diambil ({type(e).__name__})")

    print("HASIL:", "SEMUA OK" if not FAILS else f"{FAILS} FAIL")
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
