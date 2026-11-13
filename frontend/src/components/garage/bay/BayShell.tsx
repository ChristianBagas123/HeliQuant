/**
 * BayShell — the shared frame for the inner bays (The Edge · The Grid · Tuning Bay · The Crew ·
 * Ledger · The Dyno): nav, the floor's motion runtime (reveals, tilt, scroll hairline), a slow
 * atmosphere, a hero whose title rises from a mask with a shine on its accent word, the page's own
 * line-drawn instrument behind the hero, and the moving hazard seam above the footer.
 */

import "@/components/garage/floor.css";
import "./bay.css";

import AppNav from "@/components/garage/AppNav";
import FloorMotion from "@/components/garage/FloorMotion";

import Ornament, { type OrnamentKind } from "./Ornaments";

type Props = {
  eyebrow: React.ReactNode;
  warn?: boolean; // eyebrow dot in signal orange
  title: [string, string]; // [lead words, accent word]
  lead: React.ReactNode;
  aside?: React.ReactNode; // badges/plates under the lead
  ornament: OrnamentKind;
  footer: React.ReactNode;
  children: React.ReactNode;
};

const v = (o: Record<string, string | number>) => o as React.CSSProperties;

export default function BayShell({ eyebrow, warn, title, lead, aside, ornament, footer, children }: Props) {
  return (
    <>
      <AppNav />
      <FloorMotion />
      <main className="relative min-h-screen overflow-x-clip bg-pitch pb-24">
        <div aria-hidden className="gr-carbon-dots fixed inset-0 opacity-40" />
        <div aria-hidden className="bay-aura" />

        <section className="relative z-10 mx-auto max-w-[1280px] px-6 pt-16 sm:px-10 xl:px-4">
          <Ornament kind={ornament} />
          <p className="fl-fade-in relative font-mono text-[11px] uppercase tracking-[0.3em] text-steel" style={v({ "--d": "0s" })}>
            <span className={`bay-live ${warn ? "bay-live-warn" : ""}`} />
            {eyebrow}
          </p>
          <h1 className="relative mt-4 font-display font-extrabold uppercase leading-[0.9] text-bone" style={{ fontSize: "clamp(2.8rem, 6.4vw, 5.2rem)" }}>
            <span className="fl-title-line">
              <span style={v({ "--i": 0 })}>{title[0]}</span>{" "}
              <span style={v({ "--i": 1 })}>
                <span className="fl-shine">{title[1]}</span>
              </span>
            </span>
          </h1>
          <p className="fl-fade-in relative mt-4 max-w-2xl text-base leading-relaxed text-bone/65" style={v({ "--d": "0.35s" })}>
            {lead}
          </p>
          {aside && (
            <div className="fl-fade-in relative" style={v({ "--d": "0.5s" })}>
              {aside}
            </div>
          )}

          <div className="relative mt-12">{children}</div>
        </section>
      </main>

      <footer className="relative z-10 bg-pitch">
        <div aria-hidden className="gr-hazard bay-hazard h-[14px] opacity-90" />
        <div className="mx-auto max-w-[1280px] px-6 py-8 sm:px-10 xl:px-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-steel">{footer}</p>
        </div>
      </footer>
    </>
  );
}
