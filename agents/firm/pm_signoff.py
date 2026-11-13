"""firm/pm_signoff.py — lightweight LLM PM sign-off on a single floor trade candidate.

THE MERGE POINT. The floor (campaign.py) proposes a trade from its quantitative gates; this asks the
LLM Portfolio Manager to APPROVE or VETO it, fed the LIVE floor signals (fresh — NOT the org's stale
feature CSVs, which is why this also obsoletes the local ingest for the decision). It makes the LLM the
gatekeeper on EVERY trade without running the full ~13-call org cycle — just ONE call.

Fails OPEN (approve) on any error so a 429/outage never freezes the floor: the algo gates already vetted
the setup. Paper-stakes mandate: approve a coherent trend/flow setup; veto only on a CLEAR conflict.
Toggle with env PM_SIGNOFF (default on).
"""
from __future__ import annotations

import json
import os

SIGNOFF_SYS = (
    "You are the Portfolio Manager of an autonomous crypto trading firm. The quantitative floor wants to "
    "open a PAPER trade and needs your sign-off. You are given the LIVE market signals. APPROVE when the "
    "setup is coherent — the direction agrees with the live 1h trend/flow and is NOT fighting a clear daily "
    "trend, high-conviction smart-money, or an already-exhausted move. VETO only on a CLEAR conflict "
    "(counter-trend, whales strongly opposed, over-extended entry, contradictory signals). This is PAPER "
    "capital, so bias toward APPROVE on a clean setup — you are a risk gate, not a perfectionist. "
    'Reply with ONLY compact JSON: {"approve": true, "reason": "<=16 words"}'
)


def enabled() -> bool:
    """The merge is on by default; set PM_SIGNOFF=0 to fall back to pure-algo floor."""
    return os.environ.get("PM_SIGNOFF", "1").strip() in {"1", "true", "yes"}


def signoff(asset: str, direction: str, reasons: list, live: dict) -> dict:
    """Ask the LLM PM to approve/veto a candidate paper trade, fed LIVE floor signals. Returns
    {approve: bool, reason: str, model: str|None}. Fails OPEN (approve) on ANY error — the algo gates
    already vetted it, so an LLM outage must never freeze the floor."""
    try:
        from firm.llm_client import _env, complete
        user = (f"Proposed: {direction} {asset} (paper).\n"
                f"Floor reasons: {reasons}\n"
                f"LIVE signals: {json.dumps(live, default=str)[:550]}\n"
                "Approve or veto this paper trade?")
        kw: dict = {"max_tokens": 120}
        if (_env("HQ_PROVIDER") or "").lower() == "nearai":   # setup GLM final: anggaran reasoning 500, jawaban 900
            glm = (_env("NEARAI_DEBATE_MODEL") or "z-ai/glm-5.3-flash").strip()
            if glm.lower() not in {"same", "none", "-"}:
                kw = {"max_tokens": 900, "model": glm, "thinking_budget": int(_env("NEARAI_THINK_SIGNOFF") or 500)}
        txt, model = complete(SIGNOFF_SYS, user, expect_json=True, label="pm_signoff", **kw)
        obj = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
        return {"approve": bool(obj.get("approve", True)),
                "reason": str(obj.get("reason", ""))[:90], "model": model}
    except Exception:   # noqa: BLE001 — fail OPEN; never freeze the floor on an LLM hiccup
        return {"approve": True, "reason": "auto (PM unavailable)", "model": None}
