"use client";

/**
 * THE RADIAL ENGINE — the live floor as a 9-cylinder radial (star) engine.
 *
 * Nine desks, nine cylinders. Aircraft radials use an ODD cylinder count so a four-stroke cycle can fire
 * every other cylinder: for nine that is 1-3-5-7-9-2-4-6-8. Here the order is not scripted — it falls out
 * of the mechanics:
 *  - the crankshaft turns continuously; the crankpin carries the master-rod hub (cylinder 1's rod), and the
 *    eight articulating rods hang off knuckle pins on that hub;
 *  - every piston's travel is solved from the crank angle (slider-crank), so the rods and pistons move
 *    like the real thing;
 *  - each cylinder reaches top dead centre once per turn and fires on alternate turns (720° per cycle),
 *    which gives the 1-3-5-7-9-2-4-6-8 firing order on its own.
 *
 * Honest output: with the registry empty the firm's decision is ABSTAIN, so a cylinder coming over the
 * top only warms (compression heat) — the plug stays dark. A chartreuse combustion flash appears only
 * on ENTER.
 *
 * Motion runs in one requestAnimationFrame loop that writes SVG attributes through refs (no React render
 * per frame), pauses when the engine is off-screen or the tab is hidden, and holds still for reduced
 * motion. Hover or focus a cylinder (or its desk tag) to read it; click to pin it.
 */

import { useEffect, useRef, useState } from "react";

type Desk = { tag: string; role: string; duty: string };

// nine of the twelve voices on the cylinders — roles + duties as published on the firm's license page
const DESKS: Desk[] = [
  { tag: "REGIME", role: "Regime / technical", duty: "reads the tape's state — trending, ranging or high volatility" },
  { tag: "MACRO", role: "Macro · Allora", duty: "decentralized AI inference as the macro read" },
  { tag: "ON-CHAIN", role: "On-chain / risk", duty: "Rhea pool whale flow, internal token-security veto" },
  { tag: "SMART-$", role: "Smart-money flow", duty: "perp positioning: OI, funding, long/short" },
  { tag: "RSRCH", role: "Research", duty: "market mood: Fear & Greed + CoinGecko global market" },
  { tag: "OI", role: "OI-contrarian", duty: "crowd positioning extremes (acts only on a validated edge)" },
  { tag: "FLOW", role: "Flow-intel", duty: "self-learning which flow signals validate — FDR-gated" },
  { tag: "WHALE", role: "Whale tracker", duty: "Hyperliquid top-PnL wallets, per traded asset" },
  { tag: "NEAR", role: "NEAR fundamentals", duty: "DeFiLlama chain TVL + fees — ecosystem risk-on/off" },
];
const N = DESKS.length;
const FIRING_ORDER = [1, 3, 5, 7, 9, 2, 4, 6, 8];
const CYCLE_MS = 6300; // one full four-stroke cycle (720° of crank) — 700 ms per firing

// geometry (SVG units, engine centred on C)
const C = 320;
const CRANK = 24; // crank throw
const ROD = 140; // master rod
const KNUCKLE = 26; // knuckle-pin radius on the master-rod hub
const ROD_ART = ROD - KNUCKLE; // articulating rods
const BORE_IN = 100; // barrel inner end (crankcase side)
const BORE_OUT = 226; // barrel outer end (head)
const HEAD = 36; // head depth
const BORE_W = 38;
const LABEL_R = 346;
const VB = { x: -60, size: 760 }; // viewBox: room for the bezel + tags

const CHART = "#c9f24b";
const BONE = "#f2efe6";
const STEEL = "#8b8b80";

const r2 = (n: number) => Math.round(n * 100) / 100;
const axis = (k: number) => (k * 40 * Math.PI) / 180; // cylinder axis, clockwise from top
// crank angle at which cylinder k (0-based) fires: TDC once per turn, every other turn
const fireAt = (k: number) => k * 40 + (k % 2 ? 360 : 0);
const phaseOf = (k: number, a: number) => (((a - fireAt(k)) % 720) + 720) % 720;

type Pose = { phi: number; pin: [number, number]; t: number[]; knuckles: [number, number][]; rods: [number, number, number, number][] };

/** solve every piston from the crank angle `a` (degrees, 0..720) */
function pose(a: number): Pose {
  const phi = a % 360;
  const p = (phi * Math.PI) / 180;
  const px = CRANK * Math.sin(p);
  const py = -CRANK * Math.cos(p);
  const t: number[] = [];
  const knuckles: [number, number][] = [];
  const rods: [number, number, number, number][] = [];
  for (let k = 0; k < N; k++) {
    const ux = Math.sin(axis(k));
    const uy = -Math.cos(axis(k));
    const kx = k === 0 ? px : px + KNUCKLE * ux;
    const ky = k === 0 ? py : py + KNUCKLE * uy;
    const len = k === 0 ? ROD : ROD_ART;
    const d = kx * ux + ky * uy;
    const tk = d + Math.sqrt(len * len - (kx * kx + ky * ky) + d * d);
    t.push(tk);
    knuckles.push([C + kx, C + ky]);
    rods.push([C + kx, C + ky, C + tk * ux, C + tk * uy]);
  }
  return { phi, pin: [C + px, C + py], t, knuckles, rods };
}

const STROKES = ["POWER", "EXHAUST", "INTAKE", "COMPRESSION"] as const;
const strokeOf = (ph: number, sparks: boolean) => {
  const s = STROKES[Math.floor(ph / 180)];
  return s === "POWER" && !sparks ? "EXPANSION · NO SPARK" : s;
};

/** cylinder head heat: a soft bone warmth over the top on ABSTAIN, a chartreuse flash on ENTER */
function heat(ph: number, sparks: boolean): number {
  if (sparks) return ph < 140 ? Math.exp(-ph / 45) : ph > 680 ? ((ph - 680) / 40) * 0.25 : 0;
  if (ph > 600) return ((ph - 600) / 120) * 0.4;
  return ph < 90 ? 0.4 * Math.exp(-ph / 40) : 0;
}

/** the cylinder whose firing came most recently */
const currentAt = (a: number) => {
  let best = 0;
  for (let k = 1; k < N; k++) if (phaseOf(k, a) < phaseOf(best, a)) best = k;
  return best;
};

const P0 = pose(0);
// the stroke readout is written by the frame loop; React only renders this first value (so a re-render never resets it)
const INIT_STROKE = strokeOf(0, false);

export default function RadialEngine({ decision = "ABSTAIN" }: { decision?: string }) {
  const sparks = decision === "ENTER"; // honest: no validated edge → no spark
  const [cur, setCur] = useState(0); // cylinder (0-based) on its firing beat
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const sel = pinned ?? hover ?? cur;
  const focus = pinned ?? hover; // a cylinder the reader is looking at (dims the rest)

  const wrap = useRef<HTMLDivElement>(null);
  const crank = useRef<SVGGElement>(null);
  const hub = useRef<SVGGElement>(null);
  const marker = useRef<SVGGElement>(null);
  const pistons = useRef<(SVGGElement | null)[]>([]);
  const rods = useRef<(SVGLineElement | null)[]>([]);
  const glows = useRef<(SVGCircleElement | null)[]>([]);
  const wheel = useRef<SVGGElement>(null);
  const crankTxt = useRef<HTMLSpanElement>(null);
  const strokeTxt = useRef<HTMLSpanElement>(null);
  const selRef = useRef(0);
  const sparksRef = useRef(sparks);

  useEffect(() => {
    selRef.current = sel;
    sparksRef.current = sparks;
  }, [sel, sparks]);

  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let onScreen = false;
    let a = 0; // crank angle, 0..720
    let last = 0;
    let lastCur = 0;
    let lastStroke = "";
    let lastSel = -1;

    const draw = (ang: number) => {
      const P = pose(ang);
      crank.current?.setAttribute("transform", `rotate(${r2(P.phi)} ${C} ${C})`);
      hub.current?.setAttribute("transform", `translate(${r2(P.pin[0] - C)} ${r2(P.pin[1] - C)})`);
      marker.current?.setAttribute("transform", `rotate(${r2(P.phi)} ${C} ${C})`);
      for (let k = 0; k < N; k++) {
        pistons.current[k]?.setAttribute("transform", `translate(0 ${r2(P0.t[k] - P.t[k])})`);
        const rod = rods.current[k];
        if (rod) {
          const [x1, y1, x2, y2] = P.rods[k];
          rod.setAttribute("x1", `${r2(x1)}`);
          rod.setAttribute("y1", `${r2(y1)}`);
          rod.setAttribute("x2", `${r2(x2)}`);
          rod.setAttribute("y2", `${r2(y2)}`);
        }
        glows.current[k]?.setAttribute("opacity", `${r2(heat(phaseOf(k, ang), sparksRef.current))}`);
      }
      const s = selRef.current;
      const ph = phaseOf(s, ang);
      wheel.current?.setAttribute("transform", `rotate(${r2(ph / 2)} 60 60)`);
      if (crankTxt.current) crankTxt.current.textContent = `${String(Math.floor(ang)).padStart(3, "0")}°`;
      const st = strokeOf(ph, sparksRef.current);
      if ((st !== lastStroke || s !== lastSel) && strokeTxt.current) {
        strokeTxt.current.textContent = lastStroke = st;
        lastSel = s;
      }
      const c = currentAt(ang);
      if (c !== lastCur) setCur((lastCur = c));
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 64) : 0;
      last = now;
      a = (a + (dt / CYCLE_MS) * 720) % 720;
      draw(a);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (raf || reduce || !onScreen || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    draw(0);
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(host);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const pick = (k: number) => setPinned((p) => (p === k ? null : k));
  const desk = DESKS[sel];
  const orderPos = FIRING_ORDER.indexOf(sel + 1);
  const curPos = FIRING_ORDER.indexOf(cur + 1);
  const accent = sparks ? CHART : BONE;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-center">
      {/* ── the engine ── */}
      <div ref={wrap} className="re-stage relative mx-auto w-full max-w-[600px]" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`${VB.x} ${VB.x} ${VB.size} ${VB.size}`} className="relative w-full" role="img" aria-label="Nine-cylinder radial engine — one desk per cylinder">
          <defs>
            <linearGradient id="re-barrel" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#151513" />
              <stop offset="0.28" stopColor="#4b4b44" />
              <stop offset="0.5" stopColor="#2a2a26" />
              <stop offset="0.72" stopColor="#3a3a34" />
              <stop offset="1" stopColor="#121210" />
            </linearGradient>
            <linearGradient id="re-head" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#1b1b18" />
              <stop offset="0.3" stopColor="#5a5a52" />
              <stop offset="0.55" stopColor="#30302b" />
              <stop offset="1" stopColor="#161614" />
            </linearGradient>
            <linearGradient id="re-piston" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#8b8b80" />
              <stop offset="0.35" stopColor="#f2efe6" />
              <stop offset="0.7" stopColor="#b9b6ab" />
              <stop offset="1" stopColor="#6d6d64" />
            </linearGradient>
            <radialGradient id="re-case" cx="0.42" cy="0.38" r="0.7">
              <stop offset="0" stopColor="#3a3a34" />
              <stop offset="0.6" stopColor="#1e1e1b" />
              <stop offset="1" stopColor="#0e0e0c" />
            </radialGradient>
            <radialGradient id="re-heat">
              <stop offset="0" stopColor={accent} stopOpacity="1" />
              <stop offset="0.45" stopColor={accent} stopOpacity="0.45" />
              <stop offset="1" stopColor={accent} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="re-floor">
              <stop offset="0" stopColor="#c9f24b" stopOpacity="0.1" />
              <stop offset="1" stopColor="#c9f24b" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx={C} cy={C} r={330} fill="url(#re-floor)" />

          {/* bezel — crank degrees, a major tick on every cylinder axis, the crank marker riding the rim */}
          <circle cx={C} cy={C} r={306} fill="none" stroke="rgba(242,239,230,0.16)" strokeWidth="1.5" />
          <circle cx={C} cy={C} r={296} fill="none" stroke="rgba(242,239,230,0.07)" strokeWidth="1" strokeDasharray="2 5" />
          {Array.from({ length: 36 }, (_, i) => {
            const major = i % 4 === 0;
            const ang = (i * 10 * Math.PI) / 180;
            const r1 = major ? 296 : 301;
            return (
              <line
                key={i}
                x1={r2(C + r1 * Math.sin(ang))}
                y1={r2(C - r1 * Math.cos(ang))}
                x2={r2(C + 306 * Math.sin(ang))}
                y2={r2(C - 306 * Math.cos(ang))}
                stroke="rgba(242,239,230,0.45)"
                strokeWidth={major ? 2 : 1}
                opacity={major ? 0.9 : 0.4}
              />
            );
          })}
          <g ref={marker} transform={`rotate(0 ${C} ${C})`}>
            <path d={`M${C} ${C - 309} l-7 -12 h14 z`} fill={CHART} />
          </g>

          {/* ignition harness ring */}
          <circle cx={C} cy={C} r={286} fill="none" stroke="rgba(201,242,75,0.18)" strokeWidth="2" />

          {/* the nine cylinders (static metal) */}
          {DESKS.map((d, k) => {
            const on = focus === k || (focus === null && cur === k);
            const dim = focus !== null && focus !== k;
            const fins = Array.from({ length: 15 }, (_, i) => BORE_IN + 6 + i * 8);
            return (
              <g key={d.tag} transform={`rotate(${k * 40} ${C} ${C})`} style={{ opacity: dim ? 0.45 : 1, transition: "opacity 0.3s" }}>
                {/* cooling fins (taper wider toward the head) */}
                {fins.map((y) => {
                  const w = 7 + ((y - BORE_IN) / (BORE_OUT - BORE_IN)) * 12;
                  return (
                    <g key={y} stroke="#3f3f39" strokeWidth="3.2">
                      <line x1={C - BORE_W / 2 - w} y1={C - y} x2={C - BORE_W / 2} y2={C - y} />
                      <line x1={C + BORE_W / 2} y1={C - y} x2={C + BORE_W / 2 + w} y2={C - y} />
                    </g>
                  );
                })}
                {/* barrel wall + bore (x-ray) */}
                <rect x={C - BORE_W / 2 - 4} y={C - BORE_OUT} width={BORE_W + 8} height={BORE_OUT - BORE_IN} fill="url(#re-barrel)" />
                <rect x={C - BORE_W / 2} y={C - BORE_OUT} width={BORE_W} height={BORE_OUT - BORE_IN} fill="#0b0b0b" opacity="0.88" />
                {/* head with its own fins, rocker boxes, plug + lead */}
                {[0, 7, 14, 21].map((o) => (
                  <line key={o} x1={C - 40} y1={C - BORE_OUT - 6 - o} x2={C + 40} y2={C - BORE_OUT - 6 - o} stroke="#45453e" strokeWidth="3.2" />
                ))}
                <rect x={C - 28} y={C - BORE_OUT - HEAD} width={56} height={HEAD} rx={7} fill="url(#re-head)" stroke={on ? accent : "rgba(242,239,230,0.28)"} strokeWidth={on ? 2.2 : 1.4} style={{ transition: "stroke 0.3s" }} />
                <rect x={C - 24} y={C - BORE_OUT - HEAD - 10} width={16} height={11} rx={2} fill="#2c2c28" stroke="rgba(242,239,230,0.25)" />
                <rect x={C + 8} y={C - BORE_OUT - HEAD - 10} width={16} height={11} rx={2} fill="#2c2c28" stroke="rgba(242,239,230,0.25)" />
                {/* pushrods */}
                <line x1={C - 26} y1={C - BORE_IN + 6} x2={C - 18} y2={C - BORE_OUT - HEAD - 4} stroke="#6d6d64" strokeWidth="2.4" />
                <line x1={C + 26} y1={C - BORE_IN + 6} x2={C + 18} y2={C - BORE_OUT - HEAD - 4} stroke="#6d6d64" strokeWidth="2.4" />
                {/* spark plug + harness lead */}
                <rect x={C + 28} y={C - BORE_OUT - 24} width={9} height={7} fill={on && sparks ? CHART : "#8b8b80"} />
                <path d={`M${C + 37} ${C - BORE_OUT - 20} Q${C + 70} ${C - BORE_OUT - 28} ${C + 79} ${C - 274}`} fill="none" stroke="rgba(201,242,75,0.35)" strokeWidth="1.6" />
                {/* head heat (driven per frame) */}
                <circle ref={(el) => void (glows.current[k] = el)} cx={C} cy={C - BORE_OUT + 12} r={40} fill="url(#re-heat)" opacity="0" style={{ mixBlendMode: "screen" }} />
                {/* number */}
                <text x={C} y={C - BORE_OUT - HEAD - 18} textAnchor="middle" className="font-mono" style={{ fontSize: 14, fontWeight: 700, fill: on ? accent : "rgba(242,239,230,0.5)", transition: "fill 0.3s" }}>
                  {k + 1}
                </text>
              </g>
            );
          })}

          {/* crankcase + bolt ring, with an x-ray window onto the master-rod hub */}
          <circle cx={C} cy={C} r={98} fill="url(#re-case)" stroke="rgba(242,239,230,0.35)" strokeWidth="2" />
          {Array.from({ length: 18 }, (_, i) => {
            const ang = (i * 20 * Math.PI) / 180;
            return <circle key={i} cx={r2(C + 86 * Math.sin(ang))} cy={r2(C - 86 * Math.cos(ang))} r={2.6} fill="#6d6d64" />;
          })}
          <circle cx={C} cy={C} r={70} fill="#0b0b0b" stroke="rgba(242,239,230,0.18)" strokeWidth="1.5" />

          {/* crankshaft web + counterweight (rotates with the crank) */}
          <g ref={crank} transform={`rotate(0 ${C} ${C})`}>
            <path d={`M${C - 40} ${C + 8} A40 40 0 0 0 ${C + 40} ${C + 8} Z`} fill="#2e2e2a" stroke="rgba(242,239,230,0.3)" strokeWidth="1.2" />
            <line x1={C} y1={C} x2={C} y2={C - CRANK} stroke="#5a5a52" strokeWidth="14" strokeLinecap="round" />
          </g>

          {/* connecting rods (master rod = cylinder 1) */}
          {P0.rods.map(([x1, y1, x2, y2], k) => (
            <line
              key={k}
              ref={(el) => void (rods.current[k] = el)}
              x1={r2(x1)}
              y1={r2(y1)}
              x2={r2(x2)}
              y2={r2(y2)}
              stroke={k === 0 ? "#b9b6ab" : "#8b8b80"}
              strokeWidth={k === 0 ? 7 : 4.5}
              strokeLinecap="round"
            />
          ))}

          {/* pistons */}
          {DESKS.map((d, k) => {
            const t = P0.t[k];
            const on = focus === k || (focus === null && cur === k);
            return (
              <g key={d.tag} transform={`rotate(${k * 40} ${C} ${C})`}>
                <g ref={(el) => void (pistons.current[k] = el)}>
                  <rect x={C - 17} y={r2(C - t - 22)} width={34} height={36} rx={3} fill="url(#re-piston)" stroke={on ? accent : "rgba(11,11,11,0.6)"} strokeWidth={on ? 2 : 1} />
                  <line x1={C - 17} y1={r2(C - t - 15)} x2={C + 17} y2={r2(C - t - 15)} stroke="#4b4b44" strokeWidth="1.4" />
                  <line x1={C - 17} y1={r2(C - t - 10)} x2={C + 17} y2={r2(C - t - 10)} stroke="#4b4b44" strokeWidth="1.4" />
                  <circle cx={C} cy={r2(C - t)} r={4} fill="#2a2a26" />
                </g>
              </g>
            );
          })}

          {/* master-rod hub + knuckle pins (rides the crankpin) */}
          <g ref={hub} transform={`translate(${r2(P0.pin[0] - C)} ${r2(P0.pin[1] - C)})`}>
            <circle cx={C} cy={C} r={36} fill="#24241f" stroke="rgba(242,239,230,0.45)" strokeWidth="2" />
            {P0.knuckles.slice(1).map((_, i) => {
              const ang = axis(i + 1);
              return <circle key={i} cx={r2(C + KNUCKLE * Math.sin(ang))} cy={r2(C - KNUCKLE * Math.cos(ang))} r={3.4} fill="#b9b6ab" />;
            })}
            <circle cx={C} cy={C} r={11} fill="#0b0b0b" stroke={accent} strokeWidth="2.2" />
          </g>
          {/* prop-shaft nose */}
          <circle cx={C} cy={C} r={6} fill={accent} opacity="0.9" />

          {/* hit areas — one per cylinder */}
          {DESKS.map((d, k) => (
            <rect
              key={d.tag}
              x={C - 44}
              y={C - BORE_OUT - HEAD - 30}
              width={88}
              height={BORE_OUT + HEAD + 30 - BORE_IN}
              transform={`rotate(${k * 40} ${C} ${C})`}
              fill="transparent"
              className="cursor-pointer"
              onPointerEnter={() => setHover(k)}
              onClick={() => pick(k)}
            />
          ))}
        </svg>

        {/* desk tags around the bezel (HTML so type stays crisp; focusable) */}
        {DESKS.map((d, k) => {
          const ang = axis(k);
          const on = sel === k;
          const x = ((C + LABEL_R * Math.sin(ang) - VB.x) / VB.size) * 100;
          const y = ((C - LABEL_R * Math.cos(ang) - VB.x) / VB.size) * 100;
          return (
            <button
              key={d.tag}
              type="button"
              aria-pressed={pinned === k}
              aria-label={`Cylinder ${k + 1} — ${d.role}`}
              onPointerEnter={() => setHover(k)}
              onFocus={() => setHover(k)}
              onBlur={() => setHover(null)}
              onClick={() => pick(k)}
              className="re-tag absolute hidden -translate-x-1/2 -translate-y-1/2 sm:block"
              data-on={on ? "" : undefined}
              data-pinned={pinned === k ? "" : undefined}
              style={{ left: `${r2(x)}%`, top: `${r2(y)}%` }}
            >
              {d.tag}
            </button>
          );
        })}
      </div>

      {/* ── telemetry: the selected cylinder, its four-stroke wheel, the firing-order ribbon ── */}
      <div className="flex flex-col gap-4">
        <div className="fl-card relative border-2 border-bone/20 bg-pitch p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-steel">
                cylinder {String(sel + 1).padStart(2, "0")} · fires {orderPos + 1} of 9
                {pinned !== null ? <span className="text-chartreuse"> · pinned</span> : hover !== null ? " · hover" : " · on the beat"}
              </p>
              <p key={sel} className="re-swap mt-2 font-display text-3xl font-extrabold uppercase leading-none tracking-wide text-bone">
                {desk.role}
              </p>
              <p key={`d${sel}`} className="re-swap mt-2 text-[13px] leading-relaxed text-bone/60">
                {desk.duty}
              </p>
            </div>
            {/* four-stroke wheel: 720° of crank on one turn of the dial */}
            <svg viewBox="0 0 120 120" className="h-24 w-24 shrink-0" aria-hidden>
              {STROKES.map((s, i) => {
                const a0 = (i * 90 * Math.PI) / 180;
                const a1 = ((i + 1) * 90 * Math.PI) / 180;
                const p = (a: number, r: number) => `${r2(60 + r * Math.sin(a))} ${r2(60 - r * Math.cos(a))}`;
                return (
                  <path
                    key={s}
                    d={`M${p(a0, 50)} A50 50 0 0 1 ${p(a1, 50)} L${p(a1, 34)} A34 34 0 0 0 ${p(a0, 34)} Z`}
                    fill={s === "POWER" ? (sparks ? "rgba(201,242,75,0.5)" : "rgba(242,239,230,0.14)") : s === "COMPRESSION" ? "rgba(242,239,230,0.2)" : "rgba(242,239,230,0.07)"}
                    stroke="#0b0b0b"
                    strokeWidth="2"
                  />
                );
              })}
              <text x="60" y="57" textAnchor="middle" className="font-mono" style={{ fontSize: 8, fill: STEEL, letterSpacing: 1 }}>
                PWR→EXH
              </text>
              <text x="60" y="69" textAnchor="middle" className="font-mono" style={{ fontSize: 8, fill: STEEL, letterSpacing: 1 }}>
                →INT→CMP
              </text>
              <g ref={wheel} transform="rotate(0 60 60)">
                <line x1="60" y1="60" x2="60" y2="6" stroke={CHART} strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="60" cy="8" r="3.5" fill={CHART} />
              </g>
              <circle cx="60" cy="60" r="4" fill={CHART} />
            </svg>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-px border border-bone/10 bg-bone/10">
            <div className="bg-carbon px-3 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-steel">stroke now</p>
              <span ref={strokeTxt} className="mt-1 block font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-bone">
                {INIT_STROKE}
              </span>
            </div>
            <div className="bg-carbon px-3 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-steel">crank · 720° cycle</p>
              <span ref={crankTxt} className="mt-1 block font-mono text-[12px] font-bold tabular-nums tracking-[0.12em] text-bone">
                000°
              </span>
            </div>
          </div>
        </div>

        {/* firing-order ribbon — the marker slides to whichever cylinder is on its beat */}
        <div className="border-2 border-bone/20 bg-pitch p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-steel">firing order · every other cylinder</p>
          <div className="relative mt-3 grid grid-cols-9">
            <span aria-hidden className="re-slot absolute inset-y-0 left-0 w-[calc(100%/9)] border-2 border-chartreuse" style={{ transform: `translateX(${curPos * 100}%)` }} />
            {FIRING_ORDER.map((n) => (
              <button
                key={n}
                type="button"
                onPointerEnter={() => setHover(n - 1)}
                onPointerLeave={() => setHover(null)}
                onClick={() => pick(n - 1)}
                className={`relative py-2 text-center font-display text-lg font-extrabold transition-colors ${n - 1 === cur ? "text-chartreuse" : n - 1 === sel ? "text-bone" : "text-bone/40 hover:text-bone"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-steel">
            on the beat ▸ <span className="text-bone">{DESKS[cur].tag}</span>
          </p>
        </div>

        {/* the honest output plate */}
        <div className="bay-note bg-carbon px-4 py-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em]">
          {sparks ? (
            <span className="text-chartreuse">combustion — ENTER · the plugs fire on a validated edge</span>
          ) : (
            <span className="text-bone/85">
              no spark — registry empty → gear N · <span className="text-steel">pistons run, the desks keep reading; the plug waits for a validated edge</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
