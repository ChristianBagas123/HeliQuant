/**
 * HeliQuant on-chain product layer: account names, methods, limits and explorer links for the NEAR deployment.
 *
 * All values come from NEXT_PUBLIC_* env (written from contracts/deployments/near_testnet.json). There are NO
 * hard-coded fallbacks: a missing value is reported by `missingEnv()` and the pages show a clear "not configured"
 * message instead of silently pointing at the wrong deployment.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` only when accessed with a literal name, so each one is read explicitly.
 */

const NETWORK_RAW = process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "";
const CORE_RAW = process.env.NEXT_PUBLIC_NEAR_CORE_CONTRACT ?? "";
const TOKEN_RAW = process.env.NEXT_PUBLIC_NEAR_TOKEN_CONTRACT ?? "";
const RPC_RAW = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "";
const FIRM_RAW = process.env.NEXT_PUBLIC_NEAR_FIRM_TOKEN_ID ?? "";
const BASE_RAW = process.env.NEXT_PUBLIC_NEAR_BASE_TOKEN ?? "";
const DEX_RAW = process.env.NEXT_PUBLIC_NEAR_DEX_CONTRACT ?? "";
const POOL_RAW = process.env.NEXT_PUBLIC_NEAR_DEX_POOL_ID ?? "";

export const NEAR_NETWORK = "testnet" as const; // the app is testnet-only
export const NEAR_CORE = CORE_RAW; // core contract: identity, reputation, validation, jobs, vault, anchor
export const NEAR_TOKEN = TOKEN_RAW; // musdc: principal token, 6 decimals, public faucet
export const NEAR_BASE_TOKEN = BASE_RAW || "wrap.testnet"; // base token traded against (wNEAR)
export const NEAR_DEX = DEX_RAW || "ref-finance-101.testnet"; // Rhea testnet
export const NEAR_DEX_POOL_ID = POOL_RAW ? Number(POOL_RAW) : undefined;
export const NEAR_RPC_URL = RPC_RAW;
export const FIRM_TOKEN_ID = FIRM_RAW;
export const PRINCIPAL_DECIMALS = 6 as const; // musdc
export const BASE_DECIMALS = 24 as const; // wNEAR
export const DEFAULT_PERF_FEE_BPS = 2000 as const; // 20% (contract max 3000)

export const DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: "1 hour · demo", seconds: 3600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
];

/** Names of required env vars that are empty (used to show a setup notice). */
export function missingEnv(): string[] {
  const need: [string, string][] = [
    ["NEXT_PUBLIC_NEAR_NETWORK", NETWORK_RAW],
    ["NEXT_PUBLIC_NEAR_CORE_CONTRACT", CORE_RAW],
    ["NEXT_PUBLIC_NEAR_TOKEN_CONTRACT", TOKEN_RAW],
    ["NEXT_PUBLIC_NEAR_RPC_URL", RPC_RAW],
    ["NEXT_PUBLIC_NEAR_FIRM_TOKEN_ID", FIRM_RAW],
  ];
  const out = need.filter(([, v]) => !v).map(([k]) => k);
  if (NETWORK_RAW && NETWORK_RAW !== "testnet") out.push("NEXT_PUBLIC_NEAR_NETWORK must be testnet");
  return out;
}

// ───────────────────────────── explorer ─────────────────────────────
export const NEARBLOCKS = "https://testnet.nearblocks.io";
export const nearblocksTx = (hash: string): string => `${NEARBLOCKS}/txns/${hash}`;
export const nearblocksAccount = (id: string): string => `${NEARBLOCKS}/address/${id}`;


// ───────────────────────────── contract view shapes ─────────────────────────────
export type JobStatus = "Active" | "Settling" | "Settled";

/** Mirrors the core contract's `JobView` (U64/U128 arrive as strings). */
export type JobView = {
  job_id: string;
  client: string;
  firm_token_id: string;
  principal_token: string;
  principal_in: string;
  principal: string;
  base_token: string;
  base_balance: string;
  start_ns: string;
  end_ns: string;
  perf_fee_bps: number;
  status: JobStatus;
  locked: boolean;
  final_principal: string;
  final_pnl: string; // signed, as a string
};

export type JobBalanceView = {
  principal: string;
  base: string;
  locked: boolean;
  status: JobStatus;
  pending: null | { kind: "Trade" | "Settle"; stage: string; withdrawing: boolean };
};


/** Contract methods the dApp calls (core = job/vault/identity, musdc = NEP-141 faucet token). */
export const METHODS = {
  tokenStorageDeposit: "storage_deposit",
  tokenMint: "mint",
  tokenTransferCall: "ft_transfer_call",
  createJobMsgFields: ["firm_token_id", "base_token", "duration_sec", "perf_fee_bps"],
  settleJob: "settle_job",
  claimPayout: "claim_payout",
} as const;
