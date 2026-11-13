/**
 * HERO — "THE ENGINE BAY".
 *
 * Left: the claim. Right: the instrument cluster — a tachometer whose needle and green arc move as one
 * and rest on the regime classifier's real test accuracy (78.9%, NEAR), with the 76.1% persistence
 * baseline marked. Holding the hub revs the needle (and the arc with it) through N → 1 → 2 (see
 * TachEngine). The six-blade rotor sits at its hub (3D when WebGL is available, flat
 * SVG otherwise). The redline is the forced-trade territory the firm refuses. Below: the ticker.
 * Every figure is real (see ../data.ts). Server component; only the hub and ticker are client.
 */

import { Magnetic } from "../interactive";
import { Odometer, SlamHeadline, vars } from "../primitives";
import { REGIME, TICKER } from "../data";
import { RotorHub, TachEngine, Ticker } from "./HeroClient";

// ── tachometer geometry: 240° sweep, 0% at -120° and 100% at +120° (clockwise from the top) ──
const C = 230;
const R = 176;
const angle = (v: number) => -120 + 2.4 * v;
const polar = (v: number, r: number) => {
  const a = (angle(v) * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
};
const arc = (from: number, to: number, r = R) => {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  const large = angle(to) - angle(from) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};
const TICKS = Array.from({ length: 21 }, (_, i) => i * 5);
const NUMBERS = [0, 20, 40, 60, 80, 100];
const REDLINE_FROM = 90;

function Tachometer() {
  const [bx1, by1] = polar(REGIME.baseline, 150);
  const [bx2, by2] = polar(REGIME.baseline, 190);
  const [blx, bly] = polar(REGIME.baseline, 207);
  const [rlx, rly] = polar(95, 204);

  return (
    <div className="ld-tach relative mx-auto aspect-square w-full max-w-[500px]">
      <svg viewBox="0 0 460 460" className="absolute inset-0 h-full w-full" role="img" aria-label={`Tachometer: regime test accuracy ${REGIME.accuracy}% on NEAR, persistence baseline ${REGIME.baseline}%. Gear: neutral.`}>
        {/* track + redline (forced-trade territory we refuse) */}
        <path d={arc(0, 100)} fill="none" stroke="rgba(242,239,230,0.16)" strokeWidth="6" />
        <path d={arc(REDLINE_FROM, 100)} className="ld-tach-redline" fill="none" stroke="var(--color-signal2)" strokeWidth="6" />
        {/* the reading: fills to the real value */}
        <path d={arc(0, 100)} pathLength={100} className="ld-tach-fill" style={vars({ "--v": REGIME.accuracy })} fill="none" stroke="var(--color-chartreuse)" strokeWidth="6" />
        {TICKS.map((v) => {
          const major = v % 10 === 0;
          const [x1, y1] = polar(v, major ? 152 : 162);
          const [x2, y2] = polar(v, 170);
          return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke={v >= REDLINE_FROM ? "var(--color-signal2)" : "var(--color-bone)"} strokeOpacity={major ? 0.8 : 0.35} strokeWidth={major ? 3 : 2} />;
        })}
        {NUMBERS.map((v) => {
          const [x, y] = polar(v, 136);
          return (
            <text key={v} x={x} y={y + 4} textAnchor="middle" fontSize="12" fill="var(--color-bone)" fillOpacity="0.55" style={{ fontFamily: "var(--font-mono)" }}>
              {v}
            </text>
          );
        })}
        {/* persistence baseline marker */}
        <line x1={bx1} y1={by1} x2={bx2} y2={by2} stroke="var(--color-bone)" strokeWidth="2" strokeDasharray="4 3" />
        <text x={blx} y={bly - 6} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}>
          <tspan x={blx}>{REGIME.baseline}</tspan>
          <tspan x={blx} dy="11">
            BASELINE
          </tspan>
        </text>
        <text x={rlx} y={rly + 12} textAnchor="middle" fontSize="9.5" fill="var(--color-signal2)" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em" }}>
          REDLINE
        </text>
      </svg>

      {/* shift effects layer (flash, rings, sparks, gear callout) + the engine simulation that drives
          the needle, the arc and the gearbox */}
      <TachEngine accuracy={REGIME.accuracy} />

      {/* needle: rests on the accuracy (the end of the green arc) and hunts; TachEngine moves it per frame */}
      <div aria-hidden className="ld-needle" style={vars({ "--a": `${angle(REGIME.accuracy).toFixed(2)}deg`, "--a0": `${angle(0)}deg` })}>
        <span className="absolute left-[-3px] top-[17%] h-[18%] w-[6px] bg-bone" style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.6)" }} />
        <span className="ld-needle-tip absolute left-[-3px] top-[17%] h-[4%] w-[6px] bg-chartreuse" />
      </div>

      {/* the rotor at the hub (anchor for the 3D turbine) */}
      <RotorHub />

      {/* gearbox in the open bottom of the dial — N at rest: the firm holds neutral */}
      <div className="absolute bottom-[5%] left-1/2 flex -translate-x-1/2 gap-1">
        {["R", "N", "1", "2"].map((g) => (
          <span key={g} data-gear={g} data-on={g === "N" ? "1" : undefined} className={`ld-gear grid h-9 w-9 place-items-center border-2 font-display text-lg ${g === "N" ? "ld-stamp-in" : ""}`} style={g === "N" ? vars({ "--d": "1.5s" }) : undefined}>
            <span className="ld-gear-face">{g}</span>
          </span>
        ))}
      </div>

      <p aria-hidden className="ld-rev-label absolute left-1/2 top-[14%] -translate-x-1/2 border-2 border-bone bg-pitch px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.24em] text-bone">
        rev limiter
      </p>
    </div>
  );
}

export default function Hero() {
  return (
    <section id="top" data-scene="hero" data-loop className="ld-hero relative bg-pitch">
      {/* overhead lamp vignette */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 52% at 50% 0%, rgba(201,242,75,0.07), transparent 70%)" }} />

      <div className="ld-content mx-auto grid max-w-[1280px] gap-14 px-6 pb-14 pt-12 sm:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8 lg:pt-12 xl:px-4">
        {/* ── LEFT: the claim ── */}
        <div>
          <p className="ld-enter font-mono text-[11px] uppercase tracking-[0.3em] text-steel">
            <span className="text-chartreuse">▮</span> AUTONOMOUS TRADING FIRM · 12 DESKS · ANCHORED ON NEAR · TEE-SIGNED LLM CALLS
          </p>

          <SlamHeadline
            className="mt-6 font-display font-extrabold uppercase leading-[0.86] text-bone"
            style={{ fontSize: "clamp(3.4rem, 9.2vw, 7.6rem)", letterSpacing: "0.005em" }}
            lines={[{ text: "Most bots" }, { text: "redline." }, { text: "Ours holds gear.", className: "text-chartreuse" }]}
          />

          <p className="ld-enter mt-7 max-w-xl text-pretty text-base leading-relaxed text-bone/70 sm:text-lg" style={vars({ "--d": "0.5s" })}>
            Twelve specialist desks — regime, smart-money, Allora macro, on-chain, vol-forecasting — converge into a PM whose every call is anchored on NEAR, its LLM answers signed inside a NEAR AI Cloud TEE, and the whole firm can be hired per job on NEAR Agent Market. Orders fill on{" "}
            <span className="text-bitget">Bitget Demo</span>. It fires <span className="font-mono text-chartreuse">ENTER</span> only on a validated edge; when there isn&apos;t one the gearbox holds <span className="font-mono text-bone">N</span>. The discipline to hold is the product.
          </p>

          <div className="ld-enter mt-9 flex flex-wrap items-center gap-4" style={vars({ "--d": "0.62s" })}>
            <Magnetic>
              <a href="/onboarding" data-cursor="press" className="ld-press ld-press-chart border-2 border-pitch bg-chartreuse px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-pitch">
                Register your engine
              </a>
            </Magnetic>
            <Magnetic>
              <a href="/campaign" data-cursor="press" className="ld-press ld-press-dim border-2 border-bone bg-bone px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-pitch">
                Watch the owner&apos;s floor
              </a>
            </Magnetic>
            <Magnetic>
              <a href="#dyno" data-cursor="press" className="ld-press ld-press-dim border-2 border-bone/60 px-7 py-3.5 font-display text-lg font-semibold uppercase tracking-wide text-bone/90 hover:border-chartreuse hover:text-chartreuse focus-visible:border-chartreuse focus-visible:text-chartreuse">
                See the dyno
              </a>
            </Magnetic>
            <a href="/onboarding" className="self-center font-mono text-[12px] uppercase tracking-[0.16em] text-steel underline-offset-4 hover:text-chartreuse hover:underline focus-visible:text-chartreuse focus-visible:underline">
              already have an engine? log in →
            </a>
          </div>

          <p className="ld-enter mt-7 font-mono text-[11px] uppercase tracking-[0.22em] text-steel" style={vars({ "--d": "0.74s" })}>
            every figure below is real — the measurements, the failed edges, the abstentions
          </p>
        </div>

        {/* ── RIGHT: the instrument cluster ── */}
        <div className="ld-enter" style={vars({ "--d": "0.2s" })}>
          <Tachometer />

          {/* honest readout strip — regime read + the gearbox holding N */}
          <div className="gr-shadow-ink mt-4 border-2 border-bone/25 bg-carbon">
            <div className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-steel">regime test accuracy · NEAR</p>
                <p className="mt-1 font-display text-4xl font-extrabold leading-none text-bone">
                  <Odometer value={String(REGIME.accuracy)} />
                  <span className="ml-0.5 text-xl text-chartreuse">%</span>
                </p>
              </div>
              <p className="max-w-[150px] text-right font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-steel">
                registry empty → <span className="text-bone">holds N</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── pit-wall ticker — the real numbers on the wall ── */}
      <div className="ld-content border-y-2 border-bone/20 bg-carbon">
        <Ticker items={TICKER} />
      </div>
    </section>
  );
}
