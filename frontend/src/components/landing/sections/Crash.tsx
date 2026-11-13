/**
 * THE CRASH TEST — we crash-test our own execution.
 *
 * Spike S-05.16: 10 round trips of 2 NEAR on Bitget Demo. A market buy filled a median +2.21%
 * above the live price while the sell filled on it: about −2.23% per round trip. The paper ledger
 * at live prices is the official PnL; the demo fill only proves the order path.
 *
 * Beat (CSS only, fired by the shared reveal observer; replayed each time the section is reached
 * scrolling down, see data-replay in LandingShell): the paper figure is driven at the
 * hazard wall, the whole rig shakes on impact, debris flies off the wall, "Disclosed" is stamped.
 * The only section allowed to bleed signal orange. Server component.
 */

import { Eyebrow, LineHeading, Odometer, vars } from "../primitives";

// debris: [dx, dy, rotation, colour] — small squares thrown from the wall on impact
const DEBRIS: [number, number, number, string][] = [
  [-120, -90, -220, "var(--color-bone)"],
  [-70, -140, 160, "var(--color-signal2)"],
  [90, -120, 240, "var(--color-bone)"],
  [140, -40, -180, "var(--color-signal2)"],
  [120, 80, 200, "var(--color-bone)"],
  [-60, 120, -260, "var(--color-signal2)"],
  [-150, 40, 140, "var(--color-bone)"],
  [40, 150, -120, "var(--color-signal2)"],
];

export default function Crash() {
  return (
    <section id="crash" data-scene="crash" data-replay className="relative bg-pitch px-6 py-24 sm:px-10">
      {/* warning wash */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 45% at 78% 40%, rgba(255,90,31,0.08), transparent 70%)" }} />

      <div className="ld-content mx-auto max-w-[1280px] xl:px-4">
        <Eyebrow tone="signal2">HONESTY LAB · FINDING #10</Eyebrow>
        <LineHeading
          className="mt-4 max-w-3xl font-display font-extrabold uppercase leading-[0.9] text-bone"
          style={{ fontSize: "clamp(2.6rem, 5.6vw, 4.6rem)" }}
          lines={[
            "We crash-test",
            <span key="b" className="text-signal2">
              our own execution
            </span>,
          ]}
        />

        <div data-reveal="crash" className="relative mt-12">
          <div className="ld-impact grid items-stretch gap-0 lg:grid-cols-[1fr_auto_1fr]">
            {/* ── the paper figure, driven at the wall ── */}
            <div className="ld-ram relative flex flex-col justify-center border-2 border-bone/25 bg-carbon p-8 lg:border-r-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-steel">the demo order book · NEAR · 10 round trips</p>
              <p className="mt-3 font-display font-extrabold leading-none text-bone" style={{ fontSize: "clamp(4rem, 9vw, 7.5rem)" }}>
                <Odometer value="+2.21" />
                <span className="text-4xl">%</span>
              </p>
              <p className="mt-2 font-mono text-sm uppercase tracking-[0.2em] text-bone/70">median buy fill vs live price</p>
              <p className="mt-5 max-w-sm text-sm leading-relaxed text-bone/55">Bitget Demo quotes a wide bid-ask, so the buy lands above the market while the sell lands on it.</p>
            </div>

            {/* ── the wall ── */}
            <div className="gr-hazard relative hidden w-[64px] border-y-2 border-bone/25 lg:block" aria-hidden />

            {/* ── the verdict ── */}
            <div className="relative border-2 border-bone/25 bg-carbon2 p-8 lg:border-l-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-steel">impact report · realistic execution</p>
              <p className="mt-3 font-display font-extrabold leading-none text-signal2" style={{ fontSize: "clamp(3rem, 7vw, 5.5rem)" }}>
                <Odometer value="−2.23" /> <span className="text-3xl">%</span>
              </p>
              <p className="mt-2 font-mono text-sm uppercase tracking-[0.18em] text-bone/70">per round trip · median</p>
              <p className="mt-5 max-w-sm text-sm leading-relaxed text-bone/60">
                A demo account would make every trade look worse than it is. So the <span className="text-bone">paper ledger at live prices is the official PnL</span> and the demo fill is only proof that the order path works.
              </p>

              <div className="ld-crash-stamp relative mt-6 w-fit border-[3px] border-signal2 bg-carbon2 px-4 py-2 sm:absolute sm:right-6 sm:top-6 sm:mt-0">
                <p className="font-display text-2xl font-extrabold uppercase tracking-wider text-signal2">Disclosed</p>
              </div>
            </div>
          </div>

          {/* debris off the wall */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {DEBRIS.map(([dx, dy, dr, bg], i) => (
              <span key={i} className="ld-debris" style={{ background: bg, ...vars({ "--dx": `${dx}px`, "--dy": `${dy}px`, "--dr": `${dr}deg` }) }} />
            ))}
          </div>
        </div>

        <p data-reveal="rise" className="mt-8 max-w-2xl font-mono text-[11px] uppercase leading-relaxed tracking-[0.18em] text-steel">
          a firm that publishes its crashes is a firm whose <span className="text-chartreuse">passes mean something</span>
        </p>
      </div>
    </section>
  );
}
