"use client";

/**
 * Client parts of the hero:
 *   RotorHub   — the tachometer hub. It is the anchor the 3D turbine locks onto, it shows the flat SVG
 *                rotor until (or instead of) WebGL, and holding it revs the engine (mouse, touch,
 *                Space/Enter). The rev is silent — no audio.
 *   TachEngine — the engine simulation behind the dial. At rest the needle sits on the regime
 *                accuracy and hunts a hair around it like a real idle. Holding the hub revs from N to
 *                the redline, shifts to 1, revs again, shifts to 2 and bounces off the limiter at 100.
 *                Letting go bleeds the revs off slowly back to idle and downshifts one gear at a time
 *                back to N. The green arc is glued to the needle at all times, so arc and needle always
 *                read the same number (at rest: the accuracy). The green arc keeps showing the real
 *                regime accuracy while the box is in N, and follows the needle in gear.
 *   Ticker     — the pit-wall marquee; it runs faster while the page is scrolling fast and settles.
 */

import { useEffect, useRef, type CSSProperties } from "react";

import { scene } from "../store";
import StaticTurbine from "../StaticTurbine";

export function RotorHub() {
  const rev = (on: boolean) => {
    const root = document.getElementById("ld-root");
    scene.rev = on ? 1 : 0;
    if (root) {
      if (on) root.dataset.rev = "1";
      else delete root.dataset.rev;
    }
  };

  useEffect(() => () => rev(false), []);

  return (
    <button
      type="button"
      data-turbine-anchor
      data-cursor="drag"
      data-cursor-label="hold · rev"
      aria-label="Rotor. Hold to rev the engine."
      className="absolute left-1/2 top-1/2 aspect-square w-[52%] -translate-x-1/2 -translate-y-1/2 touch-none rounded-full"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        rev(true);
      }}
      onPointerUp={() => rev(false)}
      onPointerCancel={() => rev(false)}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) rev(true);
      }}
      onKeyUp={() => rev(false)}
      onBlur={() => rev(false)}
    >
      <StaticTurbine className="ld-static-turbine gr-rotor h-full w-full text-chartreuse" />
    </button>
  );
}

// ── engine model (every value is on the dial's 0–100 scale; idle = the accuracy passed in) ──
const REDLINE = 90;
const LIMIT = 100;
const GEARS = ["N", "1", "2"] as const;
/** climb rate per gear while held (dial units/s for a 14-unit idle→redline span; scaled to the real
 *  span): free revving in N is quick, each gear loads the engine more. Paces N→1 ≈0.9s, 1→2 ≈1.1s
 *  later, the limiter ≈2s after that. */
const CLIMB = [22, 14, 13];
/** where the revs land after an upshift into gear 1 / gear 2, as revs ABOVE idle */
const UPSHIFT_DROP = [0, 5, 7];
/** downshift points while coasting (from gear 1 / gear 2), as revs ABOVE idle, and the rev-match blip
 *  into the lower gear (also above idle) */
const DOWNSHIFT_AT = [0, 4, 10];
const DOWNSHIFT_BLIP = [7, 12, 0];
const CALLOUT = ["NEUTRAL", "1ST", "2ND"];
const angle = (v: number) => -120 + 2.4 * v;
/** a point on the dial in % of the tach box (460-unit viewBox, centre 230) */
const tip = (v: number, r = 176) => {
  const a = (angle(v) * Math.PI) / 180;
  return [((230 + r * Math.sin(a)) / 460) * 100, ((230 - r * Math.cos(a)) / 460) * 100] as const;
};
// sparks thrown from the needle tip on a shift: [dx, dy] in px
const SPARKS: [number, number][] = [
  [46, -38],
  [62, -6],
  [52, 30],
  [24, 52],
  [70, -52],
  [34, -66],
  [80, 18],
  [10, -48],
  [58, 60],
  [-14, -40],
];

export function TachEngine({ accuracy }: { accuracy: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fx = ref.current;
    const tach = fx?.closest<HTMLElement>(".ld-tach");
    const root = document.getElementById("ld-root");
    if (!fx || !tach || !root) return;
    const needle = tach.querySelector<HTMLElement>(".ld-needle");
    const fill = tach.querySelector<SVGPathElement>(".ld-tach-fill");
    const gearEls = Array.from(tach.querySelectorAll<HTMLElement>("[data-gear]"));
    const num = fx.querySelector<HTMLElement>(".ld-shift-num");
    const tag = fx.querySelector<HTMLElement>(".ld-shift-tag");
    const hub = tach.querySelector<SVGSVGElement>(".ld-static-turbine");

    const setNeedle = (v: number) => {
      if (needle) needle.style.transform = `rotate(${angle(v).toFixed(2)}deg)`;
    };
    const setFill = (v: number) => {
      if (fill) fill.style.strokeDashoffset = (100 - v).toFixed(2);
    };

    const IDLE = Math.max(0, Math.min(REDLINE - 8, accuracy)); // keep room to rev before the redline
    scene.idle = IDLE;
    const span = (REDLINE - IDLE) / 14; // CLIMB and the shift offsets are tuned for a 14-unit idle→redline span

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setNeedle(IDLE);
      setFill(accuracy);
      return;
    }

    let rpm = 0; // what the crank does
    let shown = 0; // the needle: a damped spring chasing rpm (real needles have mass)
    let vel = 0;
    let arc = 0; // the green arc
    let gear = 0;
    let gearAge = 0;
    let cut = 0; // time left in a shift (clutch in, revs moving to the new gear's speed)
    let cutTo = 0;
    let limiter = 0; // fuel-cut time left at the limiter
    let started = false;
    let flare = 0; // start-up flare after the preloader
    let idleTarget = IDLE;
    let idleNext = 0;
    let t = 0;
    let last = 0;
    let raf = 0;
    let rate = 1;

    const showGear = () => {
      for (const el of gearEls) {
        if (el.dataset.gear === GEARS[gear]) el.dataset.on = "1";
        else delete el.dataset.on;
      }
      tach.dataset.gear = GEARS[gear];
    };

    const retrigger = (el: HTMLElement, key: string, value: string) => {
      delete el.dataset[key];
      void el.offsetWidth; // forces a style flush so the CSS animations restart
      el.dataset[key] = value;
    };

    const shift = (to: number, dir: "up" | "down") => {
      const [x, y] = tip(Math.max(0, Math.min(100, shown)));
      gear = to;
      gearAge = 0;
      showGear();
      if (num) num.textContent = GEARS[to];
      if (tag) tag.textContent = `${dir === "up" ? "▲ shift" : "▼ down"} · ${CALLOUT[to]}`;
      fx.style.setProperty("--sx", `${x.toFixed(2)}%`);
      fx.style.setProperty("--sy", `${y.toFixed(2)}%`);
      retrigger(fx, "shift", dir);
      retrigger(tach, "kick", dir);
      const box = gearEls.find((el) => el.dataset.gear === GEARS[to]);
      if (box) retrigger(box, "hit", dir);
      scene.shift += 1;
      scene.shiftUp = dir === "up" ? 1 : 0;
    };

    showGear();
    setNeedle(0);
    setFill(0);

    const frame = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      t += dt;
      gearAge += dt;

      if (!started && root.dataset.ready) {
        started = true;
        flare = 0.55;
      }

      if (started) {
        // idle hunts: a new target every few hundred ms, plus fast combustion jitter
        idleNext -= dt;
        if (idleNext <= 0) {
          idleTarget = IDLE - 0.4 + Math.random() * 0.8;
          idleNext = 0.3 + Math.random() * 0.6;
        }
        const idle = idleTarget + Math.sin(t * 21) * 0.22 + Math.sin(t * 33.7) * 0.15;
        const held = scene.rev === 1;

        if (cut > 0) {
          cut -= dt;
          rpm += (cutTo - rpm) * (1 - Math.exp(-dt * 20));
        } else if (flare > 0) {
          flare -= dt;
          rpm += (IDLE + 8 - rpm) * (1 - Math.exp(-dt * 9));
        } else if (held) {
          if (limiter > 0) {
            limiter -= dt;
            rpm -= 80 * dt;
          } else {
            rpm += CLIMB[gear] * span * dt * (1 - (0.35 * rpm) / 100);
          }
          if (gear < 2 && rpm >= REDLINE) {
            rpm = REDLINE;
            cut = 0.2;
            cutTo = IDLE + UPSHIFT_DROP[gear + 1] * span;
            shift(gear + 1, "up");
          } else if (gear === 2 && rpm >= LIMIT) {
            rpm = LIMIT;
            limiter = 0.055;
          }
        } else {
          limiter = 0;
          // off the throttle: revs bleed off slowly, then settle into the idle hunt
          const k = Math.abs(rpm - idle) > 3 ? 0.85 : 4;
          rpm += (idle - rpm) * (1 - Math.exp(-dt * k));
          if (gear > 0 && gearAge > 0.45 && rpm < IDLE + DOWNSHIFT_AT[gear] * span) {
            cut = 0.16;
            cutTo = IDLE + DOWNSHIFT_BLIP[gear - 1] * span;
            shift(gear - 1, "down");
          }
        }
        rpm = Math.max(0, Math.min(LIMIT, rpm));
      }

      // needle spring (slightly under-damped: it overshoots a hair on fast moves, like a real one)
      const k = 260;
      const c = 2 * Math.sqrt(k) * 0.62;
      vel += (k * (rpm - shown) - c * vel) * dt;
      shown += vel * dt;
      setNeedle(Math.max(-1, Math.min(101, shown)));

      // arc: glued to the needle, so both always read the same value (at rest that value is the accuracy)
      arc = started ? shown : 0;
      setFill(Math.max(0, Math.min(100, arc)));

      if (limiter > 0 || (gear === 2 && rpm > 97)) tach.dataset.limiter = "1";
      else delete tach.dataset.limiter;

      scene.rpm = shown;

      // flat rotor (no WebGL) spins with the revs
      if (!root.dataset.gl && hub) {
        const anim = hub.getAnimations?.()[0];
        const target = 0.6 + (Math.max(0, shown - IDLE) / (LIMIT - IDLE)) * 11;
        if (anim && Math.abs(target - rate) > 0.15) {
          rate = target;
          anim.playbackRate = rate;
        }
      }

      raf = requestAnimationFrame(frame);
    };

    // the loop only runs while the dial is on screen
    const io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      cancelAnimationFrame(raf);
      last = 0;
      if (visible) raf = requestAnimationFrame(frame);
      else scene.rpm = IDLE;
    });
    io.observe(tach);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      scene.rpm = IDLE;
    };
  }, [accuracy]);

  return (
    <div ref={ref} aria-hidden className="ld-shift-fx pointer-events-none absolute inset-0">
      <span className="ld-shift-flash" />
      <span className="ld-shift-ring" />
      <span className="ld-shift-ring ld-shift-ring-2" />
      <span className="ld-shift-sparks">
        {SPARKS.map(([dx, dy], i) => (
          <span key={i} style={{ "--dx": `${dx}px`, "--dy": `${dy}px`, "--i": i } as CSSProperties} />
        ))}
      </span>
      <span className="ld-shift-callout">
        <span className="ld-shift-num">1</span>
        <span className="ld-shift-tag">▲ shift · 1ST</span>
      </span>
    </div>
  );
}

export function Ticker({ items }: { items: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const anim = el.getAnimations()[0];
    if (!anim) return;
    let raf = 0;
    let rate = 1;
    let visible = true;
    const frame = () => {
      const target = 1 + Math.min(Math.abs(scene.v) * 0.09, 5);
      rate += (target - rate) * 0.08;
      anim.playbackRate = rate;
      if (visible) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(frame);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="flex overflow-hidden py-3">
      <div ref={ref} className="gr-marquee flex shrink-0 items-center gap-10 pr-10">
        {[...items, ...items].map((t, i) => (
          <span key={i} className="flex items-center gap-10 whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.18em] text-bone/75">
            {t}
            <span aria-hidden className="text-chartreuse">
              ▮
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
