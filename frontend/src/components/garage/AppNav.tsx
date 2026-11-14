"use client";

/**
 * AppNav — the INTERNAL pit-lane nav (Night Garage), distinct from the landing GarageNav.
 * Once you're past the gate (wallet connected, inside the firm) the marketing anchors
 * (Engine / Dyno) no longer apply — this bar links ACROSS the functional bays instead,
 * highlights where you are, and collapses to a hamburger on narrow screens so no page is
 * ever reachable only by typing its route. Brand mark exits back to the landing site.
 */

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import NavWallet from "@/components/garage/NavWallet";
import { isOwnerEngine } from "@/lib/engine";

const LINKS = [
  { href: "/app", label: "The floor" },
  { href: "/campaign", label: "The grid" },
  { href: "/trade", label: "Your floor" },
  { href: "/carry", label: "The edge" },
  { href: "/learning", label: "Tuning bay" },
  { href: "/agents", label: "The crew" },
  { href: "/ledger", label: "Ledger" },
  { href: "/proof", label: "Proof" },
  { href: "/performance", label: "The dyno" },
  { href: "/whales", label: "Telemetry" },
  { href: "/assets", label: "Dyno bays" },
  { href: "/hire", label: "Hire" },
  { href: "/firms/heliquant", label: "License" },
  { href: "/profile", label: "Your pit" },
  { href: "/onboarding", label: "Register" },
];

function subscribeEngine(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
const readConnected = () => !isOwnerEngine();

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AppNav() {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  // connected = the user pointed the dApp at THEIR own engine (registered + connected). The server
  // snapshot is false (owner showcase) → no hydration drift; the client re-reads it on every render
  // (route changes included) and when another tab changes the engine.
  const connected = useSyncExternalStore(subscribeEngine, readConnected, () => false);

  // /campaign = owner showcase (only when NOT connected); /trade + /profile = your engine (only when connected)
  const visible = LINKS.filter((l) =>
    l.href === "/campaign" ? !connected : l.href === "/trade" || l.href === "/profile" ? connected : true,
  );

  return (
    <header className="sticky top-0 z-50 border-b-2 border-bone/15 bg-pitch/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:gap-6 sm:px-10 xl:px-8">
        {/* brand mark → exit back to the landing site · + the execution-venue mark */}
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/" className="flex items-center gap-3" aria-label="HeliQuant — back to site">
            <span className="gr-shadow-bone grid h-10 w-10 place-items-center border-2 border-pitch bg-bone p-1">
              <Image src="/brand/logo.png" alt="HeliQuant rotor mark" width={32} height={33} priority />
            </span>
            <span className="hidden font-display text-2xl font-extrabold uppercase tracking-wide text-bone sm:inline">
              Heli<span className="text-chartreuse">Quant</span>
            </span>
          </Link>
          <span
            title="Identity, jobs, vault and decision anchors live on NEAR testnet. Orders fill on Bitget Demo; PnL is paper."
            className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap border border-chartreuse/45 px-2 py-1 min-[1720px]:inline-flex"
          >
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-chartreuse">on NEAR testnet</span>
          </span>
        </div>

        {/* functional bays — active bay reads chartreuse */}
        <nav className="hidden min-w-0 items-center gap-x-4 min-[1440px]:flex min-[1720px]:gap-x-6">
          {visible.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                data-tour={l.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                  active ? "text-chartreuse" : "text-bone/65 hover:text-chartreuse"
                }`}
              >
                {active ? `▸ ${l.label}` : l.label}
              </Link>
            );
          })}
        </nav>

        {/* right: wallet (every page) · exit to the public site (wide desktop) · hamburger (mobile) */}
        <div className="flex shrink-0 items-center gap-3">
          <NavWallet />
          <Link
            href="/"
            className="gr-press hidden whitespace-nowrap border-2 border-bone/40 bg-transparent px-4 py-2 font-display text-sm font-bold uppercase tracking-wide text-bone min-[1720px]:inline-block"
          >
            View site
          </Link>
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 shrink-0 place-items-center border-2 border-bone/40 text-bone min-[1440px]:hidden"
          >
            <span className="font-mono text-lg leading-none">{open ? "✕" : "≡"}</span>
          </button>
        </div>
      </div>

      {/* mobile drawer — every bay reachable without typing a route */}
      {open && (
        <nav className="border-t-2 border-bone/15 bg-pitch/95 px-6 py-4 min-[1440px]:hidden">
          <ul className="flex flex-col gap-1">
            {visible.map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`block border-l-2 py-2 pl-3 font-mono text-xs uppercase tracking-[0.22em] ${
                      active
                        ? "border-chartreuse text-chartreuse"
                        : "border-bone/20 text-bone/70 hover:text-chartreuse"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
            <li className="mt-2">
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="block border-l-2 border-bone/20 py-2 pl-3 font-mono text-xs uppercase tracking-[0.22em] text-bone/50 hover:text-bone"
              >
                ← View site
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
