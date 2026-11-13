/**
 * Pure helpers for the TEE proof views (/proof and the TEE badge on /agents). No imports, so `node --test` loads them.
 * Shapes mirror the agent's GET /tee and GET /tee/{cycle_id}. Cryptographic verification stays in
 * agents/scripts/verify_tee.py; the browser only displays what the agent reports.
 */

export type TeeCall = {
  label: string;
  provider?: string;
  model?: string;
  chat_id?: string;
  signing_address?: string;
  verified?: boolean;
  reason?: string | null;
  seconds?: number | null;
};

export type TeePreflight = {
  nonce?: string;
  nonce_ok?: boolean;
  nvidia_ok?: boolean;
  ok?: boolean;
  reason?: string | null;
  at?: string;
};

export type TeeBundle = {
  cycle_id: string;
  asset?: string;
  at?: string;
  model?: string;
  n_calls?: number;
  n_verified?: number;
  proofs_sha256?: string;
  preflight?: TeePreflight;
  calls?: TeeCall[];
};

export type TeeSummary = {
  cycle_id: string;
  asset?: string;
  at?: string;
  model?: string;
  n_calls?: number;
  n_verified?: number;
  proofs_sha256?: string;
  nonce?: string;
};

/** Shorten a long hex string to `first6…last4` (full value stays in the title attribute). */
export function shortHex(h: string | undefined | null, head = 6, tail = 4): string {
  if (!h) return "—";
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** "16/16 verified" style text. Missing numbers render as "—". */
export function verifiedText(nVerified?: number, nCalls?: number): string {
  if (nVerified == null || nCalls == null) return "—";
  return `${nVerified}/${nCalls} verified`;
}

/** True only when every call of the cycle is verified (and there is at least one). */
export function allVerified(s: { n_verified?: number; n_calls?: number }): boolean {
  return (s.n_calls ?? 0) > 0 && s.n_verified === s.n_calls;
}

/**
 * Map a desk name to its call label in the bundle. Bundle labels look like `desk:Regime/Technical`;
 * the match is case-insensitive and ignores nothing else, so an unknown desk simply has no badge.
 */
export function deskCall(bundle: TeeBundle | null | undefined, desk: string): TeeCall | undefined {
  const want = `desk:${desk}`.toLowerCase();
  return bundle?.calls?.find((c) => c.label.toLowerCase() === want);
}

/** A desk gets the TEE badge only when its call in the latest cycle is verified. */
export function deskVerified(bundle: TeeBundle | null | undefined, desk: string): boolean {
  return deskCall(bundle, desk)?.verified === true;
}

/** Command a visitor can run to verify a cycle themselves. */
export function verifyCommand(agentUrl: string, cycleId: string): string {
  return `python agents/scripts/verify_tee.py --url ${agentUrl.replace(/\/+$/, "")}/tee/${cycleId}`;
}
