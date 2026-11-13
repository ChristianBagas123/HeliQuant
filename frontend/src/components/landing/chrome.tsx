"use client";

/**
 * Page chrome driven by scroll and pointer:
 *   HazardSeam  — the signature seam; the band opens as it crosses the viewport, stripes scrub
 *   ScrollTach  — page progress as a small tachometer arc
 *   CursorRing  — additive cursor ring with states + mono label (native cursor stays visible)
 *   Flashlight  — the carbon dot-grid lit around the cursor, aligned to the page grid
 *   Atmosphere  — static grain + vignette
 * Scrubs read native scroll through `motion` (Lenis is the only thing that moves the page).
 */

import { useEffect, useRef } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";

import { scene, usePrefersReducedMotion } from "./store";

export function HazardSeam({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 220, damping: 32, mass: 0.4 });
  // 14px at the edges of the viewport, 44px as it passes the middle
  const scaleY = useTransform(smooth, [0, 0.5, 1], [0.32, 1, 0.32]);
  const x = useTransform(smooth, [0, 1], [0, -396]);

  return (
    <div ref={ref} aria-hidden className={`ld-seam ${className}`}>
      <motion.div className="ld-seam-band" style={reduced ? { scaleY: 0.32 } : { scaleY }}>
        <motion.div className="ld-seam-strip gr-hazard" style={reduced ? undefined : { x }} />
      </motion.div>
    </div>
  );
}

const ARC = 2 * Math.PI * 20 * (240 / 360);

export function ScrollTach() {
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, { stiffness: 160, damping: 30, mass: 0.5 });
  const offset = useTransform(smooth, (p) => ARC * (1 - p));
  const label = useRef<HTMLSpanElement>(null);
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    if (label.current) label.current.textContent = String(Math.round(p * 100)).padStart(2, "0");
  });

  return (
    <div className="ld-scrolltach hidden md:block" aria-hidden>
      <div className="relative grid h-14 w-14 place-items-center border-2 border-bone/25 bg-pitch">
        <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full" style={{ transform: "rotate(150deg)" }}>
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(242,239,230,0.14)" strokeWidth="3" strokeDasharray={`${ARC} 200`} />
          <motion.circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-chartreuse)" strokeWidth="3" strokeDasharray={`${ARC} 200`} style={{ strokeDashoffset: offset }} />
        </svg>
        <span ref={label} className="font-mono text-[10px] text-bone/80">
          00
        </span>
      </div>
    </div>
  );
}

const DEFAULT_LABELS: Record<string, string> = { link: "open", press: "press", drag: "hold", inspect: "read" };

export function CursorRing() {
  const ref = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let tx = 0, ty = 0, x = 0, y = 0, raf = 0, running = false;
    const frame = () => {
      x += (tx - x) * 0.22;
      y += (ty - y) * 0.22;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      if (Math.abs(tx - x) + Math.abs(ty - y) > 0.3) raf = requestAnimationFrame(frame);
      else running = false;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      if (!el.dataset.on) {
        x = tx;
        y = ty;
        el.dataset.on = "1";
      }
      const hit = (e.target as Element | null)?.closest?.("[data-cursor], a, button");
      let state = "default";
      if (hit) state = hit.getAttribute("data-cursor") ?? (hit.tagName === "A" ? "link" : "press");
      if (el.dataset.state !== state) {
        el.dataset.state = state;
        if (label.current) label.current.textContent = hit?.getAttribute("data-cursor-label") ?? DEFAULT_LABELS[state] ?? "";
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const onDown = () => (el.dataset.down = "1");
    const onUp = () => delete el.dataset.down;
    const onLeave = () => delete el.dataset.on;

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={ref} className="ld-cursor" data-state="default" aria-hidden>
      <span className="ld-cursor-ring" />
      <span ref={label} className="ld-cursor-label font-mono text-[9px] uppercase tracking-[0.2em] text-chartreuse" />
    </div>
  );
}

const CELL = 18;
const mod = (n: number) => ((n % CELL) + CELL) % CELL;

export function Flashlight() {
  const ref = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const g = grid.current;
    if (!el || !g) return;
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cx = -999, cy = -999, raf = 0, lastY = -1, lastX = -1, lastS = -1;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (cx === lastX && cy === lastY && scene.y === lastS) return;
      lastX = cx;
      lastY = cy;
      lastS = scene.y;
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      // keep the lit dots registered to the page grid (origin = top-left of #ld-root)
      g.style.transform = `translate3d(${-mod(cx - 216)}px, ${-mod(cy - 216 + scene.y)}px, 0)`;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      cx = e.clientX;
      cy = e.clientY;
      if (!el.dataset.on) el.dataset.on = "1";
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={ref} className="ld-flash" aria-hidden>
      <div ref={grid} className="ld-flash-grid" />
    </div>
  );
}

export function Atmosphere() {
  return (
    <>
      <div className="ld-grid" aria-hidden />
      <Flashlight />
      <div className="ld-vignette" aria-hidden />
      <div className="ld-grain" aria-hidden />
    </>
  );
}
