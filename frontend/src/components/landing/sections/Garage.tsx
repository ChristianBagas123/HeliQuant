/**
 * THE GARAGE — the stack as a parts wall.
 *
 * Seven subsystems hang on the tool board as engraved part tags. Tags swing in from their hanging
 * hole when the wall scrolls into view and tilt under the cursor; the cloud org (chartreuse edge)
 * is the one that is live now. Server component — only the tilt wrapper is client.
 */

import { TiltPlate } from "../interactive";
import { Eyebrow, LineHeading, vars } from "../primitives";
import { PARTS } from "../data";

export default function Garage() {
  return (
    <section id="garage" data-scene="garage" data-loop className="relative bg-pitch px-6 py-24 sm:px-10">
      <div className="ld-content mx-auto max-w-[1280px] xl:px-4">
        <Eyebrow>THE MACHINERY · ALWAYS-ON · RAILWAY + NEAR</Eyebrow>
        <LineHeading
          className="mt-4 max-w-3xl font-display font-extrabold uppercase leading-[0.9] text-bone"
          style={{ fontSize: "clamp(2.6rem, 5.6vw, 4.6rem)" }}
          lines={[
            <>
              Runs while <span className="text-chartreuse">you sleep</span>
            </>,
          ]}
        />

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PARTS.map((p, i) => (
            <div key={p.no} data-reveal="swing" style={vars({ "--i": i })}>
              <TiltPlate
                depth={p.live ? 6 : 4}
                shadow={p.live ? "rgba(201,242,75,0.5)" : "rgba(0,0,0,0.55)"}
                className={`ld-part h-full border-2 bg-carbon p-5 ${p.live ? "border-chartreuse" : "border-bone/25 hover:border-bone/60"}`}
              >
                {/* hanging hole — toolboard detail */}
                <span aria-hidden className="absolute left-1/2 top-2 h-2 w-2 -translate-x-1/2 rounded-full border border-bone/30 bg-pitch" />

                <div className="mt-2 flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">{p.no}</span>
                  {p.live && (
                    <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-chartreuse">
                      <span className="gr-spark inline-block h-1.5 w-1.5 bg-chartreuse" /> live
                    </span>
                  )}
                </div>
                <h3 className="mt-2 font-display text-2xl font-bold uppercase tracking-wide text-bone">{p.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-bone/55">{p.desc}</p>
              </TiltPlate>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
