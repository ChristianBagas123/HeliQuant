/**
 * StaticTurbine — the six-blade rotor drawn as flat SVG (hex hub, six tapered blades, six ring arcs).
 * It is the no-WebGL / reduced-motion / low-tier stand-in for the 3D turbine, and the preloader rotor.
 * Drawn from the brand mark's geometry; colour is the chartreuse token via currentColor, finished
 * with a metallic gradient, a polished hub and a glint that sweeps across the parts.
 */

import { useId } from "react";

const BLADES = [0, 1, 2, 3, 4, 5];

function hexPoints(r: number) {
  return BLADES.map((i) => {
    const a = ((i * 60 + 30) * Math.PI) / 180;
    return `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
  }).join(" ");
}

/** the rotor's parts; drawn once in colour and once (in white) as the glint mask */
function Parts({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <>
      <g fill={fill}>
        {BLADES.map((i) => (
          <polygon key={i} points="35,13 62,9 104,1 62,-7 35,-11" transform={`rotate(${i * 60 + 30})`} />
        ))}
      </g>
      <polygon points={hexPoints(34)} fill="none" stroke={stroke} strokeWidth="11" strokeLinejoin="miter" />
      {/* ring arcs sit between the blades: 38° of arc, 22° of gap */}
      <circle r="74" fill="none" stroke={stroke} strokeWidth="7" strokeDasharray="49.08 28.41" transform="rotate(41)" />
    </>
  );
}

export default function StaticTurbine({ className = "" }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const metal = `ldm${id}`;
  const shine = `lds${id}`;
  const mask = `ldk${id}`;
  const chrome = `ldc${id}`;

  return (
    <svg viewBox="-110 -110 220 220" className={className} aria-hidden focusable="false">
      <defs>
        {/* brushed livery: bright edge, the token colour, a deep shadow side */}
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7ffd9" />
          <stop offset="0.35" stopColor="currentColor" />
          <stop offset="0.7" stopColor="currentColor" stopOpacity="0.78" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={chrome} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#d9d6cc" />
          <stop offset="1" stopColor="#5d5b55" />
        </radialGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="-110" y="-110" width="220" height="220">
          <Parts fill="#fff" stroke="#fff" />
        </mask>
      </defs>
      <Parts fill={`url(#${metal})`} stroke="currentColor" />
      {/* polished hub nut */}
      <polygon points={hexPoints(17)} fill={`url(#${chrome})`} />
      {/* glint sweeping across the parts */}
      <g mask={`url(#${mask})`}>
        <rect className="ld-turbine-glint" x="-30" y="-160" width="60" height="320" fill={`url(#${shine})`} />
      </g>
    </svg>
  );
}
