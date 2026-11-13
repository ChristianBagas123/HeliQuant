/**
 * HeliQuant data layer — types + verified static content + the live decisions feed.
 * Every number here traces to a real run/probe (honesty-by-design). Sections import from here.
 */

import { NEAR_CORE, NEAR_TOKEN } from "./contracts";

// ───────────────────────────── types (mirror Supabase decisions_hq) ─────────────────────────────
export type TakeProfit = { label: string; price: number; rr: number; close_pct: number; basis?: string };

export type TradeTicket = {
  direction: "LONG" | "SHORT";
  conviction: string;
  entry: number;
  entry_range: [number, number];
  invalidation: number;
  stop_loss: number;
  stop_distance_atr: number;
  stop_basis: string;
  take_profit: TakeProfit[];
  mode: "SAFE" | "AGGRESSIVE" | string;
  risk_pct: number;
  effective_risk_pct?: number;
  notional_usd: number;
  position_size_pct: number;
  leverage: number;
  kelly_fraction_star?: number | null;
};

export type Decision = {
  id: number;
  ts: string;
  ticker: string;
  regime: string | null;
  decision: "ENTER" | "ABSTAIN" | string;
  direction: "LONG" | "SHORT" | "NONE" | string;
  confidence: string | null;
  entry: number | null;
  stop_loss: number | null;
  tp1: number | null;
  reasoning: string | null;
  ticket_json: TradeTicket | null;
  status: "open" | "resolved" | "abstain" | string;
  outcome: "TP" | "SL" | "TIMEOUT" | null;
  pnl_pct: number | null;
  exit_price: number | null;
  resolved_ts: string | null;
  created_at?: string;
  tx_hash?: string | null; // on-chain anchor (added later)
};

export type Finding = { n: number; theme: string; title: string; body: string; isNew?: boolean; tone?: "win" | "honest" | "neutral" };
export type Contract = { name: string; address: string };

// ───────────────────────────── on-chain (NEAR testnet) ─────────────────────────────
// Account names come from env (NEXT_PUBLIC_*), which are written from contracts/deployments/near_testnet.json.
// Nothing here is hard-coded to an older deployment. See lib/contracts.ts for explorer links.

/** Landing page of the firm on NEAR Agent Market. Empty until the listing is Live (set NEXT_PUBLIC_AGENT_MARKET_URL). */
export const AGENT_MARKET_URL = (process.env.NEXT_PUBLIC_AGENT_MARKET_URL ?? "").trim();
/** Executor account (an OutLayer custody wallet when set). Used to label its transactions in the ledger. */
export const EXECUTOR_ACCOUNT = (process.env.NEXT_PUBLIC_NEAR_EXECUTOR_ACCOUNT ?? "").trim();
export const ALLORA_CONTRACT = process.env.NEXT_PUBLIC_NEAR_ALLORA_CONTRACT ?? "";

/** The deployed contracts, from env. Empty values are dropped, so a missing env never renders a blank link. */
export const CONTRACTS: Contract[] = [
  { name: "core (identity · reputation · validation · jobs · vault · anchor)", address: NEAR_CORE },
  { name: "musdc (NEP-141 principal token, faucet)", address: NEAR_TOKEN },
  { name: "allora (prediction relay)", address: ALLORA_CONTRACT },
].filter((c) => c.address);

/**
 * First `core.anchor` call on testnet, made by the executor key during the deploy smoke test (2026-11-09). It is a
 * smoke-test record, NOT a trading decision — labeled that way on purpose. Verify on NearBlocks.
 */
export const FIRST_ANCHOR = {
  txHash: "HWo1NgDKkJNgpMd9oXHf6zPUZYEGtD8NNzimUfBAhgep",
  block: 276890553,
  kind: "decision",
  refId: "NEAR@2026-11-09 t4",
  note: "deploy smoke test",
  recordHash: "0xe29be6f6d1bcade812ad294da8761da15b89f03d2b8f05c9e13289a3b2a34e81",
};

// ───────────────────────────── the 12 desks (agents/data/agent_registry.json) ─────────────────────────────
export const DESKS = [
  { key: "Regime/Technical", blurb: "ML regime classifier + trend strength + dynamic R:R" },
  { key: "Macro (Allora)", blurb: "decentralised-AI macro — Allora BTC/ETH 8h price prediction" },
  { key: "On-chain/Risk", blurb: "whale watchlist health + internal NEAR token-security check" },
  { key: "Research", blurb: "external macro — Fear&Greed + global market via public APIs" },
  { key: "Smart-Money Flow", blurb: "perp positioning (OI / funding / long-short) + Nansen macro smart-money netflow" },
  { key: "Smart-Social", blurb: "narrative/mindshare via Elfa (smart accounts, not retail)" },
  { key: "OI-Contrarian", blurb: "fade perp OI extremes — acts only if the asset has a validated edge" },
  { key: "flow-intel", blurb: "self-learning flow-signal read; abstains when no flow signal predicts" },
  { key: "whale", blurb: "Rhea wNEAR pool trades from GeckoTerminal — direction from tokens, not `kind`" },
  { key: "Carry", blurb: "delta-neutral funding-carry yield — advisory, non-directional" },
  { key: "NEAR Fundamentals", blurb: "DeFiLlama NEAR chain TVL + fees + staking yields — ecosystem risk-on/off" },
  { key: "TimesFM Vol/Risk", blurb: "next-day realized-volatility forecast → risk-off stance + ticket vol-sizing" },
];

// ───────────────────────────── honest findings (each traces to a file, a test or a measured run) ─────────────────────────────
export const FINDINGS: Finding[] = [
  { n: 1, theme: "Alpha", title: "Accuracy ≠ profit", body: "The NEAR regime classifier scores 78.9% on its held-out test split against a 76.1% persistence baseline (+2.8 points; cross-validation 68.0% ± 5.2%). Reading the regime is not the same as making money: no tested NEAR edge clears costs. Source: agents/models/regime_metadata.json.", tone: "honest" },
  { n: 2, theme: "Alpha", title: "NEAR funding-fade fails the gate", body: "Cost-aware, non-overlapping 24h trades, thresholds from the training split only: −28.5% out-of-sample over 32 trades (37.5% win, −91 bps per trade) against −22.7% for buy-and-hold. Source: agents/data/onboarding_report.json.", tone: "honest" },
  { n: 3, theme: "Alpha", title: "NEAR price-momentum fails the gate", body: "−35.0% out-of-sample over 80 trades (48.8% win, −37 bps per trade) while buy-and-hold made +62.6%. Source: agents/data/onboarding_report.json.", tone: "honest" },
  { n: 4, theme: "Alpha", title: "The edge registry stays empty", body: "No hypothesis cleared OOS ROI > 0, > buy-and-hold, > 20 bps average, ≥ 20 trades, FDR and walk-forward. validated_edges.json is {} and the firm abstains on NEAR. We do not lower the gate to get a result.", tone: "win" },
  { n: 5, theme: "Data", title: "Open-interest edges cannot be tested on NEAR", body: "Bitget exposes only a live open-interest snapshot, and funding history covers about 24% of the 8,800 hourly bars. The OI-based hypotheses therefore were not run for NEAR; we say so instead of backfilling a series.", tone: "honest" },
  { n: 6, theme: "Smart Money", title: "Whale flow on NEAR is concentrated and thin", body: "Across the Rhea wNEAR pools the top-3 traders hold about 51% of volume (54% in USDC/wNEAR, 75% in ZEC/wNEAR). One GeckoTerminal request covers at most 300 trades, from about 13 minutes to 15 hours depending on the pool. At the $10,000 swap threshold no trade qualifies, so that tracker reads neutral. Source: agents/tests/fixtures/spike_S-12.json.", tone: "honest" },
  { n: 7, theme: "Data", title: "Direction comes from the tokens, not `kind`", body: "GeckoTerminal's `kind` is relative to the first token in the pool name. In a USDC/wNEAR pool `kind = sell` means the trader BOUGHT NEAR. Reading direction from the token addresses matched the Rhea contract logs in 10 of 10 checked trades. Source: agents/tests/test_whale_near.py (real Rhea fixture).", tone: "win" },
  { n: 8, theme: "Safety", title: "The security veto is internal — and honest about it", body: "There is no token-security (scam database) API for NEAR. The check reads the chain: full-access keys, the Rhea whitelist, holder concentration after removing infrastructure contracts (wNEAR looks 98.5% concentrated raw, 0.6% without them). Honeypot detection is unavailable and shown as `honeypot=unverified`; a locked contract is not necessarily safe. Source: agents/tests/fixtures/spike_S-11.json.", tone: "honest" },
  { n: 9, theme: "Execution", title: "A rejected hire refunds in full", body: "If the core contract rejects a deposit (bad duration, fee, base token…) the transfer still succeeds on chain: everything is returned and a `job_rejected` event is emitted. No failed receipt is left, because wallets show an error for one. The app reads that event instead of trusting 'success'. Source: contracts/tests/tests/job.rs, frontend/tests/hire-logic.test.ts.", tone: "win" },
  { n: 10, theme: "Execution", title: "Demo fills are proof of execution, not our PnL", body: "Bitget Demo prices NEAR with a wide bid-ask: across 10 round trips the buy filled a median +2.21% above the live price and the sell −0.07%, a round trip of about −2.23%. The official PnL stays the paper ledger at live prices; the demo fill only proves the order path. Source: measured Bitget Demo round trips.", tone: "honest" },
  { n: 11, theme: "Execution", title: "Tiny testnet pools punish size", body: "Swapping 40 mUSDC into the 18.5 mUSDC / 5 wNEAR testnet pool gave a price about 67% worse, so settlement asks the DEX for a quote and enforces a 1% minimum-out guard. Source: a measured swap on the Rhea testnet pool; guard in agents/scripts/executor_demo.py.", tone: "neutral" },
  { n: 12, theme: "Method", title: "Honesty-by-design", body: "Deterministic tools compute the numbers; LLM agents debate and decide; a hard security veto and the validated-edge gate sit outside the model. A number appears here only if a run in this repository produced it.", tone: "neutral" },
  { n: 13, theme: "Execution", title: "The firm can be hired per job on NEAR Agent Market", body: "A test run of the listing (job c333668b, brief \"Analyze NEAR\") was picked up at 16:36:51 UTC and delivered at 16:42:11 UTC on 2026-11-10: 5 min 20 s against the 10-minute SLA. The deliverable carries the decision (ABSTAIN), the core.anchor transaction and the TEE proofs. Source: market.near.ai job c333668b.", tone: "win" },
  { n: 14, theme: "Method", title: "Every LLM call of a cycle carries a TEE signature", body: "Cycle NEAR-20261110T163654Z: 16 of 16 calls verified (ed25519 signature over model, request hash and response hash, signer attested by the NEAR AI Cloud report), at about $0.0078 per cycle. A signature proves which model produced which answer from which input; it does not prove the market data was right. Source: agent GET /tee/NEAR-20261110T163654Z, checked with agents/scripts/verify_tee.py.", tone: "honest" },
];

// Live decisions feed lives in ./supabase (fetchDecisions) to keep this module server-safe.
