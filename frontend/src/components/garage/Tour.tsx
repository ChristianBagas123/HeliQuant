"use client";

/**
 * Tour — a lightweight spotlight walkthrough (Night Garage). No deps.
 *
 * Give it ordered steps that each target an element by CSS selector ([data-tour="…"]).
 * It dims the page, rings the target in chartreuse, and shows a next/back/skip card. Used on
 * /onboarding to walk a new user through the form AND every navbar bay (what each is for).
 *
 * Layout rules:
 *  - steps whose target is missing or not rendered (hidden nav on narrow screens, links that only
 *    show once an engine is connected) are skipped — the counter only counts what can be shown;
 *  - scroll-reveal animations are finished on open, and the ring is re-measured every frame, so it
 *    stays glued to targets that move (reveals, layout shifts, smooth scroll);
 *  - a target taller than the screen is scrolled to its top and the ring is clipped to the viewport;
 *  - the card is placed below → above → right → left of the target, using its real size, and falls
 *    back to the bottom-right corner when nothing fits. A small arrow points at the target;
 *  - it renders into <body> through a portal, so no page stacking context (z-10 sections) can push
 *    it under the sticky nav — nav links get the spotlight too.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TourStep = { sel: string; title: string; body: string };

type Box = { top: number; left: number; width: number; height: number };
type Side = "below" | "above" | "right" | "left" | "corner" | "center";

const GAP = 14; // ring → card
const PAD = 6; // ring padding around the target
const EDGE = 12; // min distance to the viewport edge

/** a step can be shown only if its target exists and is rendered (not display:none) */
function present(sel: string): HTMLElement | null {
  const el = document.querySelector(sel) as HTMLElement | null;
  return el && el.getClientRects().length > 0 ? el : null;
}

const navHeight = () => (document.querySelector("header")?.getBoundingClientRect().bottom ?? 0);

const same = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

export default function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  // only the steps that can actually be pointed at (the tour only mounts on the client)
  const [shown] = useState(() => steps.filter((s) => present(s.sel)));
  const [i, setI] = useState(0);
  const [ring, setRing] = useState<Box | null>(null); // clipped spotlight, viewport coords
  const [target, setTarget] = useState<Box | null>(null); // full target rect
  const [view, setView] = useState({ w: 1280, h: 800, nav: 0 });
  const [card, setCard] = useState({ w: 340, h: 200 });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const step = shown[i];
  const last = i >= shown.length - 1;

  // on open: finish every pending scroll-reveal so nothing is still sliding into place under the ring
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-touring", "");
    document.querySelectorAll("[data-fx]:not([data-in])").forEach((el) => el.setAttribute("data-in", "1"));
    return () => html.removeAttribute("data-touring");
  }, []);

  // bring the target into view: tall targets align their top under the nav, others centre; nav links stay put
  useEffect(() => {
    if (!step) return;
    const el = present(step.sel);
    if (!el || el.closest("header")) return;
    const r = el.getBoundingClientRect();
    const nav = navHeight();
    const room = window.innerHeight - nav;
    const top = r.height > room * 0.62 ? window.scrollY + r.top - nav - 20 : window.scrollY + r.top - nav - (room - r.height) / 2 + 40;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  // every frame: measure the target, the viewport and the card; update state only when something moved
  useEffect(() => {
    let raf = 0;
    let prevRing: Box | null = null;
    let prevTarget: Box | null = null;
    let prevView = { w: 0, h: 0, nav: -1 };
    let prevCard = { w: 0, h: 0 };
    const tick = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const nav = navHeight();
      if (w !== prevView.w || h !== prevView.h || Math.abs(nav - prevView.nav) > 0.5) setView((prevView = { w, h, nav }));

      const c = cardRef.current;
      if (c && (c.offsetWidth !== prevCard.w || c.offsetHeight !== prevCard.h)) setCard((prevCard = { w: c.offsetWidth, h: c.offsetHeight }));

      const el = step ? present(step.sel) : null;
      let t: Box | null = null;
      let r: Box | null = null;
      if (el) {
        const b = el.getBoundingClientRect();
        t = { top: b.top, left: b.left, width: b.width, height: b.height };
        // clip to the visible area — under the sticky nav for page targets, the full viewport for nav links
        const minY = el.closest("header") ? 0 : nav + 4;
        const top = Math.max(b.top - PAD, minY);
        const bottom = Math.min(b.bottom + PAD, h - 4);
        const left = Math.max(b.left - PAD, 4);
        const right = Math.min(b.right + PAD, w - 4);
        r = bottom - top > 8 && right - left > 8 ? { top, left, width: right - left, height: bottom - top } : null;
      }
      if (!same(t, prevTarget)) setTarget((prevTarget = t));
      if (!same(r, prevRing)) setRing((prevRing = r));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // keyboard: → / Enter next · ← back · Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((p) => Math.min(p + 1, shown.length - 1));
      else if (e.key === "ArrowLeft") setI((p) => Math.max(p - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown.length, onClose]);

  if (!step) return null;

  const next = () => (last ? onClose() : setI(i + 1));
  const prev = () => i > 0 && setI(i - 1);

  // ── card placement ──
  const { w: W, h: H, nav } = view;
  const cw = Math.min(card.w, W - EDGE * 2);
  const ch = card.h;
  const top0 = nav + EDGE; // never place the card under the sticky nav (unless the target is in it)
  let side: Side = "center";
  let pos = { top: (H - ch) / 2, left: (W - cw) / 2 };
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), W - cw - EDGE);
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), H - ch - EDGE);
  if (ring) {
    const below = ring.top + ring.height + GAP;
    const above = ring.top - GAP - ch;
    const right = ring.left + ring.width + GAP;
    const left = ring.left - GAP - cw;
    const midY = clampY(ring.top + ring.height / 2 - ch / 2);
    if (below + ch <= H - EDGE) {
      side = "below";
      pos = { top: below, left: clampX(ring.left) };
    } else if (above >= top0) {
      side = "above";
      pos = { top: above, left: clampX(ring.left) };
    } else if (right + cw <= W - EDGE) {
      side = "right";
      pos = { top: midY, left: right };
    } else if (left >= EDGE) {
      side = "left";
      pos = { top: midY, left };
    } else {
      side = "corner"; // the target fills the screen — park the card bottom-right, over the target
      pos = { top: H - ch - EDGE - 8, left: W - cw - EDGE - 8 };
    }
  }

  // the arrow points at the middle of the visible target
  const arrow =
    ring && (side === "below" || side === "above")
      ? { left: Math.min(Math.max(16, ring.left + Math.min(ring.width, 220) / 2 - pos.left), cw - 28) }
      : ring && (side === "right" || side === "left")
        ? { top: Math.min(Math.max(16, ring.top + Math.min(ring.height, 160) / 2 - pos.top), ch - 28) }
        : null;
  const clipped = !!(ring && target && (target.top + target.height + PAD > ring.top + ring.height + 1 || target.top - PAD < ring.top - 1));

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-label="Guided tour" aria-modal="true">
      {/* click-catcher (clicks outside the card do nothing — the tour is modal) */}
      <div aria-hidden className="absolute inset-0" />

      {/* spotlight ring — a transparent box over the target with a huge shadow dimming the rest */}
      {ring ? (
        <div aria-hidden className="bay-tour-ring pointer-events-none fixed" style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height }}>
          {clipped && (
            <span className="absolute inset-x-0 -bottom-px flex justify-center">
              <span className="bg-chartreuse px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-pitch">continues ↓</span>
            </span>
          )}
        </div>
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 bg-pitch/80" />
      )}

      {/* the card */}
      <div
        ref={cardRef}
        className="bay-tour-card fixed border-2 border-chartreuse bg-carbon"
        data-side={side}
        style={{ top: Math.max(EDGE, pos.top), left: pos.left, width: Math.min(340, W - EDGE * 2) }}
      >
        {arrow && <span aria-hidden className="bay-tour-arrow" data-side={side} style={arrow} />}

        {/* progress — one segment per step */}
        <div aria-hidden className="flex gap-[3px] px-4 pt-4">
          {shown.map((s, k) => (
            <span key={s.sel} className={`h-[3px] flex-1 transition-colors duration-300 ${k <= i ? "bg-chartreuse" : "bg-bone/15"}`} />
          ))}
        </div>

        <div key={i} className="bay-tour-body px-4 pb-4 pt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-chartreuse">
            {String(i + 1).padStart(2, "0")} / {String(shown.length).padStart(2, "0")} · guided tour
          </p>
          <p className="mt-2 font-display text-lg font-extrabold uppercase leading-tight tracking-wide text-bone">{step.title}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-bone/65">{step.body}</p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-bone/10 px-4 py-3">
          <button onClick={onClose} className="font-mono text-[10px] uppercase tracking-[0.16em] text-steel transition-colors hover:text-bone">
            skip tour
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button
                onClick={prev}
                className="border-2 border-bone/40 px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-bone/85 transition-colors hover:border-chartreuse hover:text-chartreuse"
              >
                ◂ back
              </button>
            )}
            <button
              ref={nextRef}
              onClick={next}
              className="fl-cta gr-press border-2 border-bone bg-chartreuse px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-pitch"
            >
              {last ? "done ✓" : "next ▸"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
