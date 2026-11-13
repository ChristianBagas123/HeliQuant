/**
 * /firms/heliquant — "THE HOMOLOGATION PAPERS" (Night Garage §6.9)
 *
 * A racing team doesn't get on track by claiming it's fast — it gets HOMOLOGATED:
 * registered, scrutineered, bound by rules. This page is the firm's license: the chassis
 * plate (on-chain identity), the scrutineering stamps (the deployed NEAR contracts, every
 * account real and linked), the crew roster (twelve desks), the license conditions (the
 * honesty gates), and the service history (real milestones only).
 *
 * The license states what is true today: registry empty, firm in N, every
 * decision sealed.
 */

import BayShell from "@/components/garage/bay/BayShell";
import CopyButton from "@/components/garage/bay/CopyButton";
import { SectionHead, Stat, StatStrip } from "@/components/garage/bay/parts";
import { nearblocksAccount, nearblocksTx } from "@/lib/contracts";
import { CONTRACTS, FIRST_ANCHOR } from "@/lib/heliquant";

const CREW = [
  { role: "REGIME / TECHNICAL", duty: "reads the tape's state — trending, ranging or high volatility" },
  { role: "MACRO · ALLORA", duty: "decentralized AI inference as the macro read" },
  { role: "ON-CHAIN / RISK", duty: "Rhea pool whale flow, internal token-security veto" },
  { role: "SMART-MONEY FLOW", duty: "perp positioning: OI, funding, long/short" },
  { role: "RESEARCH", duty: "market mood: Fear & Greed + CoinGecko global market" },
  { role: "SMART-SOCIAL", duty: "narrative and mindshare of smart accounts" },
  { role: "OI-CONTRARIAN", duty: "crowd positioning extremes (acts only on a validated edge)" },
  { role: "FLOW-INTEL", duty: "self-learning which flow signals validate — FDR-gated" },
  { role: "WHALE TRACKER", duty: "Hyperliquid top-PnL wallets, per traded asset" },
  { role: "CARRY", duty: "delta-neutral funding carry — advisory" },
  { role: "NEAR FUNDAMENTALS", duty: "DeFiLlama chain TVL + fees — ecosystem risk-on/off" },
  { role: "TIMESFM VOL / RISK", duty: "volatility forecast, risk-off stance and ticket vol-sizing" },
];

const CONDITIONS = [
  "ENTER only on an edge that survives cost-aware OOS + anchored walk-forward + FDR",
  "no validated edge → ABSTAIN (the gearbox holds N) — restraint over fee donation",
  "every decision, including the abstain, is sealed on-chain on NEAR",
  "edges are re-tested on fresh data every cycle; decayed edges are retired",
  "failures are published — the scrap shelf is part of the product",
  "position sizing: quarter-Kelly, hard caps, drawdown breaker — never a full-send",
];

const HISTORY = [
  { date: "2026-11-09", event: "core, musdc and allora contracts deployed to NEAR testnet; 12 desks + the firm registered (tokens 1–13)" },
  { date: "2026-11-09", event: `first core.anchor on testnet — block ${FIRST_ANCHOR.block.toLocaleString("en-US")} (deploy smoke test, not a trading decision)` },
  { date: "2026-11-09", event: "buy and sell through Rhea testnet from the vault: trade path proven (job 1)" },
  { date: "2026-11-09", event: "NEAR long opened and closed on Bitget Demo from the agent code (API v3)" },
  { date: "2026-11-09", event: "NEAR regime classifier trained: 78.9% test accuracy vs 76.1% persistence" },
  { date: "2026-11-09", event: "edge lab on NEAR: funding-fade and price-momentum fail the gate; registry stays empty" },
  { date: "2026-11-09", event: "full firm run on NEAR: ABSTAIN — no validated edge" },
];

const v = (o: Record<string, string | number>) => o as React.CSSProperties;

function Check({ i = 0, className = "" }: { i?: number; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`bay-check h-4 w-4 shrink-0 ${className}`} style={v({ "--i": i })}>
      <path d="M3 10.5 L8 15 L17 5" pathLength={1} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" />
    </svg>
  );
}

export default function HeliQuantFirmPage() {
  return (
    <BayShell
      ornament="license"
      eyebrow="HOMOLOGATION · ON-CHAIN IDENTITY · NEAR"
      title={["Racing", "license"]}
      lead={
        <>
          A firm doesn&apos;t earn trust by claiming it&apos;s fast. It gets registered, scrutineered, and bound by rules it can&apos;t quietly break. All
          of it on-chain.
        </>
      }
      footer="HELIQUANT · HOMOLOGATED ON NEAR · the license is public, the rules are code"
    >
      <StatStrip className="mb-14">
        <Stat i={0} k="contracts deployed" v={`${CONTRACTS.length}`} sub="NEAR testnet · tap to verify" />
        <Stat i={1} k="registered agents" v="13" sub="the firm + 12 desks (NEP-171)" />
        <Stat i={2} k="license conditions" v={`${CONDITIONS.length}`} sub="breach = the product is void" />
        <Stat i={3} k="first anchor block" v={FIRST_ANCHOR.block.toLocaleString("en-US")} size="md" sub="deploy smoke test" />
      </StatStrip>

      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        {/* ── left: chassis plate + scrutineering stamps ── */}
        <div className="space-y-12">
          {/* chassis plate — a holographic plate that follows the cursor */}
          <div data-fx="rise" data-tilt className="bay-holo fl-card fl-tilt relative border-2 border-bone bg-carbon p-7" style={{ boxShadow: "6px 6px 0 var(--color-chartreuse)" }}>
            {["left-2.5 top-2.5", "right-2.5 top-2.5", "left-2.5 bottom-2.5", "right-2.5 bottom-2.5"].map((pos) => (
              <span key={pos} aria-hidden className={`bay-rivet absolute ${pos} h-2.5 w-2.5 rounded-full`} />
            ))}
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-steel">chassis plate · identity</p>
            <p className="mt-3 font-display text-5xl font-extrabold uppercase leading-none text-bone sm:text-6xl">
              Heli<span className="fl-shine">Quant</span>
            </p>
            <div className="mt-5 space-y-2 font-mono text-[11px] tracking-wide text-bone/70">
              {[
                ["CLASS", "AUTONOMOUS TRADING FIRM · 12 DESKS · 1 PM"],
                ["SERIES", "AI TRADING & STRATEGY"],
                ["IDENTITY", "CORE CONTRACT NFT (NEP-171, on-chain, verifiable)"],
              ].map(([k, val]) => (
                <p key={k} className="flex gap-2 border-b border-bone/10 pb-1.5">
                  <span className="w-20 shrink-0 text-steel">{k} ▸</span>
                  <span>{val}</span>
                </p>
              ))}
              <p className="flex gap-2">
                <span className="w-20 shrink-0 text-steel">STATE ▸</span>
                <span className="text-bone">REGISTRY EMPTY → GEAR N · STILL SEALING EVERY CYCLE</span>
              </p>
            </div>
          </div>

          {/* scrutineering stamps — the deployed contracts */}
          <div>
            <SectionHead n="01" title="Scrutineering stamps" sub="deployed contracts · tap to verify on NearBlocks" />
            <div className="grid gap-3">
              {CONTRACTS.map((c, i) => (
                <a
                  key={c.name}
                  href={nearblocksAccount(c.address)}
                  target="_blank"
                  rel="noreferrer"
                  data-fx="rise"
                  className="fl-card group flex items-start gap-4 border-2 border-bone/20 bg-pitch px-4 py-3.5"
                  style={v({ "--i": i })}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center border-2 border-chartreuse text-chartreuse transition-colors group-hover:bg-chartreuse group-hover:text-pitch">
                    <Check i={i} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg font-bold uppercase tracking-wide text-bone group-hover:text-chartreuse">{c.name}</span>
                    <span className="mt-0.5 block break-all font-mono text-[10px] tracking-wide text-steel">{c.address}</span>
                  </span>
                  <span aria-hidden className="bay-hint font-mono text-[10px] text-chartreuse">↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* ── right: crew + conditions ── */}
        <div className="space-y-12">
          <div>
            <SectionHead n="02" title="Crew roster" sub="the twelve desks" />
            <ul data-fx="rise" className="divide-y divide-bone/10 border-2 border-bone/20 bg-carbon">
              {CREW.map((c, i) => (
                <li key={c.role} className="fl-row bay-row flex items-baseline justify-between gap-4 px-5 py-2.5" style={v({ "--i": i })}>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span className="font-mono text-[9px] text-steel">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-display text-base font-bold uppercase tracking-wide text-bone">{c.role}</span>
                  </span>
                  <span className="text-right font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-steel">{c.duty}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* license conditions — the honesty gates */}
          <div data-fx="rise" className="fl-card border-2 border-chartreuse bg-carbon p-5" style={{ boxShadow: "6px 6px 0 rgba(201,242,75,0.5)" }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-chartreuse">license conditions · breach = the product is void</p>
            <ul className="mt-4 space-y-3">
              {CONDITIONS.map((c, i) => (
                <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-bone/75">
                  <span className="mt-0.5 flex items-center gap-2 font-mono text-chartreuse">
                    <Check i={i} />
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── service history — real milestones only ── */}
      <section className="mt-20">
        <SectionHead n="03" title="Service history" sub="stamped entries · real milestones only" />
        <div data-fx="rise" className="relative">
          <div aria-hidden className="bay-spine" style={{ left: 11 }} />
          <ol className="space-y-px">
            {HISTORY.map((h, i) => (
              <li key={i} className="fl-row bay-tape-row group relative grid gap-1 bg-carbon py-3 pl-10 pr-5 sm:grid-cols-[110px_1fr] sm:gap-4" style={v({ "--i": i })}>
                <span aria-hidden className="absolute left-[6px] top-[18px] h-3 w-3 rotate-45 border-2 border-chartreuse bg-pitch transition-colors group-hover:bg-chartreuse" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-steel">{h.date}</span>
                <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-bone/75">{h.event}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-steel">
          first anchor tx ▸
          <a href={nearblocksTx(FIRST_ANCHOR.txHash)} target="_blank" rel="noreferrer" className="text-chartreuse hover:underline">
            {FIRST_ANCHOR.txHash.slice(0, 12)}…{FIRST_ANCHOR.txHash.slice(-8)} ↗
          </a>
          <CopyButton text={FIRST_ANCHOR.txHash} />
        </p>
      </section>
    </BayShell>
  );
}
