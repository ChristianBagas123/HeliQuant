"use client";

/**
 * Preloader — "engine start". Pitch screen, a mono RPM counter climbs from 0 to idle while the rotor
 * spins up, gear N stamps, then the hazard-edged shutters open onto the hero.
 * Shown once per session, skippable (click / any key / button), ~1.3s, never when reduced motion is
 * requested. BOOT in LandingShell decides visibility before first paint; a CSS failsafe hides it if
 * scripts die. The RPM figure is engine dressing, not a firm metric.
 */

import { useEffect, useRef, useState } from "react";

import StaticTurbine from "./StaticTurbine";

const IDLE_RPM = 800;
type Phase = "spin" | "n" | "open" | "done";

export default function Preloader() {
  const [phase, setPhase] = useState<Phase>("spin");
  const rpmRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = document.getElementById("ld-root");
    if (!root) return;
    const timers: number[] = [];
    let raf = 0;
    let finished = false;

    const open = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      if (rpmRef.current) rpmRef.current.textContent = String(IDLE_RPM).padStart(4, "0");
      setPhase("open");
      root.dataset.ready = "1";
      try {
        sessionStorage.setItem("ld-seen", "1");
      } catch {}
      timers.push(window.setTimeout(() => setPhase("done"), 480));
    };

    if (root.dataset.skip) {
      timers.push(window.setTimeout(() => setPhase("done"), 0));
      return () => timers.forEach(clearTimeout);
    }

    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 650);
      const eased = 1 - Math.pow(1 - p, 3);
      if (rpmRef.current) rpmRef.current.textContent = String(Math.round(eased * IDLE_RPM)).padStart(4, "0");
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    timers.push(window.setTimeout(() => setPhase("n"), 680));
    timers.push(window.setTimeout(open, 920));

    window.addEventListener("keydown", open, { once: true });
    window.addEventListener("pointerdown", open, { once: true });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener("keydown", open);
      window.removeEventListener("pointerdown", open);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div className="ld-pre" data-phase={phase} role="status" aria-label="Starting the engine">
      <div className="ld-pre-half top" />
      <div className="ld-pre-half bottom" />
      <div className="ld-pre-core">
        <div className="flex flex-col items-center gap-6">
          <StaticTurbine className="ld-pre-rotor h-28 w-28 text-chartreuse" />
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-steel">
            <span className="text-chartreuse">▮</span> ignition ·{" "}
            <span ref={rpmRef} className="text-bone">
              0000
            </span>{" "}
            rpm
          </p>
          <div className="flex items-center gap-1" aria-hidden>
            {["R", "N", "1", "2"].map((g) =>
              g === "N" ? (
                <span
                  key={g}
                  className="ld-pre-n grid h-10 w-10 place-items-center border-2 border-bone bg-bone font-display text-xl font-extrabold text-pitch"
                  style={{ boxShadow: "4px 4px 0 rgba(242,239,230,0.35)" }}
                >
                  N
                </span>
              ) : (
                <span key={g} className="grid h-10 w-10 place-items-center border-2 border-bone/20 font-display text-xl font-semibold text-bone/30">
                  {g}
                </span>
              ),
            )}
          </div>
          <button type="button" className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel underline-offset-4 hover:text-chartreuse hover:underline">
            skip ▸
          </button>
        </div>
      </div>
    </div>
  );
}
