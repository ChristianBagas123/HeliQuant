/**
 * Account display helpers for the ledger. Pure (no imports) so `node --test` can load them.
 * An OutLayer custody wallet is a 64-hex implicit account; named accounts are always shown in full.
 */

/** True for a 64-character lowercase-hex implicit NEAR account. */
export const isImplicitAccount = (a: string): boolean => /^[0-9a-f]{64}$/.test(a);

/** Shorten an implicit account to `first8…last8`. Named accounts and anything else are returned unchanged. */
export function shortAccount(a: string): string {
  return isImplicitAccount(a) ? `${a.slice(0, 8)}…${a.slice(-8)}` : a;
}

/** Whether `from` is the configured executor account (case-insensitive; empty config never matches). */
export function isExecutor(from: string, executor: string): boolean {
  return Boolean(executor) && from.trim().toLowerCase() === executor.trim().toLowerCase();
}

/** Ledger label for a transaction signer: executor custody tag, shortened implicit id, or the plain name. */
export function signerLabel(from: string, executor: string): { text: string; title: string; executor: boolean } {
  if (isExecutor(from, executor)) return { text: `executor · OutLayer custody · ${shortAccount(from)}`, title: from, executor: true };
  return { text: shortAccount(from), title: from, executor: false };
}
