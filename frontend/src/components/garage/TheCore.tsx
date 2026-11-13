"use client";

/**
 * THE CORE — the literal engine, inspectable part by part (Night Garage).
 *
 * A procedural V8 in React Three Fiber (see ./core). The section pins while it scrolls through a
 * four-beat story — assemble, run, explode, inspect — and every part stands for one of the firm's
 * desks. Hover lights a part; clicking it (or a chip in the parts list) flies the camera in, turns
 * the rest of the engine to X-ray and opens a panel with that desk's LIVE numbers from the firm.
 *
 * Without WebGL the parts list and the live panel still work; with reduced motion the section
 * does not pin and the engine sits assembled.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import InspectPanel from "./core/InspectPanel";
import { PART, PARTS, type PartId } from "./core/parts";
import { core, coreOverlay, coreUi, useCoreUi } from "./core/store";
import { useDeskLive } from "./core/useDeskLive";

const CoreCanvas = dynamic(() => import("./core/CoreCanvas"), { ssr: false });

type Tier = "high" | "medium" | "none";

function detectTier(): Tier {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return "none";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    return "none";
  }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return coarse || cores <= 4 || memory <= 4 || window.innerWidth < 768 ? "medium" : "high";
}

const STEPS = [
  { no: "01", t: "Assemble", d: "eleven parts, one block" },
  { no: "02", t: "Run", d: "every desk turns the same crank" },
  { no: "03", t: "Explode", d: "each part stands for a desk" },
  { no: "04", t: "Inspect", d: "pick a part — its desk reports live" },
];

export default function TheCore() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [near, setNear] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [beat, setBeat] = useState(0);
  const ui = useCoreUi();
  const live = useDeskLive(onScreen);

  // tier + reduced motion, client only
  useEffect(() => {
    const r = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    core.reduced = r;
    const id = window.setTimeout(() => {
      setReduced(r);
      setTier(detectTier());
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // mount the canvas a screen early; run its frame loop only while on screen
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const pre = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "100% 0px" });
    const vis = new IntersectionObserver((e) => {
      const v = e.some((x) => x.isIntersecting);
      core.visible = v;
      setOnScreen(v);
      if (!v) coreUi.set({ selected: null, hovered: null });
    });
    pre.observe(el);
    vis.observe(el);
    return () => {
      pre.disconnect();
      vis.disconnect();
    };
  }, []);

  // scroll progress through the pinned section → story beat
  useEffect(() => {
    const el = section.current;
    const st = stage.current;
    if (!el || !st) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / span));
      core.progress = p;
      st.style.setProperty("--p", p.toFixed(4));
      const b = p < 0.3 ? 0 : p < 0.62 ? 1 : p < 0.88 ? 2 : 3;
      if (st.dataset.step !== String(b)) {
        st.dataset.step = String(b);
        setBeat(b);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const select = useCallback((id: PartId | null) => coreUi.set({ selected: id }), []);
  const step = useCallback((d: 1 | -1) => {
    const cur = coreUi.get().selected;
    const i = cur ? PARTS.findIndex((p) => p.id === cur) : -1;
    coreUi.set({ selected: PARTS[(i + d + PARTS.length) % PARTS.length].id });
  }, []);

  // keyboard: Esc closes, arrows step through the parts while inspecting
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!coreUi.get().selected) return;
      if (e.key === "Escape") select(null);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, step]);

  // reset when leaving the page
  useEffect(() => () => coreUi.set({ selected: null, hovered: null, exploded: null, ready: false }), []);

  const sel = ui.selected ? PART[ui.selected] : null;
  const hov = ui.hovered ? PART[ui.hovered] : null;
  const has3d = tier === "high" || tier === "medium";
  // what the explode button shows: the user's choice, else where the scroll story is
  const exploded = ui.exploded ?? (!reduced && beat >= 2);

  return (
    <section id="core" ref={section} className="fl-core relative bg-pitch" data-reduced={reduced ? "1" : undefined}>
      <div ref={stage} className="fl-core-stage" data-step="0" data-selected={sel ? "1" : undefined}>
        {/* the engine */}
        <div
          className="absolute inset-0"
          ref={(el) => {
            coreOverlay.stage = el;
          }}
        >
          {has3d && near && <CoreCanvas tier={tier} active={onScreen} />}
          {(!has3d || !ui.ready) && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="fl-warm font-mono text-[11px] uppercase tracking-[0.3em] text-steel">{tier === "none" ? "3D unavailable on this device — the parts list still reports live" : "warming up the engine…"}</p>
            </div>
          )}
          <div aria-hidden className="fl-core-vignette pointer-events-none absolute inset-0" />

          {/* hover label */}
          <div
            ref={(el) => {
              coreOverlay.tip = el;
            }}
            aria-hidden
            className="fl-tip pointer-events-none absolute left-0 top-0"
            data-on={hov && !sel ? "1" : undefined}
          >
            {hov && (
              <>
                <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-chartreuse">{hov.label}</span>
                <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-signal2">{hov.name}</span>
                <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-bone/60">click to inspect</span>
              </>
            )}
          </div>

          {/* anatomy hotspots for the inspected part */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              ref={(el) => {
                coreOverlay.spots[i] = el;
              }}
              aria-hidden
              className="fl-spot pointer-events-none absolute left-0 top-0"
              style={{ opacity: 0 }}
            >
              {sel?.anatomy[i] && (
                <>
                  <span className="fl-spot-dot" />
                  <span className="fl-spot-label">
                    <span className="fl-spot-num">{i + 1}</span>
                    {sel.anatomy[i]}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>

        {/* header */}
        <div className="fl-core-head pointer-events-none absolute left-0 top-0 z-10 max-w-xl px-6 pt-8 sm:px-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-steel">
            <span className="text-chartreuse">▮</span> live webgl · eleven parts · the firm, the PM and its desks
          </p>
          <h2 className="mt-3 font-display font-extrabold uppercase leading-[0.9] text-bone" style={{ fontSize: "clamp(2.4rem, 5vw, 4.2rem)" }}>
            The <span className="fl-shine text-chartreuse">core</span>
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-bone/55">
            Scroll to assemble, run and explode the engine. <span className="text-bone">Pick any part</span> — its desk reports live from the firm.
          </p>
        </div>

        {/* story rail */}
        {!reduced && (
          <ol className="fl-rail pointer-events-none absolute bottom-24 left-6 z-10 hidden space-y-3 sm:left-10 md:block" aria-hidden>
            {STEPS.map((s, i) => (
              <li key={s.no} className="fl-rail-step flex items-start gap-3" data-i={i}>
                <span className="font-mono text-[10px] tracking-[0.2em]">{s.no}</span>
                <span>
                  <span className="block font-display text-lg font-bold uppercase leading-none">{s.t}</span>
                  <span className="fl-rail-d block font-mono text-[9px] uppercase tracking-[0.16em]">{s.d}</span>
                </span>
              </li>
            ))}
            <li className="fl-rail-bar" />
          </ol>
        )}

        {/* parts list */}
        <nav aria-label="Engine parts" className="fl-parts absolute z-10">
          {PARTS.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="fl-chip"
              data-on={ui.selected === p.id ? "1" : undefined}
              data-hot={ui.hovered === p.id ? "1" : undefined}
              style={{ "--i": i } as React.CSSProperties}
              onClick={() => select(ui.selected === p.id ? null : p.id)}
              onMouseEnter={() => coreUi.set({ hovered: p.id })}
              onMouseLeave={() => coreUi.set({ hovered: null })}
              onFocus={() => coreUi.set({ hovered: p.id })}
              onBlur={() => coreUi.set({ hovered: null })}
            >
              <span className="fl-chip-label">{p.label}</span>
              <span className="fl-chip-name">{p.name}</span>
            </button>
          ))}
        </nav>

        {/* controls */}
        {has3d && (
          <div className="fl-controls absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
            <button type="button" className="fl-btn" data-on={exploded ? "1" : undefined} aria-pressed={exploded} onClick={() => coreUi.set({ exploded: !exploded })}>
              {exploded ? "Assemble" : "Exploded view"}
            </button>
            {(ui.exploded !== null || ui.selected) && (
              <button type="button" className="fl-btn fl-btn-ghost" onClick={() => coreUi.set({ exploded: null, selected: null })}>
                Reset
              </button>
            )}
            <span className="fl-hint hidden font-mono text-[10px] uppercase tracking-[0.18em] text-steel lg:inline">drag to turn · click a part</span>
          </div>
        )}

        {/* inspect panel */}
        <div className="fl-panel-wrap pointer-events-none absolute z-20">{sel && <InspectPanel part={sel} live={live} onClose={() => select(null)} onStep={step} />}</div>
      </div>
    </section>
  );
}
