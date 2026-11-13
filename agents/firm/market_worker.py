"""firm/market_worker.py — HeliQuant sebagai agen self-hosted di NEAR Agent Market (market.near.ai).

Alur satu job (dokumen: https://docs.market.near.ai/list-your-agent.md):
  1. `GET /v1/agents/me/assignments` tiap MARKET_POLL_S detik.
  2. Baris `in_progress` diproses: `start` (kalau belum), pesan singkat ke pembeli.
  3. Brief diperlakukan sebagai DATA, bukan instruksi: yang diambil hanya SATU ticker dari `BASKET`.
     Teks brief tidak pernah diteruskan ke LLM.
  4. Satu analisis firm penuh untuk ticker itu (fungsi `analyze` disuntik oleh app.py).
  5. Keputusan di-anchor ke NEAR testnet (`core.anchor`, kind `decision`, ref `market:<assignment>`).
  6. `submit` deliverable Markdown: keputusan, tiket, suara desk, record kanonik, hash, dan tautan NearBlocks.

Token agen dibaca dari `AGENT_MARKET_TOKEN` (`aat_...`). Tanpa token, worker tidak jalan. Saklar
`MARKET_WORKER=0` mematikannya. Semua kegagalan ditangkap; worker tidak menghentikan siklus firm.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Callable

import requests

from firm import onchain_recorder as orc

BASKET = ["BTC", "ETH", "SOL", "HYPE", "SUI", "XRP", "NEAR"]
NAMES = {"BITCOIN": "BTC", "ETHEREUM": "ETH", "ETHER": "ETH", "SOLANA": "SOL", "HYPERLIQUID": "HYPE",
         "RIPPLE": "XRP"}
TIMEOUT_S = 30
MAX_ATTEMPTS = 3          # analisis gagal berturut-turut sebelum laporan gagal dikirim
RESUBMIT_GUARD_S = 300    # setelah submit, baris yang sama diabaikan selama ini
SUBMIT_RETRY_WAITS = (5, 10, 20, 30, 30, 30)   # jeda (detik) antar percobaan submit yang dibalas HTTP 429
MAX_POLL_DELAY_S = 300    # batas jeda polling setelah HTTP 429 beruntun


def base_url() -> str:
    return (os.environ.get("AGENT_MARKET_BASE") or "https://market.near.ai").rstrip("/")


def token() -> str:
    return (os.environ.get("AGENT_MARKET_TOKEN") or "").strip()


def enabled() -> bool:
    return os.environ.get("MARKET_WORKER", "1") != "0" and token().startswith("aat_")


def poll_seconds() -> int:
    try:
        return max(int(os.environ.get("MARKET_POLL_S", "60")), 15)
    except ValueError:
        return 60


# ---------------------------------------------------------------- HTTP
class MarketError(RuntimeError):
    pass


def api(method: str, path: str, body: dict | None = None) -> dict:
    """Satu panggilan REST dengan token agen. Melempar MarketError (tanpa isi token) kalau status bukan 2xx."""
    headers = {"Authorization": f"Bearer {token()}", "User-Agent": "HeliQuant-Agent/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    try:
        r = requests.request(method, base_url() + path, headers=headers,
                             data=json.dumps(body) if body is not None else None, timeout=TIMEOUT_S)
    except requests.RequestException as e:
        raise MarketError(f"{method} {path} -> {type(e).__name__}") from None
    if not 200 <= r.status_code < 300:
        hint = ""
        if r.status_code == 429:   # diagnosis batas laju: header yang relevan saja, tanpa token
            keep = ("retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "server", "cf-ray", "via")
            hint = " " + json.dumps({k: v for k, v in r.headers.items() if k.lower() in keep})
        raise MarketError(f"{method} {path} -> HTTP {r.status_code} {r.text[:200]}{hint}")
    return r.json() if r.text.strip() else {}


# ---------------------------------------------------------------- brief -> ticker
def parse_ticker(*texts: str) -> str | None:
    """Ticker BASKET pertama yang disebut (kata utuh, tanpa beda huruf besar/kecil), atau nama lengkapnya.
    Teks dibaca berurutan; teks pertama yang menyebut aset menang. None kalau tidak ada."""
    for text in texts:
        if not text:
            continue
        best: tuple[int, str] | None = None
        for word, sym in [(s, s) for s in BASKET] + list(NAMES.items()):
            m = re.search(rf"(?<![A-Za-z0-9]){re.escape(word)}(?![A-Za-z0-9])", text, re.I)
            if m and (best is None or m.start() < best[0]):
                best = (m.start(), sym)
        if best:
            return best[1]
    return None


# ---------------------------------------------------------------- deliverable
def _fmt(v) -> str:
    return "-" if v in (None, "") else str(v)


def _tee_section(b: dict | None) -> list[str]:
    """Bagian "TEE proof (NEAR AI Cloud)". Kosong kalau siklus tidak berjalan di NEAR AI Cloud."""
    if not b or "error" in b or not b.get("calls"):
        return []
    pre = b.get("preflight") or {}
    cid = b.get("cycle_id")
    base = (os.environ.get("AGENT_PUBLIC_URL") or "").rstrip("/")
    link = f"{base}/tee/{cid}" if base else f"GET /tee/{cid} on the HeliQuant agent"
    lines = ["", "## TEE proof (NEAR AI Cloud)", "",
             f"Model `{_fmt(b.get('model'))}` ran inside a hardware TEE. **{b.get('n_verified')} of {b.get('n_calls')}** "
             "LLM calls carry an ed25519 signature from the attested TEE key "
             "(`model:sha256(request):sha256(response)`).", "",
             f"- Attestation nonce (fresh per cycle): `{_fmt(pre.get('nonce'))}`",
             f"- NVIDIA GPU attestation: {'passed' if pre.get('nvidia_ok') else 'not passed'} · "
             f"nonce match: {'yes' if pre.get('nonce_ok') else 'no'}",
             f"- `proofs_sha256`: `{_fmt(b.get('proofs_sha256'))}`",
             f"- Full bundle: {link}",
             f"- Verify yourself: `python agents/scripts/verify_tee.py --url {base or '<agent>'}/tee/{cid}`", "",
             "| Call | Chat ID | TEE signer | Verified |", "|---|---|---|---|"]
    for c in b.get("calls", []):
        sig = str(c.get("signing_address") or "")
        ok = "yes" if c.get("verified") else f"no ({_fmt(c.get('reason'))})"
        lines.append(f"| {c.get('label')} | {_fmt(c.get('chat_id'))} | {(sig[:12] + '…') if sig else '-'} | {ok} |")
    lines += ["", "A TEE signature proves which model and exact input produced an answer. It does not prove that "
              "the market data fed to the model was correct."]
    return lines


def build_deliverable(ticker: str, res: dict, anchor: dict) -> str:
    dec = (res or {}).get("decision") or {}
    tk = dec.get("trade_ticket") or {}
    tp = (tk.get("take_profit") or [{}])[0].get("price") if tk else None
    lines = [
        f"# HeliQuant firm decision: {ticker}",
        "",
        f"**Decision:** {_fmt(dec.get('decision')).upper()} · **Direction:** {_fmt(dec.get('direction'))} · "
        f"**Confidence:** {_fmt(dec.get('confidence'))}",
        "",
        "## Trade ticket",
        "",
    ]
    if tk and tk.get("valid"):
        lines += ["| Entry | Stop loss | TP1 | Risk % | Mode |", "|---|---|---|---|---|",
                  f"| {_fmt(tk.get('entry'))} | {_fmt(tk.get('stop_loss'))} | {_fmt(tp)} | "
                  f"{_fmt(tk.get('risk_pct'))} | {_fmt(tk.get('mode'))} |"]
    else:
        lines.append("No ticket. The firm only issues a ticket that clears the risk gates (R:R ≥ 2 and a real "
                     "invalidation level).")
    reason = str(dec.get("reasoning") or dec.get("ticket_note") or "").strip()
    lines += ["", "## Reasoning", "", reason[:3000] or "-", "", "## Desk votes", "",
              "| Desk | Stance | Confidence | Key point |", "|---|---|---|---|"]
    for name, out in ((res or {}).get("analysts") or {}).items():
        out = out if isinstance(out, dict) else {}
        kp = str(out.get("key_point") or "").replace("|", "/").replace("\n", " ")[:200]
        lines.append(f"| {name} | {_fmt(out.get('stance'))} | {_fmt(out.get('confidence'))} | {kp or '-'} |")
    lines += _tee_section((res or {}).get("tee"))
    lines += ["", "## On-chain proof (NEAR testnet)", ""]
    if anchor.get("sent"):
        lines.append(f"Anchored with `core.anchor` (kind `decision`, ref `{anchor.get('ref_id')}`): "
                     f"[{anchor['tx_hash']}]({anchor['explorer']})")
    else:
        lines.append(f"Not anchored this time ({_fmt(anchor.get('error'))[:160]}). The hash below is still the "
                     "canonical fingerprint of this decision.")
    lines += ["", f"`record_hash` = `{anchor.get('record_hash')}` (SHA-256 of the canonical record below, "
              "keys sorted, compact JSON).", "", "```json",
              json.dumps(anchor.get("record") or {}, sort_keys=True, separators=(",", ":")), "```", "",
              "---", "Research output from an autonomous AI firm on testnet and paper data. Not financial advice."]
    return "\n".join(lines)


def unsupported_deliverable(brief_title: str) -> str:
    return "\n".join([
        "# No supported asset in the brief",
        "",
        f"HeliQuant analyzes one asset per job. Supported: {', '.join(BASKET)}.",
        "",
        "Request changes and name one of these assets (for example `NEAR`), and the firm will run a full "
        "analysis.",
        "",
        f"Brief title received: {brief_title[:120] or '-'}",
    ])


def failed_deliverable(ticker: str) -> str:
    return "\n".join([
        f"# Analysis for {ticker} could not finish",
        "",
        f"The firm tried {MAX_ATTEMPTS} times and a data or model provider kept failing. No decision was made "
        "and nothing was anchored.",
        "",
        "Request changes to try again later.",
    ])


# ---------------------------------------------------------------- anchor
def anchor_decision(decision: dict, ticker: str, assignment_id: str, *, send: bool = True) -> dict:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rec = orc.canonical_record(decision or {}, ticker, ts)
    h = orc.record_hash(rec)
    ref = f"market:{assignment_id}"
    out = {"record": rec, "record_hash": h, "ref_id": ref, "sent": False}
    if send:
        try:
            out.update(orc.send_anchor(h, "decision", ref))
        except Exception as e:  # noqa: BLE001 — anchoring is best-effort
            out["error"] = str(e)[:160]
    return out


# ---------------------------------------------------------------- worker
class Worker:
    """Satu proses polling. `analyze(ticker) -> dict` hasil `run_organization`. `on_decision` opsional."""

    def __init__(self, analyze: Callable[[str], dict], log: Callable[[str], None] = print,
                 on_decision: Callable[[str, dict, dict], None] | None = None, send_anchor: bool = True):
        self.analyze = analyze
        self.log = log
        self.on_decision = on_decision
        self.send_anchor = send_anchor
        self.recent: dict[str, float] = {}   # assignment -> waktu submit; cegah kirim dobel saat API tertinggal
        self.pending: dict[str, str] = {}    # assignment -> deliverable yang sudah jadi tetapi submit-nya gagal
        self.consec_429 = 0                  # polling GET yang dibalas 429 berturut-turut
        self.attempts: dict[str, int] = {}
        self.stats = {"polls": 0, "submitted": 0, "errors": 0, "last_error": None, "last_poll_utc": None}

    def _submit(self, aid: str, markdown: str) -> None:
        """Kirim deliverable. HTTP 429 (batas laju market.near.ai terhadap IP Railway) dicoba ulang dengan jeda
        bertahap; error lain langsung dilempar."""
        for i, wait in enumerate((0,) + SUBMIT_RETRY_WAITS):
            if wait:
                time.sleep(wait)
            try:
                api("POST", f"/v1/assignments/{aid}/submit", {"deliverableMarkdown": markdown})
                break
            except MarketError as e:
                if "HTTP 429" not in str(e) or i == len(SUBMIT_RETRY_WAITS):
                    raise
        self.recent[aid] = time.time()
        self.attempts.pop(aid, None)
        self.stats["submitted"] += 1

    def _note_error(self, msg: str) -> None:
        self.stats["errors"] += 1
        self.stats["last_error"] = msg[:200]
        self.log(f"[market] {msg[:200]}")

    def handle(self, row: dict) -> bool:
        """Proses satu baris assignment. True kalau deliverable terkirim."""
        a = row.get("assignment") or {}
        job = row.get("job") or {}
        aid = str(a.get("assignmentId") or "")
        if not aid or a.get("status") != "in_progress":
            return False
        if time.time() - self.recent.get(aid, 0) < RESUBMIT_GUARD_S:
            return False
        if aid in self.pending:   # analisis dan anchor sudah selesai, hanya submit yang gagal: kirim ulang tanpa analisis
            self._submit(aid, self.pending[aid])
            self.pending.pop(aid, None)
            self.log(f"[market] {aid[:8]} deliverable tertunda berhasil dikirim")
            return True
        if not a.get("startedAt"):
            api("POST", f"/v1/assignments/{aid}/start")
        latest = row.get("latestMessage") or {}
        rework = latest.get("body") if latest.get("senderSide") == "buyer" else ""
        ticker = parse_ticker(rework or "", job.get("title") or "", job.get("description") or "")
        if not ticker:
            self._submit(aid, unsupported_deliverable(job.get("title") or ""))
            self.log(f"[market] {aid[:8]} brief tanpa aset yang didukung -> penjelasan dikirim")
            return True
        self.attempts[aid] = self.attempts.get(aid, 0) + 1
        if self.attempts[aid] > MAX_ATTEMPTS:
            self._submit(aid, failed_deliverable(ticker))
            self.log(f"[market] {aid[:8]} {ticker} gagal {MAX_ATTEMPTS} kali -> laporan gagal dikirim")
            return True
        try:
            api("POST", f"/v1/assignments/{aid}/messages",
                {"body": f"Started a full HeliQuant firm analysis for {ticker} (12 desks, debate, PM, risk gates). "
                         f"The decision will be anchored on NEAR testnet."})
        except MarketError as e:  # pesan hanya informasi
            self.log(f"[market] pesan gagal: {e}")
        self.log(f"[market] {aid[:8]} analisis {ticker}")
        res = self.analyze(ticker) or {}
        dec = res.get("decision") or {}
        anc = anchor_decision(dec, ticker, aid, send=self.send_anchor)
        md = build_deliverable(ticker, res, anc)
        self.pending[aid] = md      # simpan dulu: kalau submit gagal, analisis (dan anchor) tidak diulang
        self._submit(aid, md)
        self.pending.pop(aid, None)
        self.log(f"[market] {aid[:8]} {ticker} {str(dec.get('decision', '?')).upper()} terkirim"
                 + (f" · anchor {anc['tx_hash'][:12]}..." if anc.get("sent") else ""))
        if self.on_decision:
            self.on_decision(ticker, dec, anc)
        return True

    def poll_once(self) -> int:
        self.stats["polls"] += 1
        self.stats["last_poll_utc"] = datetime.now(timezone.utc).isoformat()
        try:
            rows = api("GET", "/v1/agents/me/assignments").get("assignments") or []
        except MarketError as e:
            self.consec_429 = self.consec_429 + 1 if "HTTP 429" in str(e) else 0
            self._note_error(str(e))
            return 0
        self.consec_429 = 0
        n = 0
        for row in rows:
            try:
                n += 1 if self.handle(row) else 0
            except Exception as e:  # noqa: BLE001 — satu job gagal tidak menghentikan job lain
                self._note_error(f"job {str((row.get('assignment') or {}).get('assignmentId'))[:8]}: {e}")
        return n

    def next_delay(self) -> float:
        """Jeda sebelum polling berikutnya: normal, atau berlipat (maks 5 menit) setelah 429 beruntun."""
        return min(poll_seconds() * (2 ** min(self.consec_429, 3)), MAX_POLL_DELAY_S)

    def run_forever(self, stop: threading.Event | None = None) -> None:
        self.log(f"[market] worker aktif · {base_url()} · polling {poll_seconds()} detik")
        while not (stop and stop.is_set()):
            self.poll_once()
            time.sleep(self.next_delay())
