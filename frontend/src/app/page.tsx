/**
 * HeliQuant landing — "THE NIGHT GARAGE" (dark automotive brutalism, brand v2).
 * Identity, copy, figures and section order are unchanged; this is the
 * motion + 3D pass. Landing components live in components/landing (the garage/ components are
 * still used by other pages and are left untouched).
 */

import "@/components/landing/landing.css";

import LandingShell from "@/components/landing/LandingShell";
import LandingNav from "@/components/landing/LandingNav";
import Preloader from "@/components/landing/Preloader";
import SceneMount from "@/components/landing/SceneMount";
import { Atmosphere, CursorRing, HazardSeam, ScrollTach } from "@/components/landing/chrome";
import Hero from "@/components/landing/sections/Hero";
import Loop from "@/components/landing/sections/Loop";
import Cycle from "@/components/landing/sections/Cycle";
import Dyno from "@/components/landing/sections/Dyno";
import Crash from "@/components/landing/sections/Crash";
import Report from "@/components/landing/sections/Report";
import BlackBox from "@/components/landing/sections/BlackBoxLive";
import Garage from "@/components/landing/sections/Garage";

export default function HomePage() {
  return (
    <LandingShell>
      <Preloader />
      <Atmosphere />
      <SceneMount />
      <CursorRing />
      <ScrollTach />

      <LandingNav />
      <main className="flex-1 bg-pitch">
        {/* 1 — THE ENGINE BAY · tachometer + turbine + gearbox holding N */}
        <Hero />
        <HazardSeam />

        {/* 2 — THE LOOP · the autonomous org cycle as a closed node graph */}
        <Loop />
        <HazardSeam />

        {/* 3 — THE ENGINE CYCLE · the org loop as a 4-stroke engine (pinned stage) */}
        <Cycle />
        <HazardSeam />

        {/* 4 — THE DYNO ROOM · NEAR edge lab: none passed */}
        <Dyno />
        <HazardSeam />

        {/* 5 — THE CRASH TEST · the demo spread */}
        <Crash />
        <HazardSeam />

        {/* 6 — THE SHOP REPORT · the full teardown log, every verdict stamped */}
        <Report />
        <HazardSeam />

        {/* 7 — THE BLACK BOX · decisions sealed on NEAR, publicly readable */}
        <BlackBox />
        <HazardSeam />

        {/* 8 — THE GARAGE · the always-on machinery */}
        <Garage />
      </main>

      {/* license plate */}
      <footer data-scene="footer" data-loop className="relative bg-pitch">
        <div aria-hidden className="ld-content gr-hazard gr-hazard-live h-[14px] opacity-90" />
        <div className="ld-content mx-auto flex max-w-[1280px] flex-col gap-3 px-6 py-10 sm:px-10 md:flex-row md:items-center md:justify-between xl:px-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-steel">
            HELIQUANT · AUTONOMOUS MULTI-DESK TRADING FIRM · <span className="text-bitget">BITGET</span> × NEAR
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-steel/80">
            <span className="text-chartreuse">we publish the truth</span> — every number is real
          </p>
        </div>
      </footer>
    </LandingShell>
  );
}
