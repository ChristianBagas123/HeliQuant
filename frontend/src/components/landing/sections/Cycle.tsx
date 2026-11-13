"use client";

/**
 * THE ENGINE CYCLE — the org's decision loop as a 4-stroke engine.
 *
 * On wide + tall screens the stage is pinned (CSS sticky, ~4 screens of travel) and scroll IS the
 * crankshaft: one full pass turns the crank twice, so the piston goes down (INTAKE), up
 * (COMPRESSION), down (COMBUSTION), up (EXHAUST) exactly like a real 4-stroke. Stage lamps, the
 * stroke label and the gearbox follow. On small screens / reduced motion nothing is pinned and the
 * four strokes read as a plain list.
 *
 * THE SILENCE IS THE BRAND: with no validated edge the combustion chamber stays dark, the plug
 * does not fire, and gear N is stamped. No celebration, no particles.
 */

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";

import { Scramble } from "../interactive";
import { usePrefersReducedMotion } from "../store";
import { Eyebrow, LineHeading } from "../primitives";
import { MANIFOLD, STROKES } from "../data";

export default function Cycle() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 180, damping: 30, mass: 0.5 });
  const [stage, setStage] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const s = Math.max(0, Math.min(3, Math.floor(p * 4)));
    if (s !== stage) setStage(s);
  });

  // crank angle: two revolutions per cycle. Piston travel is a share of its own height.
  const pistonY = useTransform(smooth, (p) => `${((1 - Math.cos(p * Math.PI * 4)) / 2) * 150}%`);
  const crank = useTransform(smooth, (p) => p * 720);
  const rail = useTransform(smooth, [0, 1], [0, 1]);

  const active = (i: number) => !reduced && stage === i;
  const held = reduced || stage >= 2; // from COMBUSTION on, the gearbox shows N

  return (
    <section id="engine" data-scene="engine" className="relative bg-pitch">
      <div ref={ref} className="ld-pin">
      <div className="ld-pin-inner flex flex-col">
        <div className="ld-content mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-6 pb-10 pt-20 sm:px-10 lg:min-h-0 lg:pb-8 lg:pt-[88px] xl:px-4">
          {/* header */}
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
            <div>
              <Eyebrow>THE FIRM · ONE CYCLE · EVERY READ</Eyebrow>
              <LineHeading
                className="mt-4 max-w-3xl font-display font-extrabold uppercase leading-[0.9] text-bone"
                style={{ fontSize: "clamp(2.4rem, 5vw, 4.2rem)" }}
                lines={[
                  "A four-stroke",
                  <span key="b" className="text-chartreuse">
                    decision engine
                  </span>,
                ]}
              />
            </div>
            <p data-reveal="rise" className="max-w-md text-base leading-relaxed text-bone/65">
              Scan, argue, decide, seal — the same cycle on every read. Today there is no validated edge on the floor, so combustion stays dark. That no-spark is the product.
            </p>
          </div>

          {/* progress rail: four segments, one per stroke */}
          <div aria-hidden className="relative mt-8 hidden h-[6px] border border-bone/25 lg:block">
            <motion.div className="absolute inset-0 origin-left bg-chartreuse" style={{ scaleX: reduced ? 1 : rail }} />
            {[1, 2, 3].map((i) => (
              <span key={i} className="absolute inset-y-0 w-px bg-pitch" style={{ left: `${i * 25}%` }} />
            ))}
          </div>

          <div className="mt-8 grid gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-[0.82fr_1.18fr] lg:items-stretch">
            {/* ── the cutaway cylinder ── */}
            <div className="gr-shadow-ink relative flex min-h-[340px] flex-col border-2 border-bone/25 bg-carbon p-5 lg:min-h-0">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">
                  stroke <span className="text-bone">{reduced ? "01–04" : STROKES[stage].num}</span> / 04
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-chartreuse">
                  {reduced ? "4-STROKE" : <Scramble key={stage} text={STROKES[stage].key} trigger={stage} />}
                </p>
              </div>

              <div className="relative mt-4 flex flex-1 items-stretch justify-center gap-6">
                {/* cylinder */}
                <div className="relative flex w-[150px] flex-col">
                  {/* head: intake valve · plug · exhaust valve */}
                  <div className="flex items-end justify-between border-2 border-b-0 border-bone/40 bg-carbon2 px-3 pb-2 pt-2">
                    <span className="flex flex-col items-center gap-1">
                      <span className="ld-lamp h-2.5 w-2.5" style={{ background: active(0) ? "var(--color-chartreuse)" : "rgba(242,239,230,0.14)", boxShadow: active(0) ? "0 0 0 3px rgba(201,242,75,0.2)" : "none" }} />
                      <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-steel">in</span>
                    </span>
                    <span className="flex flex-col items-center gap-1">
                      {/* the plug stays dark: there is no validated edge to ignite */}
                      <span className="h-3 w-1.5 border border-bone/40 bg-pitch" />
                      <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-steel">plug</span>
                    </span>
                    <span className="flex flex-col items-center gap-1">
                      <span className="ld-lamp h-2.5 w-2.5" style={{ background: active(3) ? "var(--color-chartreuse)" : "rgba(242,239,230,0.14)", boxShadow: active(3) ? "0 0 0 3px rgba(201,242,75,0.2)" : "none" }} />
                      <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-steel">ex</span>
                    </span>
                  </div>
                  {/* sleeve */}
                  <div className="relative flex-1 overflow-hidden border-2 border-bone/40 bg-pitch">
                    <p className={`absolute inset-x-0 top-2 z-10 text-center font-mono text-[9px] uppercase tracking-widest text-signal2/80 transition-opacity duration-200 ${reduced || stage === 2 ? "opacity-100" : "opacity-0"}`}>
                      no spark
                    </p>
                    <motion.div className="absolute inset-x-1 top-1 h-[36%]" style={{ y: reduced ? "60%" : pistonY }}>
                      <div className="relative h-[46%] bg-bone/85">
                        <span className="absolute inset-x-0 top-[22%] h-px bg-pitch/60" />
                        <span className="absolute inset-x-0 top-[44%] h-px bg-pitch/60" />
                      </div>
                      {/* con-rod */}
                      <div className="mx-auto h-[300%] w-2.5 bg-bone/45" />
                    </motion.div>
                  </div>
                  {/* crankcase */}
                  <div className="flex items-center justify-center border-2 border-t-0 border-bone/40 bg-carbon2 py-2">
                    <motion.span className="relative block h-8 w-8 rounded-full border-2 border-bone/60" style={{ rotate: reduced ? 0 : crank }}>
                      <span className="absolute left-1/2 top-0.5 h-2 w-2 -translate-x-1/2 rounded-full bg-chartreuse" />
                    </motion.span>
                  </div>
                </div>

                {/* gearbox + combustion's honest state */}
                <div className="flex flex-col justify-between py-1">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-steel">gearbox</p>
                    <div className="mt-2 flex flex-col gap-1">
                      {["R", "N", "1", "2"].map((g) =>
                        g === "N" && held ? (
                          <span key={`${g}-${stage >= 2}`} className="ld-stamp-in gr-shadow-bone grid h-10 w-10 place-items-center border-2 border-bone bg-bone font-display text-xl font-extrabold text-pitch">
                            N
                          </span>
                        ) : (
                          <span key={g} className="grid h-10 w-10 place-items-center border-2 border-bone/20 font-display text-xl font-semibold text-bone/30">
                            {g}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                  <p className="max-w-[130px] border-t-2 border-bone/15 pt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-steel">
                    registry empty → <span className="text-bone">gear holds N</span>
                  </p>
                </div>
              </div>
            </div>

            {/* ── the four strokes ── */}
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-4">
              {STROKES.map((s, i) => {
                const on = active(i);
                return (
                  <li
                    key={s.key}
                    data-active={on ? "" : undefined}
                    className={`ld-stage relative flex items-center gap-5 border-2 p-4 lg:min-h-0 ${on ? "border-bone bg-carbon2" : "border-bone/20 bg-carbon"}`}
                  >
                    <span className={`font-display text-5xl font-extrabold leading-none transition-colors duration-300 ${on ? "text-chartreuse" : "text-bone/25"}`}>{s.num}</span>
                    <div className="min-w-0">
                      <h3 className={`font-display text-2xl font-bold uppercase tracking-wide transition-colors duration-300 ${on || reduced ? "text-bone" : "text-bone/55"}`}>{s.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-bone/55">{s.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
      </div>

      {/* desk roster — the manifold feeding the engine (below the pinned stage) */}
      <div className="ld-content mx-auto max-w-[1280px] px-6 pb-24 sm:px-10 lg:pt-10 xl:px-4">
        <div data-reveal="rise" className="border-2 border-bone/20 bg-carbon">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-chartreuse">the manifold ▸</span>
            {MANIFOLD.map((d) => (
              <span key={d} className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone/60">
                {d}
              </span>
            ))}
          </div>
          {/* latest real decision — verbatim from the cloud floor */}
          <div className="flex flex-wrap items-center gap-3 border-t-2 border-bone/15 px-5 py-3.5">
            <span className="inline-block h-2.5 w-2.5 bg-chartreuse" />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-bone/80">
              latest cycle · BTCUSDT — <span className="text-bone">ABSTAIN</span> · sealed
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-steel">(the firm holds until the dyno passes an edge)</span>
          </div>
        </div>
      </div>
    </section>
  );
}
