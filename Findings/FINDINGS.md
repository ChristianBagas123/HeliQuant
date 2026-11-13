# 🔭 HeliQuant — Findings & Insights

> Honest, data-backed discoveries from building an autonomous trading-intelligence org on NEAR.
> **Every finding traces to a real run/probe.** We publish what DOESN'T work too — honesty is the product.

---

## On NEAR Smart Money & Whales

**1. The direction rule must come from the data, not from habit.** On Rhea's USDC / wNEAR pool the real
trade records label a trade `kind: "buy"` when `from_token` is `wrap.near` — that is a **sale of NEAR**.
Copying a `kind == "buy"` rule from another DEX would invert the sign of every flow. HeliQuant derives
direction from the token pair (`firm/sources/whale_indexer.py`: a trade from `wrap.near` is a sale of NEAR),
checked against real captured Rhea trades and the Rhea contract logs.

**2. The whale threshold decides whether there is a signal at all.** On real Rhea data captured
2026-11-09, **zero** trades passed a $10,000 floor (neutral, confidence 0). At $1,000, 27 trades passed
(bearish, −0.27). The main path (`whale_manager`) found 90 traders in 5 pools, kept 20 on the watchlist,
and read the cohort as **neutral**. We report what the data says instead of tuning until it says something.

**3. NEAR flow is concentrated.** In the sampled window the top 3 traders account for about 51% of volume
(`whale_methodology` in the On-chain/Risk desk output). So HeliQuant reads **aggregate cohort flow** and
treats it as lagged, unvalidated positioning context — never a timing trigger.

## On Alpha & Strategies — what's real, what isn't

**4. Accuracy ≠ profit.** The NEAR regime classifier (XGBoost, 4 classes, 4-hour forward label, 1-hour
bars, ~365 days) scores **78.9%** on the held-out test set (n = 1,113) against **76.1%** for "tomorrow looks
like today" — only **+2.8 points** — and **68.0% ± 5.2%** under cross-validation. That is a real but small
gain, and it is not a trading edge. The regime engine's job is **capital allocation and risk**, not price
prediction. (`models/regime_metadata.json`)

**5. We hunted an edge on NEAR — and earned none.** Under the cost-aware gate (non-overlapping 24-hour
trades, 20 bps round trip, out-of-sample):

| Hypothesis | OOS return | Trades | Avg per trade | Buy & hold |
|---|---|---|---|---|
| Funding fade | **−28.52%** | 32 | −91.1 bps | −22.72% |
| Price momentum | **−35.04%** | 80 | −36.7 bps | +62.62% |

Neither passed. `validated_edges.json` is empty, `60_self_learn.py` promotes and demotes nothing, and the
firm **ABSTAINS** on NEAR. (`data/onboarding_report.json`)

**6. Some hypotheses cannot be tested yet.** Bitget publishes only a *snapshot* of open interest, so the
OI column for NEAR is 0% filled, and funding covers only about 24% of 8,800 hourly bars (roughly the last
90 days). The OI-Contrarian desk therefore has no NEAR edge that can be validated, and we say so instead of
back-filling.

**7. ML earns its place like everything else.** Directional ML is just another hypothesis, judged by the
same cost-aware gate. A good regime classifier stays as an allocator; nothing is given a free pass for
being a model.

## On Execution & Risk

**8. A trade is a hypothesis with an invalidation — gated, not guessed.** Every decision becomes a ticket:
entry zone, a **structural stop**, an invalidation, a take-profit ladder, and a hard **R:R ≥ 2 gate**. The LLM
judges direction; deterministic code computes the numbers; the gate enforces safety. A model-side veto is
also enforced in code (see #12), not only in a prompt.

**9. Aggression is earned by data.** Sizing is SAFE by default (0.5–1.5% risk by conviction). It can move
to quarter-Kelly, capped at **3% risk per trade, 5× notional and a 20% drawdown breaker**, only when an
out-of-sample validated edge (≥ 20 trades) fires. With an empty registry on NEAR, that path cannot unlock.

**10. The demo exchange has a wide spread.** Three small NEAR round trips ($10) on Bitget Demo cost about
**0.27 USDT** — the demo book's spread, not a bug. Bitget also judges the 5 USDT minimum order at the
**demo** price, so order size is computed from the demo ticker, not the live one.

**11. The security veto fails closed.** Before a ticket, an ENTER is turned into ABSTAIN if the token
screen says no, or if the screen itself cannot run. The screen is an **internal on-chain check**, not a scam
database, and the honeypot field is reported as `unverified` rather than guessed. Assets with no NEAR
contract (BTC, ETH, XRP, SOL, HYPE, SUI) pass without a network call.

**12. A dry swap quote is information, not a price.** NEAR Intents' 1Click returned a route cost of 0.29%
against live Bitget on one sample, while an earlier measurement found a median of 0.135% (range 0.108–0.176%).
One sample proves nothing, so the quote is recorded as `intents_route_cost_pct` and never used as the
ledger price.

## On NEAR & Verifiability

**13. Verifiable on NEAR — the decision ledger, on-chain.** Each decision's hash is anchored with
`core.anchor` as a NEP-297 event, and each desk output is sealed with `record_output`. Only the executor
key can anchor, and a desk key can only record: the protocol rejects any other call.

**14. Storage is the real cost, and it is small.** One credential costs **157 bytes** of contract storage
(measured in the sandbox) and one job **423 bytes**. At the NEAR storage price that is about 0.0016 NEAR per
credential and 0.0042 NEAR per job, so sealing every desk every cycle stays cheap.

**15. Permissionless to enter, strict to leave.** Anyone may deposit mUSDC into a job; the contract
rejects bad deposits by return value and emits `job_rejected`, refunding in full. A failed payout never
traps funds: it becomes **claimable**, and the client collects with `claim_payout`. Stuck swaps are recovered
with `recover_job` and `reconcile_job`.

**16. An oracle relay has a freshness trade-off.** The `allora` contract rejects inferences older than
1,800 seconds. When Allora's own timestamp is older than that, the relayer submits the **current time**
instead (and prints a warning). So the on-chain timestamp shows when the relayer submitted, not when Allora
computed. The 8-hour topic is likely to hit this often, which is why we state it.

## On Method — the differentiator

**17. Honesty-by-design.** Deterministic tools compute; LLMs debate; the system rejects any strategy that
does not survive out-of-sample. A claim without a source file, test or measured run is deleted, not
reworded.

**18. A firm of AI agents, recorded on NEAR.** **Ten** real-source specialist desks — Regime ML · Macro
(Allora) · On-chain/Risk · Smart-Money (Nansen) · Smart-Social (Elfa) · Research · OI-Contrarian · Carry ·
NEAR-Fundamentals · TimesFM Vol/Risk — plus flow-intel and whale debate bull-vs-bear, then a Portfolio Manager
synthesizes a disciplined decision whose hash is anchored in a live NEAR transaction. The PM also signs off
(APPROVE / VETO) on every trade the floor proposes. When no validated edge applies, it *abstains* — and
that's a feature.

**19. A context signal is not a signal.** On 2026-11-09 DeFiLlama showed NEAR chain TVL of about $165M,
down 15.5% over 7 days and 28.2% over 30 days. The NEAR-Fundamentals desk gives a weak SHORT lean for
NEAR-ecosystem assets from that — as **advisory context**, flagged unvalidated, never a trade trigger.

---

> HeliQuant's edge isn't a magic indicator — it's rigor, multi-source integration, NEAR-native
> verifiability, and brutal honesty. Verified by real runs; auditable on-chain.
