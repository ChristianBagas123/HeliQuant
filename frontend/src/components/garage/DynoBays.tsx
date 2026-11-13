"use client";

/**
 * DynoBays — the test stands of /assets. Every asset is an engine on a stand: the pattern gauge
 * (|return acf|, zones efficient · weak · patterned) with its marker sweeping in from zero, the funding-
 * carry line, and the edge lab's verdict stamped onto the card. Verdict chips filter the stands.
 */

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Note, Stat, StatStrip } from "@/components/garage/bay/parts";

export type Bay = {
  no: string;
  ticker: string;
  name: string;
  pattern: { label: string; frac: number; note: string }; // frac = marker position 0..1 on the gauge (0.15 scale)
  carry: string;
  verdict: { stamp: string; tone: "signal" | "bone" | "chartreuse"; story: string };
};

const stampCls = (tone: Bay["verdict"]["tone"]) =>
  tone === "signal" ? "border-signal2 text-signal2" : tone === "chartreuse" ? "border-chartreuse text-chartreuse" : "border-bone/60 text-bone/80";

export default function DynoBays({ bays }: { bays: Bay[] }) {
  const stamps = Array.from(new Set(bays.map((b) => b.verdict.stamp)));
  const [filter, setFilter] = useState("all");
  const shown = filter === "all" ? bays : bays.filter((b) => b.verdict.stamp === filter);
  const efficient = bays.filter((b) => b.pattern.frac < 1 / 3).length;

  return (
    <div className="space-y-10">
      <StatStrip>
        <Stat i={0} k="stands on the floor" v={`${bays.length}`} sub="one asset per stand" />
        <Stat i={1} k="efficient tape" v={`${efficient}`} sub="|acf| under 0.05 — follow flow" />
        <Stat i={2} k="no edge stamped" v={`${bays.filter((b) => b.verdict.stamp === "NO EDGE").length}`} tone="bad" sub="failed the cost-aware gate" />
        <Stat i={3} k="validated edges" v="0" sub="registry empty → the firm holds N" />
      </StatStrip>

      <div role="group" aria-label="Filter the stands by verdict" className="flex flex-wrap gap-2">
        {["all", ...stamps].map((k) => (
          <button key={k} type="button" className="bay-chip" data-on={filter === k ? "" : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === "all" ? "all stands" : k}
            <span className="bay-chip-n">{k === "all" ? bays.length : bays.filter((b) => b.verdict.stamp === k).length}</span>
          </button>
        ))}
      </div>

      <motion.div layout className="space-y-5">
        <AnimatePresence mode="popLayout">
          {shown.map((b, i) => (
            <motion.div
              key={b.ticker}
              layout
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.45, delay: Math.min(i * 0.04, 0.3), ease: [0.22, 1, 0.36, 1] }}
            >
              <Stand b={b} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <Note>
        registry today: <span className="text-bone">EMPTY</span> — every bay idle, the firm holds <span className="text-bone">N</span>. exploration keeps
        hunting (paper budget, fresh data, <span className="text-chartreuse">FDR-gated</span>) — the first hypothesis that survives the dyno gets the next
        license.
      </Note>
    </div>
  );
}

function Stand({ b }: { b: Bay }) {
  const pos = Math.min(97, b.pattern.frac * 100);
  return (
    <div data-fx="rise" data-tilt className="fl-card fl-tilt group relative grid gap-6 border-2 border-bone/20 bg-carbon p-5 sm:p-6 lg:grid-cols-[220px_1fr_320px]">
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="bay-outline absolute -bottom-6 right-4 font-display text-[7rem] font-extrabold leading-none opacity-60">{b.no.replace("BAY-", "")}</span>
      </span>

      {/* stand plate */}
      <div className="relative flex items-start gap-4 lg:flex-col lg:gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">{b.no}</p>
        <p className="font-display text-5xl font-extrabold leading-none text-bone transition-colors group-hover:text-chartreuse">
          {b.ticker}
          {b.ticker !== "RHEA" && <span className="text-2xl text-steel">USDT</span>}
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-steel">{b.name}</p>
      </div>

      {/* gauges */}
      <div className="relative flex flex-col justify-center gap-4">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">pattern gauge · |return acf|</p>
            <p className="font-mono text-[11px] tracking-wide text-bone/80">
              {b.pattern.label} <span className="text-steel">· {b.pattern.note}</span>
            </p>
          </div>
          <div
            className="relative mt-2 h-7 border border-bone/20"
            style={{ background: "linear-gradient(90deg, rgba(201,242,75,0.14) 0 33.3%, rgba(242,239,230,0.06) 33.3% 66.6%, rgba(255,90,31,0.12) 66.6%), var(--color-pitch)" }}
          >
            <span aria-hidden className="absolute inset-y-0 left-1/3 w-px bg-bone/25" />
            <span aria-hidden className="absolute inset-y-0 left-2/3 w-px bg-bone/25" />
            <span className="absolute inset-y-0 left-1.5 flex items-center font-mono text-[8px] uppercase tracking-[0.16em] text-chartreuse/70">efficient</span>
            <span className="absolute inset-y-0 left-[35%] flex items-center font-mono text-[8px] uppercase tracking-[0.16em] text-steel/80">weak</span>
            <span className="absolute inset-y-0 left-[68%] flex items-center font-mono text-[8px] uppercase tracking-[0.16em] text-signal2/70">patterned → predict</span>
            {b.pattern.frac > 0 && (
              <span className="bay-sweep absolute -inset-y-1 w-[3px] bg-chartreuse" style={{ left: `${pos}%`, boxShadow: "0 0 10px rgba(201,242,75,0.9)" }}>
                <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-chartreuse" />
              </span>
            )}
          </div>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-bone/70">
          <span className="text-steel">funding carry ▸</span> {b.carry}
        </p>
      </div>

      {/* verdict stamp + story */}
      <div className="relative flex flex-col justify-center gap-3">
        <span className={`bay-slam w-fit -rotate-3 border-[3px] px-3 py-1 font-display text-xl font-extrabold uppercase tracking-wider ${stampCls(b.verdict.tone)}`}>
          {b.verdict.stamp}
        </span>
        <p className="text-[13px] leading-relaxed text-bone/55">{b.verdict.story}</p>
      </div>
    </div>
  );
}
