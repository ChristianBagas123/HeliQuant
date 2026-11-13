# HeliQuant — Backtest Report

> Every number below is from a **runnable script**. **Cost-aware** (20 bps
> round-trip fee+slippage), **out-of-sample**, **walk-forward**, **FDR-corrected**. No fabricated
> metrics — we publish what passes *and* what doesn't. Rigor over screenshots.

## Methodology (`firm/edge_lab.py`)
An edge is **EARNED** only if ALL hold: ROI > 0 · ROI > buy&hold · avg trade > round-trip fee (20 bps)
· ≥ 20 trades · p < 0.10 **Benjamini-Hochberg FDR-corrected** (kills best-of-N false positives) ·
walk-forward consistent (≥3 folds, majority > 0, trimmed-ex-best > 0).

---

## 🟡 Result — directional edge scan on NEAR (NONE EARNED)
`firm/edge_lab.py` via `scripts/59_onboard_asset.py NEAR` (cost-aware OOS + walk-forward + FDR; non-overlapping
24-hour trades, 20 bps round trip; perp data from Bitget, 8,800 hourly bars). Source: `data/onboarding_report.json`.

| Signal | edge | OOS ROI | p_win | trades | avg bps | buy & hold | passed | FDR |
|---|---|---|---|---|---|---|---|---|
| price_mom24 | price_momentum | **−35.04%** | 0.4875 | 80 | −36.7 | +62.62% | ❌ | ❌ |
| funding | funding_fade | **−28.52%** | 0.375 | 32 | −91.1 | −22.72% | ❌ | ❌ |

**EARNED: NONE.** The firm therefore **ABSTAINS**: no directional edge clears the cost-aware bar on NEAR.
Open-interest hypotheses were **not run**: Bitget publishes open interest only as a live snapshot (the OI column
is 0% filled), and funding covers about 24% of the 8,800 bars. `60_self_learn.py` promotes and demotes nothing.

## Reproducibility
| Script | What it validates |
|---|---|
| `scripts/59_onboard_asset.py NEAR` (`firm/edge_lab.py`) | cost-aware OOS + walk-forward + FDR edge scan |
| `scripts/bitget_paper_trade.py` | live Bitget-demo execution + log |

## Takeaway
**Disciplined:** no directional edge is forced — nothing cleared the gate on NEAR and the firm abstains.
**Honest:** we publish negatives. A trading firm's first job is not to lose money on edges that don't exist.

*Run on NEAR on 2026-11-09.*
