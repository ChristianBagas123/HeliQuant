# HeliQuant 🦅 — Autonomous AI Trading Firm

> Python ML + **autonomous multi-agent firm** for **HeliQuant** — the all-seeing quant — on **NEAR**.

An autonomous *firm* (not a bot): **10 specialist desks** (+ flow-intel & whale = **12 analyst voices**) debate
bull-vs-bear → one **Portfolio-Manager** decision → **risk-gated** (R:R ≥ 2:1, fractional-Kelly, vol-scaled,
drawdown-breaker) → **executed on Bitget demo futures** (long **and** short) → **anchored on NEAR**. It
**abstains when no validated edge fires** — discipline over activity. We publish what doesn't work, too.

## Architecture — the autonomous firm
The brain is `firm/organization.py`. Each desk reads a different **real** source in parallel; desks debate
bull-vs-bear; the PM synthesises one disciplined decision; it's risk-gated, executed, and recorded.

```
RECALL → PLAN → DEBATE → PM DECISION → TICKET → EXECUTE → LEARN ↻
memory  10 desks  bull/bear  verdict     R:R≥2   Bitget    loop
```

**The 10 desks** (`build_desks`) — each a real source:

| Desk | Source | Module |
|---|---|---|
| Regime / Technical | XGBoost regime classifier (NEAR: **78.9%** vs **76.1%** persistence) | `firm/ml.py`, `firm/regime.py` |
| Macro (Allora) | Allora decentralised-AI inference (BTC/ETH 8h), read from the Allora chain via LCD (no key) | `firm/allora_client.py`, `firm/allora_lcd.py` |
| On-chain / Risk | Rhea whale flow + internal NEAR token-safety veto | `firm/whale_manager.py`, `firm/sources/rugpull.py` |
| Research | Fear & Greed + CoinGecko market APIs | `firm/sentiment_feeds.py` |
| Smart-Money Flow | perp positioning + Nansen netflow | `firm/smart_money.py`, `firm/nansen_client.py` |
| Smart-Social | Elfa narratives / mindshare | `firm/elfa_client.py` |
| OI-Contrarian | perp Open-Interest extremes | `firm/edge_lab.py` |
| Carry | delta-neutral funding-carry | `firm/carry_signal.py` |
| NEAR Fundamentals | DeFiLlama chain TVL / fees / staking | `firm/defillama_client.py` |
| TimesFM Vol/Risk | next-day realized-vol forecast: TimesFM 2.5 (200M) when `TIMESFM_URL` is set, EWMA fallback otherwise | `firm/timesfm_desk.py` |

(+ `flow-intel` self-learning + Hyperliquid `whale` desk → 12 analyst voices to the PM.)

## What's validated — and what isn't (honesty first)
| Claim | Status |
|---|---|
| **Regime classifier (NEAR)** | **78.9%** on a held-out test split (n = 1,113) vs **76.1%** persistence — a +2.8-point gain. Accuracy ≠ trading profit; its job is capital allocation + risk, not price prediction. |
| Directional edge scan | `firm/edge_lab.py` (cost-aware OOS + walk-forward + **Benjamini-Hochberg FDR**): **no directional edge earned on NEAR** — funding-fade −28.52% and price-momentum −35.04% out-of-sample after costs → the firm **ABSTAINS**. |
| OI-based hypotheses on NEAR | ⚠️ not testable: Bitget exposes open interest only as a live snapshot. |

> Sessions frequently fire **0 trades** (no validated edge) — a correct, disciplined **ABSTAIN**, not a bug.

## 🟦 Bitget integration
- `firm/bitget_adapter.py` — **Bitget v3 REST API** (HMAC-SHA256, `paptrading: 1` header), USDT futures on a
  UTA demo account: place/close market orders, positions, balances, one-way mode. **Verified long + short +
  flatten** on NEAR (no real funds).
- `scripts/bitget_paper_trade.py` — desk-driven decisions **executed on Bitget demo** → Bitget-format log
  (`data/bitget_paper_log.json`). Demo pairs: NEAR / BTC / ETH / XRP. Order size is computed from the **demo**
  ticker (the 5 USDT minimum is judged at the demo price).

## Self-learning — assets EARN their edge
A new asset must **earn** its edge; the firm sharpens by evidence, never by tweaking the gate.
`edge_lab` (cost-aware OOS + walk-forward + FDR) discovers/validates/**retires** edges → `validated_edges.json`
(live-eligible) vs `candidate_edges.json` (paper-until-graduated); desk-reliability weights are learned
(bounded, advisory); decision hashes are anchored on-chain (auditable proof, not a claim).

## Risk engine (`firm/trade_ticket.py`)
Entry zone · structural stop · separate invalidation · TP-ladder, behind a hard **R:R ≥ 2:1 gate**. SAFE by
default; AGGRESSIVE = fractional-Kelly (**≤3% risk / ≤5× leverage**), **20% drawdown breaker** — unlocked only
when a validated edge fires. Every ticket's risk is also scaled by the next-day volatility forecast (0.5–1.25×).
The LLM judges direction; deterministic
code computes the numbers; the gate enforces safety.

## Quickstart
```bash
python -m venv .venv
.venv/Scripts/activate            # Windows  (*nix: source .venv/bin/activate)
pip install -r requirements.txt
cp ../agents-LocalReady/.env.example ../.env   # the firm reads the project-root .env; add BITGET_*, GROQ_API_KEY, ...

python scripts/24_autonomous_org.py NEAR           # one pass: 10 desks → debate → PM → ticket
python scripts/bitget_paper_trade.py               # execute on Bitget demo + write Bitget-format log
python scripts/59_onboard_asset.py all --write     # edge-lab: earn an edge or abstain (OOS+WF+FDR)
```
📊 Backtest report: [`BACKTEST.md`](BACKTEST.md).

## LLM routing and TEE proofs

With `HQ_PROVIDER=nearai` the firm calls NEAR AI Cloud (TEE) and keeps an ed25519 signature per call
(`firm/tee.py`, `GET /tee`, `scripts/verify_tee.py`). Operations and the 10 desks use `Qwen/Qwen3.8-27B` with reasoning
off; debate, PM and `pm_signoff` use `z-ai/glm-5.3-flash` with reasoning capped by `thinking_token_budget`.
Details, env names and costs: `DEPLOY.md` ("LLM routing"). A TEE signature proves which model and exact input
produced an answer, not that the market data was correct.

## On-chain
Decisions are anchored on NEAR testnet (`core.anchor`, NEP-297 event), desk outputs are sealed with
`record_output`, and 13 agents are registered as soulbound NEP-171 tokens — auditable proof. Keys are limited
function-call keys. See `DEPLOY.md` and `firm/near_client.py`.

## Honest disclosures
- The headline is **rigor**, not a return. Measured on NEAR: the regime classifier (+2.8 points over persistence).
  No NEAR directional edge cleared the gate.
- Hypotheses that fail the cost-aware out-of-sample gate are reported, not hidden.

## License
MIT
