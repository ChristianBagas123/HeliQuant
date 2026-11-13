/**
 * NEP-413 helpers for /register — must match agents/firm/nep413.py exactly.
 *
 * The wallet signs `registerMessage(account, credsSha256(creds))` for recipient `heliquant.engine` with a
 * one-time nonce from the engine (GET /register/nonce). Only the hash of the creds is signed, so key values
 * never appear in the wallet's signing window.
 */

/** sha256 hex of the creds as canonical JSON (keys sorted, no spaces) — same as creds_sha256() in Python. */
export async function credsSha256(creds: Record<string, string>): Promise<string> {
  const canon = JSON.stringify(Object.fromEntries(Object.keys(creds).sort().map((k) => [k, creds[k]])));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function registerMessage(accountId: string, credsHash: string): string {
  return `HeliQuant engine register\naccount: ${accountId}\ncreds_sha256: ${credsHash}`;
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Wallets return the signature as base64 (NEP-413) or bytes; the engine also accepts `ed25519:<base58>`. */
export function signatureToString(sig: unknown): string {
  if (typeof sig === "string") return sig;
  if (sig instanceof Uint8Array) return btoa(String.fromCharCode(...sig));
  throw new Error("wallet returned an unknown signature format");
}
