"use client";

/**
 * LandingShell — the landing page's runtime frame.
 *
 * Owns: Lenis smooth scroll (the ONE scroll system; `motion` only reads native scroll for scrubs),
 * the shared scroll/pointer state for the 3D canvas, the single IntersectionObserver that drives
 * every `data-reveal` entrance and pauses `data-loop` sections off-screen, and the render tier.
 * All state is written as data-attributes on #ld-root so CSS does the work without React renders.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import Lenis from "lenis";

import { detectQuality, quality, scene } from "./store";

/** Runs before first paint: marks JS as available and skips the preloader when it must not show. */
const BOOT = `(function(){var r=document.getElementById('ld-root');if(!r)return;r.dataset.js='1';var m=false,s=false;try{m=matchMedia('(prefers-reduced-motion: reduce)').matches;s=sessionStorage.getItem('ld-seen')==='1'}catch(e){}if(m||s){r.dataset.skip='1';r.dataset.ready='1'}setTimeout(function(){r.dataset.ready='1'},3600)})()`;

export default function LandingShell({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Same decisions as BOOT, for client-side navigations where the inline script did not run.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || root.dataset.js) return;
    root.dataset.js = "1";
    let seen = false;
    try {
      seen = sessionStorage.getItem("ld-seen") === "1";
    } catch {}
    if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.dataset.skip = "1";
      root.dataset.ready = "1";
    }
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    root.dataset.pointer = fine ? "fine" : "coarse";
    quality.set(detectQuality());

    // ── scroll: Lenis when motion is welcome, native otherwise ──
    let lenis: Lenis | null = null;
    let onNative: (() => void) | null = null;
    scene.y = window.scrollY;
    if (!reduced) {
      lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, autoRaf: true, anchors: true });
      lenis.on("scroll", (l) => {
        scene.y = l.scroll;
        scene.v = l.velocity;
      });
    } else {
      onNative = () => {
        scene.y = window.scrollY;
        scene.v = 0;
      };
      window.addEventListener("scroll", onNative, { passive: true });
    }

    // ── pointer (fine pointers only) ──
    const onPointer = (e: PointerEvent) => {
      scene.px = (e.clientX / window.innerWidth) * 2 - 1;
      scene.py = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (fine && !reduced) window.addEventListener("pointermove", onPointer, { passive: true });

    // ── reveals (once, or replayed inside [data-replay]) + loop pausing (continuous) ──
    // Inside a [data-replay] section the entrance plays again every time the section is reached
    // scrolling DOWN: once an element has left the viewport through its bottom edge (the reader went
    // back up above it) it is reset. Leaving through the top edge keeps it revealed, so coming back
    // up from below does not replay it.
    const replayable = (el: Element) => el.closest("[data-replay]") !== null;
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "1");
          if (!replayable(e.target)) reveal.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );
    // odometers reveal the moment any part is on screen: a number must never sit at a wrong value
    const eager = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute("data-in", "1");
        if (!replayable(e.target)) eager.unobserve(e.target);
      }
    });
    const rewind = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting || !e.rootBounds) continue;
        if (e.boundingClientRect.top >= e.rootBounds.bottom) e.target.removeAttribute("data-in");
      }
    });
    root.querySelectorAll("[data-reveal]").forEach((el) => {
      (el.getAttribute("data-reveal") === "odo" ? eager : reveal).observe(el);
      if (replayable(el)) rewind.observe(el);
    });

    const loops = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.removeAttribute("data-off");
        else e.target.setAttribute("data-off", "1");
      }
    });
    root.querySelectorAll("[data-loop]").forEach((el) => loops.observe(el));

    const onVisibility = () => {
      if (document.hidden) root.dataset.hidden = "1";
      else delete root.dataset.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      lenis?.destroy();
      if (onNative) window.removeEventListener("scroll", onNative);
      window.removeEventListener("pointermove", onPointer);
      reveal.disconnect();
      eager.disconnect();
      rewind.disconnect();
      loops.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div id="ld-root" ref={rootRef} className="flex flex-1 flex-col" suppressHydrationWarning>
      {/* BOOT as raw server HTML: the browser runs it while parsing the first load (before paint); on a
          client-side navigation React only sets innerHTML, which never executes — the layout effect above
          covers that case. Rendering a <script> element itself makes React 19 warn on client renders. */}
      <span hidden suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `<script>${BOOT}</script>` }} />
      {children}
    </div>
  );
}
