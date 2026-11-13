"use client";

/**
 * THE DYNO ROOM — the edge lab as a dynamometer test cell.
 *
 * The pull is scrubbed by scroll: as the screen enters, each bar grows from the zero line to its
 * REAL out-of-sample figure (agents/data/onboarding_report.json, NEAR). When the pull completes the
 * "No edge" stamp slams and the dyno screen shakes once. There is no equity-curve series in the
 * data, so no curve is drawn — bars only, real values only.
 */

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, type MotionValue } from "motion/react";

import { Eyebrow, LineHeading, Odometer, vars } from "../primitives";
import { usePrefersReducedMotion } from "../store";
import { DYNO_COUNTERS, DYNO_SCALE, RUNS, SCRAP } from "../data";

function Bar({ label, value, color, pull }: { label: string; value: number; color: string; pull: MotionValue<number> | number }) {
  const w = Math.min(Math.abs(value) / DYNO_SCALE, 1) * 50; // % of the full track, from the centre line
  const side = value < 0 ? { right: "50%" } : { left: "50%" };
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-steel">{label}</span>
      <div className="relative h-4 flex-1 bg-bone/[0.05]">
        <div aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-bone/30" />
        <motion.div className="absolute inset-y-0" style={{ background: color, width: `${w}%`, ...side, scaleX: pull, transformOrigin: value < 0 ? "100% 50%" : "0% 50%" }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-bone">
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

export default function Dyno() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "start 0.3"] });
  const pull = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.6 });
  const [done, setDone] = useState(false);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    if (p >= 0.98 && !done) setDone(true);
  });

  const stamped = reduced || done;

  return (
    <section id="dyno" data-scene="dyno" className="relative bg-carbon px-6 py-24 sm:px-10">
      <div className="ld-content mx-auto max-w-[1280px] xl:px-4">
        <Eyebrow>THE EDGE LAB · COST-AWARE OOS · WALK-FORWARD · FDR</Eyebrow>
        <LineHeading
          className="mt-4 max-w-3xl font-display font-extrabold uppercase leading-[0.9] text-bone"
          style={{ fontSize: "clamp(2.6rem, 5.6vw, 4.6rem)" }}
          lines={[
            <>
              The dyno <span className="text-chartreuse">doesn&apos;t lie</span>
            </>,
          ]}
        />

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          {/* ── the dyno screen: out-of-sample ROI vs buy-and-hold, NEAR ── */}
          <div ref={ref} data-done={stamped ? "" : undefined} data-cursor="inspect" className="ld-dyno gr-shadow-ink relative border-2 border-bone/25 bg-pitch p-6">
            <div className="flex items-center justify-between border-b-2 border-bone/15 pb-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">dyno run · NEARUSDT perp · out-of-sample · net of fees</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal2">0 of 2 passed</p>
            </div>

            <div className="mt-5 space-y-6">
              {RUNS.map((r) => (
                <div key={r.name}>
                  <p className="font-display text-lg font-bold uppercase tracking-wide text-bone">{r.name}</p>
                  <div className="mt-2 space-y-2">
                    <Bar label="strategy OOS" value={r.oos} color="var(--color-signal2)" pull={reduced ? 1 : pull} />
                    <Bar label="buy & hold" value={r.bh} color="rgba(242,239,230,0.5)" pull={reduced ? 1 : pull} />
                  </div>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-steel">
                    {r.trades} trades · {r.win}% win · {r.bps} bps per trade
                  </p>
                </div>
              ))}
            </div>

            {/* the honesty stamp */}
            <div className="ld-dyno-stamp relative mt-6 w-fit border-[3px] border-signal2 bg-pitch px-3 py-1.5 sm:absolute sm:right-3 sm:top-12 sm:mt-0">
              <p className="font-display text-xl font-extrabold uppercase leading-none tracking-wide text-signal2">No edge</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-signal2/90">registry stays empty</p>
            </div>

            <p className="mt-6 border-t-2 border-bone/15 pt-4 text-sm leading-relaxed text-bone/60">
              Gate: out-of-sample ROI above zero and above buy-and-hold, more than 20 bps per trade (the round-trip cost), at least 20 trades, FDR control and a consistent walk-forward.{" "}
              <span className="text-bone">Nothing was tuned until it passed — so the firm abstains on NEAR.</span>
            </p>
          </div>

          {/* ── counters + scrap shelf ── */}
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-5">
              {DYNO_COUNTERS.map((c, i) => (
                <div key={c.l} data-reveal="rise" style={vars({ "--i": i })} className="border-2 border-bone/25 bg-pitch p-4 text-center">
                  <p className="font-display text-5xl font-extrabold leading-none text-bone">
                    <Odometer value={c.v} />
                  </p>
                  <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-steel">{c.l}</p>
                </div>
              ))}
            </div>

            <div data-reveal="rise" style={vars({ "--i": 3 })} className="flex-1 border-2 border-bone/25 bg-pitch p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-steel">the scrap shelf · cause of death</p>
              <ul className="mt-4 space-y-2.5">
                {SCRAP.map((s) => (
                  <li key={s.name} className="flex items-baseline justify-between gap-3 border-b border-bone/10 pb-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-bone/70 line-through decoration-signal2/70 decoration-2">{s.name}</span>
                    <span className="shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-signal2/80">{s.cause}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-steel">
                gates: cost-aware OOS · anchored walk-forward · outlier-robust · <span className="text-chartreuse">Benjamini-Hochberg FDR</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
