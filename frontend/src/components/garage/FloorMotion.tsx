"use client";

/**
 * FloorMotion — the live floor's motion runtime (renders only the scroll-progress hairline).
 *   • marks JS as available (html[data-fl-js]) so hidden-until-revealed states apply
 *   • one IntersectionObserver reveals every [data-fx] element as it scrolls in
 *   • [data-tilt] cards lean toward the cursor (fine pointers only) and carry a glare spot
 *   • writes the page scroll progress to --fl-scroll for the hairline under the nav, and the nav's
 *     real height to --fl-nav (the pinned engine stage sits under it)
 * Elements added later (live data arriving) are picked up by a MutationObserver.
 */

import { useEffect, useRef, useState } from "react";

export default function FloorMotion() {
  useEffect(() => {
    const html = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    html.dataset.flJs = "1";

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "1");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    const seen = new WeakSet<Element>();
    const scan = () => {
      document.querySelectorAll("[data-fx]:not([data-in])").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    // tilt + glare
    const fine = window.matchMedia("(pointer: fine)").matches;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tilt]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty("--ry", `${((x - 0.5) * 5).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${((0.5 - y) * 4).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    };
    const onOut = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tilt]");
      if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    if (fine && !reduced) {
      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerout", onOut, { passive: true });
    }

    // the nav's real height (it wraps on narrower screens) — the pinned stage and the hairline sit under it
    const nav = document.querySelector("header");
    const ro = new ResizeObserver(() => {
      if (nav) html.style.setProperty("--fl-nav", `${Math.round(nav.getBoundingClientRect().height)}px`);
    });
    if (nav) ro.observe(nav);

    // page progress
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        html.style.setProperty("--fl-scroll", (window.scrollY / max).toFixed(4));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      ro.disconnect();
      html.style.removeProperty("--fl-nav");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      delete html.dataset.flJs;
      html.style.removeProperty("--fl-scroll");
    };
  }, []);

  return <div aria-hidden className="fl-progress" />;
}

/** CountUp — rolls a figure from its previous value to the new one (keeps prefix/suffix text). */
export function CountUp({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span className={className} data-count={value}>
      <CountUpInner value={value} />
    </span>
  );
}


function CountUpInner({ value }: { value: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef<number | null>(null);

  useEffect(() => {
    const m = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(value);
    if (!m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const [, pre, num, post] = m;
    const grouped = num.includes(","); // "1,234.56" rolls with its thousands separators
    const target = Number(num.replace(/,/g, ""));
    const decimals = (num.split(".")[1] ?? "").length;
    const fmt = (x: number) => (grouped ? x.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : x.toFixed(decimals));
    const start = from.current ?? 0;
    from.current = target;
    if (start === target) {
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(`${pre}${fmt(start + (target - start) * e)}${post}`);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{shown}</>;
}
