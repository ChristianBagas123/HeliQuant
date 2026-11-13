"use client";

/**
 * Pointer-driven primitives (fine pointers only; touch and keyboard get the plain, fully usable
 * element). They write CSS variables straight onto the element — no React state, no renders.
 *   Magnetic  — wrapper that pulls its child toward the cursor (the child owns the press transform)
 *   TiltPlate — plate that tilts in 3D with a thin glare; its hard shadow shifts opposite the tilt
 *   Scramble  — mono label that decodes from noise into its real text when it scrolls into view
 */

import { useEffect, useRef, type ReactNode, type PointerEvent as RPointerEvent } from "react";

const finePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Magnetic({ children, strength = 0.28, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: RPointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || !finePointer()) return;
    const r = el.getBoundingClientRect();
    el.dataset.pull = "1";
    el.style.setProperty("--mx", `${((e.clientX - (r.left + r.width / 2)) * strength).toFixed(1)}px`);
    el.style.setProperty("--my", `${((e.clientY - (r.top + r.height / 2)) * strength).toFixed(1)}px`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    delete el.dataset.pull;
    el.style.setProperty("--mx", "0px");
    el.style.setProperty("--my", "0px");
  };
  return (
    <span ref={ref} className={`ld-mag ${className}`} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </span>
  );
}

export function TiltPlate({
  children,
  className = "",
  shadow = "rgba(0,0,0,0.55)",
  depth = 6,
  max = 5,
}: {
  children: ReactNode;
  className?: string;
  /** hard-shadow colour (a token colour) */
  shadow?: string;
  /** resting shadow offset in px */
  depth?: number;
  /** max tilt in degrees */
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || !finePointer()) return;
    const r = el.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    el.dataset.live = "1";
    el.style.setProperty("--ry", `${(nx * max * 2).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-ny * max * 2).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${((nx + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${((ny + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--shx", `${(depth - nx * depth * 1.2).toFixed(1)}px`);
    el.style.setProperty("--shy", `${(depth - ny * depth * 1.2).toFixed(1)}px`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    delete el.dataset.live;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--shx", `${depth}px`);
    el.style.setProperty("--shy", `${depth}px`);
  };
  return (
    <div className="ld-tilt-wrap h-full">
      <div
        ref={ref}
        className={`ld-tilt ${className}`}
        style={{ ["--tilt-shadow" as string]: shadow, ["--shx" as string]: `${depth}px`, ["--shy" as string]: `${depth}px` }}
        onPointerMove={move}
        onPointerLeave={leave}
      >
        {children}
      </div>
    </div>
  );
}

const GLYPHS = "▮▯/\\<>#01N-";

export function Scramble({ text, className = "", trigger }: { text: string; className?: string; trigger?: string | number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 420);
        const keep = Math.floor(p * text.length);
        let out = text.slice(0, keep);
        for (let i = keep; i < text.length; i++) out += text[i] === " " ? " " : GLYPHS[(i * 7 + Math.floor(now / 40)) % GLYPHS.length];
        el.textContent = out;
        if (p < 1) raf = requestAnimationFrame(step);
        else el.textContent = text;
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.textContent = text;
    };
  }, [text, trigger]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden>
        {text}
      </span>
    </span>
  );
}
