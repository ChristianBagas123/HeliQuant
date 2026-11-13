"use client";

import { useState } from "react";
import { useNearWallet } from "near-connect-hooks";

import { classifyWalletError } from "@/lib/hire-logic";

/**
 * NEAR wallet button. The session restores after a reload but `loading` stays true for ~1.7 s (S-04), so the account
 * area waits for `loading === false` to avoid flashing "Connect". The full account name is shown (no truncation).
 */
export function ConnectWallet() {
  const { signedAccountId, signIn, signOut, loading } = useNearWallet();
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      const c = classifyWalletError(e);
      // a closed or cancelled popup is a normal outcome, not an error
      if (c.kind === "other") setErr(c.message);
    }
  }

  if (loading) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel" aria-busy="true">
        wallet…
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {signedAccountId ? (
        <button
          type="button"
          onClick={() => run(signOut)}
          title="Disconnect"
          className="max-w-[220px] truncate border border-bone/30 px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] text-bone transition-colors hover:border-chartreuse hover:text-chartreuse"
        >
          {signedAccountId}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => run(signIn)}
          className="border-2 border-bone bg-chartreuse px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-pitch"
        >
          Connect NEAR wallet
        </button>
      )}
      {err ? <span className="max-w-[260px] text-right font-mono text-[10px] text-signal2">{err}</span> : null}
    </div>
  );
}
