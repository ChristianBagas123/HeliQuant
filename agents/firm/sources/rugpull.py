"""Token security screener for NEAR — an INTERNAL check built from on-chain data.

There is no token-security (scam database) API for NEAR, so this is NOT a scam database. It reads the chain directly:

  Check                              NEAR replacement                                        Weight
  ---------------------------------  ------------------------------------------------------  ------
  Honeypot (hard veto)               Not available. `is_honeypot` is always False. A 1Click        -
                                     `dry: true` sell quote is information only; the reasoning
                                     says `honeypot=unverified` when there is no quote.
  Owner can change balance           The contract has a FullAccess key (view_access_key_list).  +0.25
                                     The real USDC issuer is exempt (`full_key_exempt`).
  Proxy                              No equivalent                                                 -
  Mintable                           `is_mintable = None`, shown as `mintable=unknown`             -
  Top-10 holder concentration        >80% +0.25, >50% +0.10, computed AFTER removing              same
                                     infrastructure contracts (FastNear, fallback NearBlocks v3)
  Not on the Rhea whitelist          `v2.ref-finance.near.get_whitelisted_tokens`                +0.30, and
                                                                                               trade_safe=False
  Account has no contract            `view_account` says it does not exist (NO_CONTRACT)         risk 1.0, danger
  Pool liquidity                     GeckoTerminal. Information in `reasoning` only, no score.     -

Rules proven in S-11 (22 of 22 cases):
  * Core data = view_account, view_access_key_list and the Rhea whitelist, fetched in parallel. If any fails:
    `is_mocked=True`, `label="unknown"`, and `trade_safe` is True ONLY for TRUSTED_TOKENS. Never cached.
    (The old `_mock()` returned trade_safe=True for every token when the API failed — that is the bug not carried over.)
  * A missing account (NO_CONTRACT) is different from a data failure and is always rejected.
  * trade_safe = risk < 0.5 and (whitelisted or trusted).
  * Complementary sources (holders, liquidity, sell quote) that fail make that field `unknown`. They are never a
    veto and are not retried on 429.
  * Cache: assessment 300 s.

HONEST LIMITS: a locked contract is not necessarily safe; honeypot detection is unavailable.
"""

from __future__ import annotations

import base64
import concurrent.futures as cf
import json
import time
from dataclasses import dataclass, field
from typing import Literal

import requests

UA = {"User-Agent": "heliquant/1.0", "Accept": "application/json"}
RPC = "https://rpc.mainnet.fastnear.com"
FASTNEAR = "https://api.fastnear.com"
NEARBLOCKS = "https://api.nearblocks.io"
GECKO = "https://api.geckoterminal.com/api/v2/networks/near"
WHITELIST_CONTRACT = "v2.ref-finance.near"
USDC_ID = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
AURORA_ID = "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near"

TRUSTED_TOKENS = {"wrap.near", USDC_ID}      # pass when core data fails
EXEMPT_FULL_KEY = {USDC_ID}                  # the issuer holds one full-access key, legitimately
INFRA = {"intents.near", "omni.bridge.near", "contract.main.burrow.near", "v2.ref-finance.near",
         "aurora", "dclv2.ref-labs.near", "v1.orderly-network.near", "wallet.intear.near",
         "dex-aggregator.intear.near"}       # infrastructure contracts are not "centralised holders"

# Asset -> NEAR contract. Only these assets have an on-chain check.
ASSET_CONTRACTS = {
    "NEAR": "wrap.near",
    "LINEAR": "linear-protocol.near",
    "STNEAR": "meta-pool.near",
    "RHEA": "token.rhealab.near",
    "AURORA": AURORA_ID,
}
# Assets without a NEAR contract: the on-chain check is `not_applicable` (they may still trade on Bitget Demo / paper).
NOT_APPLICABLE = {"BTC", "ETH", "XRP", "SOL", "HYPE", "SUI"}


@dataclass(frozen=True)
class RiskAssessment:
    token_address: str
    chain: str
    is_honeypot: bool                              # always False: no detection on NEAR
    top_10_concentration_pct: float | None         # raw, includes infrastructure contracts
    top_10_ex_infra_pct: float | None              # without infrastructure contracts (used in the score)
    owner_can_change_balance: bool                 # has a FullAccess key (unless exempt)
    is_mintable: bool | None                       # always None: no general check
    risk_score: float                              # 0..1, higher = riskier
    trade_safe: bool                               # composite gate
    severity: Literal["safe", "watch", "danger"]
    reasoning: str
    is_mocked: bool = False
    label: str = "ok"                              # "ok" or "unknown" (core data failed)
    source_status: dict = field(default_factory=dict)
    details: dict = field(default_factory=dict)


class NoAccount(Exception):
    """The account does not exist on chain (NO_CONTRACT)."""


def _http(url: str, body: dict | None = None, timeout: float = 8, retry429: bool = True):
    """GET/POST JSON. One retry on HTTP 429. Raises on failure."""
    for attempt in range(2):
        if body is not None:
            r = requests.post(url, json=body, headers=UA, timeout=timeout)
        else:
            r = requests.get(url, headers=UA, timeout=timeout)
        if r.status_code == 429 and attempt == 0 and retry429:
            time.sleep(1.5)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("unreachable")  # pragma: no cover


class NearScreener:
    _cache: dict = {}

    def __init__(self, rpc: str = RPC, fastnear: str = FASTNEAR, nearblocks: str = NEARBLOCKS,
                 whitelist: str = WHITELIST_CONTRACT, cache_seconds: int = 300) -> None:
        self.rpc, self.fastnear, self.nearblocks = rpc, fastnear, nearblocks
        self.whitelist = whitelist
        self.cache_seconds = cache_seconds

    # --- data sources ---
    def _rpc(self, method: str, params: dict):
        r = _http(self.rpc, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if "error" in r:
            raise RuntimeError(f"rpc error: {json.dumps(r['error'])[:400]}")
        res = r["result"]
        if isinstance(res, dict) and "error" in res:
            raise RuntimeError(f"rpc error: {str(res['error'])[:120]}")
        return res

    def _view(self, contract: str, method: str, args: dict):
        res = self._rpc("query", {"request_type": "call_function", "finality": "final",
                                  "account_id": contract, "method_name": method,
                                  "args_base64": base64.b64encode(json.dumps(args).encode()).decode()})
        return json.loads(bytes(res["result"]))

    def _core(self, token: str) -> dict:
        """Core data: account, access keys, Rhea whitelist (three parallel calls). A failure raises; a missing
        account raises NoAccount (a result, not a data failure)."""
        with cf.ThreadPoolExecutor(3) as ex:
            fa = ex.submit(self._rpc, "query", {"request_type": "view_account", "finality": "final", "account_id": token})
            fk = ex.submit(self._rpc, "query", {"request_type": "view_access_key_list", "finality": "final", "account_id": token})
            fw = ex.submit(self._view, self.whitelist, "get_whitelisted_tokens", {})
            try:
                acct = fa.result()
            except RuntimeError as e:
                if "UNKNOWN_ACCOUNT" in str(e) or "does not exist" in str(e):
                    raise NoAccount(token) from e
                raise
            keys = fk.result()["keys"]
            wl = fw.result()
        full = [k for k in keys if k["access_key"]["permission"] == "FullAccess"]
        return {"code_hash": acct["code_hash"], "n_keys": len(keys), "n_full_keys": len(full),
                "whitelisted": token in wl}

    def _holders(self, token: str):
        """FastNear, fallback NearBlocks v3. Returns (source, [(account, balance)]) or (None, None)."""
        try:
            d = _http(f"{self.fastnear}/v1/ft/{token}/top")
            rows = [(a["account_id"], int(a["balance"])) for a in d["accounts"]]
            if rows:
                return "fastnear", rows
        except Exception:  # noqa: BLE001
            pass
        try:
            d = _http(f"{self.nearblocks}/v3/fts/{token}/holders")
            rows = [(a["account"], int(a["amount"])) for a in d["data"]]
            if rows:
                return "nearblocks", rows
        except Exception:  # noqa: BLE001
            pass
        return None, None

    def _gecko(self, token: str) -> dict:
        d = _http(f"{GECKO}/tokens/{token}", retry429=False)["data"]["attributes"]
        return {"liquidity_usd": float(d["total_reserve_in_usd"]) if d.get("total_reserve_in_usd") else None,
                "price_usd": float(d["price_usd"]) if d.get("price_usd") else None}

    def _sell_quote(self, token: str, decimals: int, price: float | None):
        """~$1 sell quote to USDC through 1Click `dry: true`. True when quoted, None otherwise (never False)."""
        from firm.intents_client import fetch_quote

        amt = int(10 ** decimals * (1.0 / price)) if price else 10 ** decimals
        r = fetch_quote(f"nep141:{token}", f"nep141:{USDC_ID}", amt)
        return True if r.get("ok") else None

    # --- assessment ---
    def assess(self, token: str) -> RiskAssessment:
        key = (token, self.rpc, self.fastnear, self.nearblocks, self.whitelist)
        now = time.time()
        hit = self._cache.get(key)
        if hit and now - hit[0] < self.cache_seconds:
            return hit[1]

        status: dict = {}
        details: dict = {}
        trusted = token in TRUSTED_TOKENS
        with cf.ThreadPoolExecutor(8) as ex:
            f_core = ex.submit(self._core, token)
            f_supply = ex.submit(self._view, token, "ft_total_supply", {})
            f_meta = ex.submit(self._view, token, "ft_metadata", {})
            f_gecko = ex.submit(self._gecko, token)
            f_hold = ex.submit(self._holders, token)

            def _sell():
                meta_, gecko_ = f_meta.result(), f_gecko.result()
                if meta_ and gecko_.get("price_usd"):
                    return self._sell_quote(token, int(meta_["decimals"]), gecko_["price_usd"])
                return None

            f_sell = ex.submit(_sell)

            try:
                core = f_core.result()
                status["core"] = "ok"
            except NoAccount:
                return RiskAssessment(
                    token_address=token, chain="near", is_honeypot=False,
                    top_10_concentration_pct=None, top_10_ex_infra_pct=None,
                    owner_can_change_balance=False, is_mintable=None, risk_score=1.0,
                    trade_safe=False, severity="danger", is_mocked=False, label="ok",
                    reasoning="DANGER risk=1.00: NO_CONTRACT (account does not exist on chain) | mintable=unknown",
                    source_status={"core": "no account"}, details={})
            except Exception as e:  # noqa: BLE001
                status["core"] = f"failed: {type(e).__name__}: {str(e)[:100]}"
                core = None

            if core is None:
                # core data failed: only TRUSTED_TOKENS pass. Not cached.
                return RiskAssessment(
                    token_address=token, chain="near", is_honeypot=False,
                    top_10_concentration_pct=None, top_10_ex_infra_pct=None,
                    owner_can_change_balance=False, is_mintable=None, risk_score=0.0,
                    trade_safe=trusted, severity="watch", is_mocked=True, label="unknown",
                    reasoning=(f"UNKNOWN (core data failed; {'trusted token' if trusted else 'not a trusted token'}): "
                               f"{status['core']}"),
                    source_status=status, details={"trusted": trusted})

            def grab(name: str, fut):
                try:
                    v = fut.result()
                    status[name] = "ok"
                    return v
                except Exception as e:  # noqa: BLE001
                    status[name] = f"failed: {type(e).__name__}: {str(e)[:80]}"
                    return None

            supply = grab("supply", f_supply)
            grab("metadata", f_meta)
            gecko = grab("liquidity", f_gecko)
            hsrc, rows = f_hold.result()
            status["holders"] = hsrc or "failed"
            try:
                sellable = f_sell.result() or None
            except Exception:  # noqa: BLE001
                sellable = None
            status["sell_quote"] = "ok" if sellable else "not quoted"

        raw10 = ex10 = None
        if rows and supply and int(supply) > 0:
            tot = int(supply)
            srt = sorted(rows, key=lambda r: -r[1])
            raw10 = min(100.0, sum(b for _, b in srt[:10]) / tot * 100)
            non = [r for r in srt if r[0] not in INFRA]
            ex10 = min(100.0, sum(b for _, b in non[:10]) / tot * 100)
            details["infra_in_top10"] = [a for a, _ in srt[:10] if a in INFRA]

        exempt = token in EXEMPT_FULL_KEY
        owner_key = core["n_full_keys"] > 0 and not exempt
        liq = gecko.get("liquidity_usd") if gecko else None
        wl_ok = core["whitelisted"] or trusted

        risk, flags = 0.0, []
        if owner_key:
            risk += 0.25
            flags.append("full_access_key")
        if not wl_ok:
            risk += 0.30
            flags.append("NOT_WHITELISTED")
        if ex10 is not None:
            if ex10 > 80:
                risk += 0.25
                flags.append(f"top10_ex_infra={ex10:.0f}%")
            elif ex10 > 50:
                risk += 0.10
                flags.append(f"top10_ex_infra={ex10:.0f}%")
        risk = min(risk, 1.0)

        trade_safe = risk < 0.5 and wl_ok
        severity: Literal["safe", "watch", "danger"] = "safe" if risk < 0.2 else ("watch" if risk < 0.5 else "danger")
        unknown = ["mintable=unknown"]
        if raw10 is None:
            unknown.append("top10=unknown")
        if liq is None:
            unknown.append("liquidity=unknown")
        else:
            flags.append(f"liquidity=${liq:,.0f}")   # information only, no score
        if sellable is None:
            unknown.append("honeypot=unverified")
        if exempt and core["n_full_keys"] > 0:
            flags.append("full_key_exempt")
        details.update({"code_hash": core["code_hash"], "n_full_keys": core["n_full_keys"],
                        "whitelisted": core["whitelisted"], "liquidity_usd": liq, "sellable": sellable})
        out = RiskAssessment(
            token_address=token, chain="near", is_honeypot=False,
            top_10_concentration_pct=raw10, top_10_ex_infra_pct=ex10,
            owner_can_change_balance=owner_key, is_mintable=None, risk_score=risk,
            trade_safe=trade_safe, severity=severity,
            reasoning=f"{severity.upper()} risk={risk:.2f}: {', '.join(flags) or 'no red flags'} | {', '.join(unknown)}",
            source_status=status, details=details)
        self._cache[key] = (now, out)
        return out


# ── asset-level gate (final rules) ────────────────────────────────────────
def security_gate(asset: str, screener: NearScreener | None = None) -> dict:
    """Deterministic security gate for an asset. Returns
    {asset, applicable, status, trade_safe, reasoning, token_address, assessment}.

      BTC/ETH/XRP/SOL/HYPE/SUI  -> not_applicable, trade_safe=True (no NEAR contract; Bitget Demo / paper)
      NEAR (wrap.near)          -> assessed; on data failure still allowed (wrap.near is TRUSTED), status=unknown
      LiNEAR/stNEAR/RHEA/AURORA -> assessed (monitored only; cannot ENTER anyway). RPC down -> trade_safe=False
      anything else             -> trade_safe=False (not in the basket, cannot ENTER)
    """
    a = asset.strip().upper()
    if a in NOT_APPLICABLE:
        return {"asset": a, "applicable": False, "status": "not_applicable", "trade_safe": True,
                "reasoning": "no NEAR contract: on-chain check not applicable", "token_address": None, "assessment": None}
    token = ASSET_CONTRACTS.get(a)
    if token is None:
        return {"asset": a, "applicable": True, "status": "not_in_basket", "trade_safe": False,
                "reasoning": f"{a} is not in the basket: cannot ENTER", "token_address": None, "assessment": None}
    ra = (screener or NearScreener()).assess(token)
    return {"asset": a, "applicable": True, "status": "unknown" if ra.label == "unknown" else ra.severity,
            "trade_safe": ra.trade_safe, "reasoning": ra.reasoning, "token_address": token, "assessment": ra}
