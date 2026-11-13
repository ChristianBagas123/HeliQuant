/**
 * Pure helpers for the Hire flow (no imports, so they run under `node --test` too).
 *
 * Rules these encode:
 *  - `ft_transfer_call` that fails a business rule still SUCCEEDS: the core contract refunds the whole amount and
 *    emits `job_rejected` (no failed receipt, because wallets show an error for failed receipts). So the UI must read
 *    the events (or compare `jobs_by_client` before/after) — never trust "transaction ok".
 *  - `settle_job` needs a `min_out` taken from Rhea `get_return` with 1% tolerance, never below 1.
 *  - Rejecting a wallet request throws `User cancelled the action`, closing the popup `User closed the window`.
 */

export const TGAS = (n: number): string => `${n}000000000000`;
export const ONE_YOCTO = "1";
/** `storage_deposit` registration cost on a NEP-141 token (0.00125 NEAR). */
export const STORAGE_DEPOSIT = "1250000000000000000000";
export const GAS_CREATE_JOB = TGAS(100);
export const GAS_SETTLE_JOB = TGAS(300);
export const GAS_CLAIM = TGAS(50);
export const GAS_SIMPLE = TGAS(30);
export const SLIPPAGE_BPS = 100;

/** Parse a decimal string into integer base units. Null for empty, non-numeric, zero, or too many decimals. */
export function toUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [whole, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  const v = BigInt((whole || "0") + frac.padEnd(decimals, "0"));
  return v > BigInt(0) ? v : null;
}

/** Format base units as a plain decimal string (no grouping), trimming trailing zeros. */
export function fromUnits(value: bigint, decimals: number, maxFrac = decimals): string {
  const neg = value < BigInt(0);
  const abs = neg ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  frac = frac ? `.${frac}` : "";
  return `${neg ? "-" : ""}${whole.toString()}${frac}`;
}

/** `min_out` for `settle_job`: quote minus tolerance, never below 1. */
export function minOutFromQuote(quote: bigint, slippageBps: number = SLIPPAGE_BPS): bigint {
  const min = quote - (quote * BigInt(slippageBps)) / BigInt(10_000);
  return min > BigInt(1) ? min : BigInt(1);
}

export type ContractEvent = { event: string; data: Record<string, unknown> };

type OutcomeLike = {
  receipts_outcome?: { outcome?: { logs?: string[] } }[];
  transaction_outcome?: { outcome?: { logs?: string[] } };
};

/** All `EVENT_JSON:` events (standard `heliquant`) found in a transaction outcome. */
export function parseEvents(outcome: unknown): ContractEvent[] {
  const o = (outcome ?? {}) as OutcomeLike;
  const logs: string[] = [
    ...(o.transaction_outcome?.outcome?.logs ?? []),
    ...(o.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? []),
  ];
  const out: ContractEvent[] = [];
  for (const l of logs) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    try {
      const j = JSON.parse(l.slice("EVENT_JSON:".length)) as { standard?: string; event?: string; data?: unknown };
      if (j.standard !== "heliquant" || !j.event) continue;
      const arr = Array.isArray(j.data) ? j.data : [j.data];
      for (const d of arr) out.push({ event: j.event, data: (d ?? {}) as Record<string, unknown> });
    } catch {
      /* not JSON: ignore */
    }
  }
  return out;
}

export type HireResult =
  | { kind: "created"; jobId: string }
  | { kind: "rejected"; reason: string }
  | { kind: "unknown" };

/** Read the outcome of the job-creating `ft_transfer_call`. `unknown` = no event seen (check `jobs_by_client`). */
export function interpretHire(outcome: unknown): HireResult {
  const events = parseEvents(outcome);
  const rejected = events.find((e) => e.event === "job_rejected");
  if (rejected) return { kind: "rejected", reason: String(rejected.data.reason ?? "rejected") };
  const created = events.find((e) => e.event === "job_created");
  if (created) return { kind: "created", jobId: String(created.data.job_id ?? "") };
  return { kind: "unknown" };
}

/** Friendly text for a `job_rejected` reason (the strings come from the core contract). */
export function rejectionText(reason: string): string {
  const map: Record<string, string> = {
    "invalid msg": "The deposit message was invalid.",
    "duration must be greater than zero": "Choose a duration greater than zero.",
    "duration too large": "That duration is too long.",
    "perf fee above 3000 bps": "The performance fee is above the 30% maximum.",
    "base token not allowed": "That base token is not allowed.",
    "firm token not found": "The firm token does not exist on this deployment.",
    "token is not a Firm": "The configured token is not a Firm.",
    "amount must be greater than zero": "Enter an amount greater than zero.",
  };
  return `Job not created — your mUSDC was returned in full. ${map[reason] ?? reason}`;
}

export type WalletErrorKind = "cancelled" | "closed" | "other";

/** Classify wallet errors so the button can be re-enabled with a calm message. */
export function classifyWalletError(err: unknown): { kind: WalletErrorKind; message: string } {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/user cancelled/i.test(msg)) return { kind: "cancelled", message: "Request cancelled in the wallet." };
  if (/user closed/i.test(msg)) return { kind: "closed", message: "Wallet window closed before confirming." };
  const first = msg.split("\n").find((l) => l.trim()) ?? "Transaction failed";
  const t = first.replace(/\.$/, "").trim();
  return { kind: "other", message: t.length > 140 ? `${t.slice(0, 137)}…` : t };
}

/** Transaction hash from a wallet outcome, if present. */
export function txHashOf(outcome: unknown): string | undefined {
  const o = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | undefined;
  return o?.transaction?.hash ?? o?.transaction_outcome?.id;
}

/** True when any receipt of the outcome failed (so the UI never shows success for a failed receipt). */
export function hasFailure(outcome: unknown): boolean {
  const o = outcome as { status?: unknown; receipts_outcome?: { outcome?: { status?: unknown } }[] } | undefined;
  const bad = (s: unknown) => typeof s === "object" && s !== null && "Failure" in (s as object);
  return bad(o?.status) || (o?.receipts_outcome ?? []).some((r) => bad(r.outcome?.status));
}

/** Countdown to maturity from nanosecond timestamps. */
export function maturity(endNs: bigint, nowSec: number): { matured: boolean; text: string } {
  const remaining = Number(endNs / BigInt(1_000_000_000)) - nowSec;
  if (remaining <= 0) return { matured: true, text: "Matured" };
  const d = Math.floor(remaining / 86_400);
  const h = Math.floor((remaining % 86_400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  if (d > 0) return { matured: false, text: `${d}d ${h}h` };
  if (h > 0) return { matured: false, text: `${h}h ${m}m` };
  if (m > 0) return { matured: false, text: `${m}m ${s}s` };
  return { matured: false, text: `${s}s` };
}

/** Whether `account` looks like a NEAR account id (named, or 64-hex implicit). */
export function isNearAccountId(a: string): boolean {
  if (a.length < 2 || a.length > 64) return false;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a);
}
