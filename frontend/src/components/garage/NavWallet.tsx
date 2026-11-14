"use client";

/**
 * NavWallet — the wallet control in the app navbar, on every page. Not connected: a "Connect wallet" button that
 * opens the NEAR wallet selector. Connected: the account name; a click opens a small menu with the full account,
 * its NearBlocks page, "Your pit" (/profile) and an explicit Disconnect. Closes on outside click and on Escape.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useNearWallet } from "near-connect-hooks";

import { nearblocksAccount } from "@/lib/contracts";
import { classifyWalletError } from "@/lib/hire-logic";

export default function NavWallet() {
  const { signedAccountId, signIn, signOut, loading } = useNearWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      const c = classifyWalletError(e);
      if (c.kind === "other") setErr(c.message); // a closed or cancelled popup is a normal outcome
    }
  }

  if (loading) {
    return (
      <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.16em] text-steel" aria-busy="true">
        wallet…
      </span>
    );
  }

  if (!signedAccountId) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => run(signIn)}
          className="gr-press whitespace-nowrap border-2 border-bone bg-chartreuse px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-pitch"
        >
          Connect<span className="hidden sm:inline"> wallet</span>
        </button>
        {err ? (
          <p className="absolute right-0 top-full mt-1 w-60 text-right font-mono text-[10px] text-signal2">{err}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[150px] items-center gap-2 border-2 border-bone/40 px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] text-bone transition-colors hover:border-chartreuse hover:text-chartreuse sm:max-w-[240px]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-chartreuse" aria-hidden />
        <span className="truncate">{signedAccountId}</span>
        <span className="shrink-0 text-[9px]" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 border-2 border-bone/25 bg-pitch p-3 shadow-[6px_6px_0_rgba(0,0,0,0.6)]"
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-steel">wallet · NEAR testnet</p>
          <p className="mt-1 break-all font-mono text-xs text-bone">{signedAccountId}</p>
          <div className="mt-3 flex flex-col gap-1">
            <a
              role="menuitem"
              href={nearblocksAccount(signedAccountId)}
              target="_blank"
              rel="noreferrer"
              className="py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-bone/70 hover:text-chartreuse"
            >
              View on NearBlocks ↗
            </a>
            <Link
              role="menuitem"
              href="/profile"
              onClick={() => setOpen(false)}
              className="py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-bone/70 hover:text-chartreuse"
            >
              Your pit →
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                void run(signOut);
              }}
              className="mt-1 border-2 border-signal2/60 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-signal2 hover:bg-signal2 hover:text-pitch"
            >
              Disconnect
            </button>
          </div>
          {err ? <p className="mt-2 font-mono text-[10px] text-signal2">{err}</p> : null}
        </div>
      )}
    </div>
  );
}
