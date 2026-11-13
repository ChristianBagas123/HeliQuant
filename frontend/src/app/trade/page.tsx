"use client";

/** /trade — YOUR floor: reads your connected local engine. Gated — if no engine is connected, prompt to
 *  register instead of showing the owner showcase's data as "yours".
 *
 *  Not connected: the bay shell (garage-shutter ornament), an empty lane with a ghost car and a half-closed
 *  shutter that lifts on hover, the three steps to your own floor, and a veiled skeleton of what the floor
 *  shows once your engine answers (no numbers — nothing here pretends to be your data). */

import Link from "next/link";
import { useSyncExternalStore } from "react";

import AppNav from "@/components/garage/AppNav";
import BayShell from "@/components/garage/bay/BayShell";
import { SectionHead } from "@/components/garage/bay/parts";
import CampaignView from "@/components/garage/CampaignView";
import { isOwnerEngine } from "@/lib/engine";

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

const v = (o: Record<string, string | number>) => o as React.CSSProperties;

const STEPS = [
  { t: "Run your engine", d: "Clone agents-LocalReady and start it — docker compose up. It keeps your keys in its own SQLite." },
  { t: "Register keys", d: "Tunnel it, set HQ_OWNER_ACCOUNT, paste the URL, connect that wallet, then add your Groq and execution keys and sign once." },
  { t: "Connect", d: "Hit Connect — the dashboard re-points to your engine and this floor goes live." },
];

/** a skeleton block (no data — just the shape of what's coming) */
const Bone = ({ className = "" }: { className?: string }) => <span aria-hidden className={`block bg-bone/10 ${className}`} />;

export default function TradePage() {
  // null on the server (localStorage unknown) → a skeleton, then the client reads the engine choice
  const connected = useSyncExternalStore<boolean | null>(subscribeStorage, () => !isOwnerEngine(), () => null);

  if (connected === null) {
    return (
      <>
        <AppNav />
        <main className="min-h-screen bg-pitch" aria-busy="true">
          <div className="floor-skel mx-auto max-w-[1280px] px-6 pt-16 sm:px-10 xl:px-4">
            <Bone className="h-3 w-56" />
            <Bone className="mt-6 h-16 w-[min(520px,90%)]" />
            <Bone className="mt-5 h-4 w-[min(640px,95%)]" />
            <Bone className="mt-14 h-40 w-full" />
          </div>
        </main>
      </>
    );
  }
  if (connected) return <CampaignView mode="user" />;

  return (
    <BayShell
      ornament="shutter"
      warn
      eyebrow="YOUR FLOOR · YOUR ENGINE · NOT CONNECTED"
      title={["Your", "floor"]}
      lead={
        <>
          This is <span className="text-chartreuse">your</span> trading floor — it reads your own local engine. Register and connect one first. Until then, watch
          the owner&apos;s firm on The grid.
        </>
      }
      aside={
        <div className="mt-6 inline-flex items-center gap-3 border-2 border-signal2/60 bg-carbon px-4 py-2.5" style={{ boxShadow: "5px 5px 0 rgba(255,90,31,0.35)" }}>
          <span className="bay-lamp" data-on="wait" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone/85">
            no engine connected — <span className="text-signal2">this bay is empty</span>
          </p>
        </div>
      }
      footer="HELIQUANT · YOUR FLOOR · your engine, your positions, your keys — no custody"
    >
      {/* ── the empty bay: a lane waiting for its first car, the shutter half down ── */}
      <div data-fx="rise" className="floor-stage fl-card group relative overflow-hidden border-2 border-bone/20 bg-carbon">
        <div className="relative px-5 pb-6 pt-24 sm:px-8 sm:pt-28">
          <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-steel">
            <span>
              <span className="text-signal2">stop</span> ◂ — — — lane — — — ▸ <span className="text-chartreuse">target</span>
            </span>
            <span>your position lands here</span>
          </div>
          <div className="floor-ghost mt-3">
            <div className="bay-lane">
              <span aria-hidden className="absolute inset-y-0 left-0 z-[1] w-[3px] bg-signal2/50" />
              <span aria-hidden className="gr-hazard absolute inset-y-0 right-0 z-[1] w-[10px] opacity-40" />
              <span aria-hidden className="bay-car z-[2]" style={{ left: "50%" }} />
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {["entry", "mark", "pnl"].map((k) => (
              <div key={k} className="border border-dashed border-bone/15 px-3 py-2.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-steel">{k}</p>
                <p className="mt-1 font-display text-xl font-extrabold text-bone/25">— —</p>
              </div>
            ))}
          </div>
        </div>

        {/* the shutter — half down, lifts under the cursor */}
        <div aria-hidden className="floor-door pointer-events-none absolute inset-x-0 top-0 h-[84px] sm:h-[100px] border-b-4 border-bone/30 bg-pitch">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="block h-[11.11%] border-b border-bone/10" style={{ background: `linear-gradient(180deg, rgba(242,239,230,${0.05 - i * 0.003}), transparent)` }} />
          ))}
          <span className="absolute bottom-3 left-1/2 h-1.5 w-16 -translate-x-1/2 bg-chartreuse" style={{ boxShadow: "0 0 10px rgba(201,242,75,0.7)" }} />
          <span className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.3em] text-bone/40">bay closed</span>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link href="/onboarding" className="fl-cta gr-press border-2 border-bone bg-chartreuse px-6 py-3 font-display text-base font-bold uppercase tracking-wide text-pitch">
          Register your engine ▸
        </Link>
        <Link
          href="/campaign"
          className="gr-press border-2 border-bone/50 px-6 py-3 font-display text-base font-semibold uppercase tracking-wide text-bone/85 transition-colors hover:border-chartreuse hover:text-chartreuse"
        >
          Watch the owner&apos;s floor
        </Link>
        <Link href="/profile" className="font-mono text-[10px] uppercase tracking-[0.16em] text-steel transition-colors hover:text-chartreuse">
          check engine status in your pit →
        </Link>
      </div>

      {/* ── three steps to your own floor ── */}
      <section className="mt-20">
        <SectionHead n="01" title="Three steps to your floor" sub="all of it on your machine · no custody" />
        <div data-fx="rise" className="relative grid gap-4 md:grid-cols-3">
          <span aria-hidden className="floor-rail absolute left-[16%] right-[16%] top-[30px] hidden h-[2px] bg-chartreuse/70 md:block" style={{ boxShadow: "0 0 10px rgba(201,242,75,0.5)" }} />
          {STEPS.map((s, i) => (
            <Link
              key={s.t}
              href="/onboarding"
              className="fl-card group relative border-2 border-bone/20 bg-carbon px-5 pb-5 pt-4"
              style={v({ "--i": i })}
            >
              <span className="relative z-[1] mx-auto grid h-11 w-11 place-items-center border-2 border-bone/30 bg-pitch font-display text-lg font-extrabold text-bone transition-colors group-hover:border-chartreuse group-hover:bg-chartreuse group-hover:text-pitch md:mx-0">
                {i + 1}
              </span>
              <p className="mt-4 font-display text-xl font-extrabold uppercase tracking-wide text-bone transition-colors group-hover:text-chartreuse">{s.t}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-bone/55">{s.d}</p>
              <span aria-hidden className="absolute right-5 top-5 font-display text-lg text-steel transition-[color,transform] duration-300 group-hover:translate-x-1 group-hover:text-chartreuse">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── what this floor shows once your engine answers — shape only, veiled ── */}
      <section className="mt-20">
        <SectionHead n="02" title="What lights up here" sub="the same floor as The grid — fed by your engine" />
        <div className="bay-lock">
          <div className="bay-lock-veil">
            <div className="px-6 text-center">
              <svg viewBox="0 0 40 44" className="mx-auto h-10 w-10 text-chartreuse" aria-hidden>
                <path className="bay-lock-icon" d="M11 20 V13 a9 9 0 0 1 18 0 V20" fill="none" stroke="currentColor" strokeWidth="3" />
                <rect x="6" y="20" width="28" height="22" fill="none" stroke="currentColor" strokeWidth="3" />
                <circle cx="20" cy="30" r="3" fill="currentColor" />
              </svg>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/85">connect your engine to unlock</p>
            </div>
          </div>
          <div aria-hidden className="pointer-events-none select-none space-y-5 opacity-50">
            <div className="grid gap-4 sm:grid-cols-3">
              {["capital · paper", "capital · bitget demo", "lap board"].map((k) => (
                <div key={k} className="border-2 border-bone/15 bg-carbon px-5 py-4">
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">{k}</p>
                  <Bone className="mt-3 h-8 w-28" />
                  <Bone className="mt-3 h-2 w-20" />
                </div>
              ))}
            </div>
            <div className="border-2 border-bone/15 bg-carbon p-5">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">open positions · stop → target</p>
              {[0, 1, 2].map((i) => (
                <div key={i} className="mt-4 flex items-center gap-4">
                  <Bone className="h-4 w-16 shrink-0" />
                  <div className="bay-lane flex-1" />
                </div>
              ))}
            </div>
            <div className="flex gap-3 overflow-hidden border-2 border-bone/15 bg-carbon px-5 py-3">
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.22em] text-steel">recent closes ▸</span>
              {[0, 1, 2, 3, 4].map((i) => (
                <Bone key={i} className="h-3 w-24 shrink-0" />
              ))}
            </div>
          </div>
        </div>
      </section>
    </BayShell>
  );
}
