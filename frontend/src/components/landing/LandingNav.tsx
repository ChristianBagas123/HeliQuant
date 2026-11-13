"use client";

/**
 * LandingNav — pit-lane top bar for the landing only (GarageNav stays untouched for other pages).
 * Hides while scrolling down, returns on scroll up, and after the hero it tightens and its bone
 * border goes solid. The brand mark stays a sticker on a bone plate; the testnet badge stays.
 * Keyboard focus inside the bar always brings it back.
 */

import { useState } from "react";
import Image from "next/image";
import { useMotionValueEvent, useScroll } from "motion/react";

import { NAV_LINKS } from "./data";

export default function LandingNav() {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [compact, setCompact] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    const nextCompact = y > window.innerHeight * 0.7;
    const nextHidden = y > 240 && y > prev + 2 ? true : y < prev - 2 ? false : hidden;
    if (nextCompact !== compact) setCompact(nextCompact);
    if (nextHidden !== hidden) setHidden(nextHidden);
  });

  return (
    <header
      className={`ld-nav border-b-2 bg-pitch/95 ${compact ? "border-bone" : "border-bone/15"}`}
      data-hidden={hidden ? "" : undefined}
      data-compact={compact ? "" : undefined}
      onFocusCapture={() => setHidden(false)}
    >
      <div className="ld-nav-inner mx-auto flex max-w-[1280px] items-center justify-between px-6 py-3 sm:px-10 xl:px-4">
        <div className="flex items-center gap-3">
          <a href="#top" className="flex items-center gap-3" data-cursor-label="top">
            <span className="gr-shadow-bone grid h-10 w-10 place-items-center border-2 border-pitch bg-bone p-1">
              <Image src="/brand/logo.png" alt="HeliQuant rotor mark" width={32} height={33} priority />
            </span>
            <span className="font-display text-2xl font-extrabold uppercase tracking-wide text-bone">
              Heli<span className="text-chartreuse">Quant</span>
            </span>
          </a>
          <span
            title="Identity, jobs, vault and decision anchors live on NEAR testnet. Orders fill on Bitget Demo; PnL is paper."
            className="hidden items-center gap-1.5 border border-chartreuse/45 px-2 py-1 lg:inline-flex"
          >
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-chartreuse">on NEAR testnet</span>
          </span>
        </div>

        <nav className="hidden items-center gap-3 lg:flex xl:gap-7" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="ld-navlink font-mono text-[11px] uppercase tracking-[0.12em] text-bone/65 xl:tracking-[0.22em] transition-colors hover:text-chartreuse focus-visible:text-chartreuse">
              {l.label}
            </a>
          ))}
        </nav>

        <a href="/app" data-cursor="press" className="ld-press border-2 border-bone bg-chartreuse px-4 py-2 font-display text-sm font-bold uppercase tracking-wide text-pitch">
          Console
        </a>
      </div>
    </header>
  );
}
