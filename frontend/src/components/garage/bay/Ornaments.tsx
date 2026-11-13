/**
 * Ornaments — one quiet, slowly moving line drawing behind each bay's hero (aria-hidden, CSS-only
 * motion, masked to fade at the edges). Each one draws that page's own instrument: a carry gauge,
 * the grid's lanes, the tuning bay's scope, the crew's constellation, the ledger's block chain and
 * the dyno's power curves, the proof's signature seal, telemetry's radar, the dyno bays' stands, the
 * license's homologation stamp, the register page's wiring into a lock, the hire page's escrow vault door and the pit's
 * torque wrench on a bolt with its socket rail, and your floor's garage shutter over an empty lane.
 */

export type OrnamentKind = "edge" | "grid" | "tuning" | "crew" | "ledger" | "dyno" | "proof" | "radar" | "bays" | "license" | "register" | "vault" | "pit" | "shutter";

const STROKE = { fill: "none", stroke: "currentColor", vectorEffect: "non-scaling-stroke" } as const;

function Gauge() {
  const cx = 280, cy = 230, r = 180;
  const pt = (deg: number, rr = r) => [+(cx + rr * Math.cos((deg * Math.PI) / 180)).toFixed(2), +(cy - rr * Math.sin((deg * Math.PI) / 180)).toFixed(2)] as const;
  const [sx, sy] = pt(200), [ex, ey] = pt(-20), [rx, ry] = pt(20);
  const ticks = Array.from({ length: 21 }, (_, i) => 200 - i * 11);
  return (
    <svg viewBox="0 0 560 340">
      <path d={`M${sx} ${sy} A${r} ${r} 0 1 1 ${ex} ${ey}`} {...STROKE} strokeOpacity="0.5" strokeWidth="1.5" />
      <path d={`M${rx} ${ry} A${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="var(--color-signal2)" strokeWidth="4" strokeOpacity="0.8" />
      <circle cx={cx} cy={cy} r="140" {...STROKE} strokeOpacity="0.2" strokeDasharray="2 6" />
      {ticks.map((d, i) => {
        const [x1, y1] = pt(d, i % 5 === 0 ? 156 : 166), [x2, y2] = pt(d, 178);
        return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeOpacity={i % 5 === 0 ? 0.8 : 0.35} strokeWidth={i % 5 === 0 ? 2 : 1} />;
      })}
      <g className="bay-o-needle">
        <line x1={cx} y1={cy} x2={cx} y2={cy - 168} stroke="currentColor" strokeWidth="2.5" />
        <circle cx={cx} cy={cy - 168} r="3" fill="currentColor" />
      </g>
      <circle cx={cx} cy={cy} r="11" fill="var(--color-pitch)" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Lanes() {
  const vx = 280, vy = 24;
  const xs = [-120, 40, 200, 360, 520, 680];
  return (
    <svg viewBox="0 0 560 340">
      <line x1="0" y1={vy} x2="560" y2={vy} {...STROKE} strokeOpacity="0.15" />
      {xs.map((x) => <line key={x} x1={x} y1="340" x2={vx} y2={vy} {...STROKE} strokeOpacity="0.45" strokeWidth="1.5" />)}
      {xs.slice(0, -1).map((x, i) => {
        const mx = (x + xs[i + 1]) / 2;
        return <line key={mx} x1={mx} y1="340" x2={vx} y2={vy} {...STROKE} className="bay-o-dash" strokeOpacity="0.35" strokeWidth="2" style={{ animationDelay: `${i * -0.2}s` }} />;
      })}
      <rect x="270" y="190" width="20" height="20" transform="rotate(45 280 200)" {...STROKE} strokeWidth="2" />
    </svg>
  );
}

function wave(amp: number, period: number, y0: number) {
  let d = "";
  for (let x = 0; x <= 840; x += 4) d += `${x ? "L" : "M"}${x} ${(y0 + amp * Math.sin((2 * Math.PI * x) / period)).toFixed(1)}`;
  return d;
}

function Scope() {
  return (
    <svg viewBox="0 0 560 340">
      {Array.from({ length: 13 }, (_, i) => <line key={`v${i}`} x1={i * 46} y1="20" x2={i * 46} y2="320" {...STROKE} strokeOpacity="0.1" />)}
      {Array.from({ length: 7 }, (_, i) => <line key={`h${i}`} x1="0" y1={20 + i * 50} x2="560" y2={20 + i * 50} {...STROKE} strokeOpacity={i === 3 ? 0.3 : 0.1} />)}
      <path className="bay-o-wave" d={wave(70, 280, 170)} {...STROKE} strokeWidth="2.5" />
      <path className="bay-o-wave bay-o-wave-2" d={wave(28, 140, 170)} fill="none" stroke="var(--color-signal2)" strokeOpacity="0.6" strokeWidth="1.5" />
    </svg>
  );
}

function Constellation() {
  const cx = 280, cy = 170;
  const nodes = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return [+(cx + 220 * Math.cos(a)).toFixed(2), +(cy + 130 * Math.sin(a)).toFixed(2)] as const;
  });
  return (
    <svg viewBox="0 0 560 340">
      <ellipse cx={cx} cy={cy} rx="220" ry="130" {...STROKE} strokeOpacity="0.2" />
      <ellipse cx={cx} cy={cy} rx="120" ry="70" {...STROKE} strokeOpacity="0.12" strokeDasharray="2 6" />
      {nodes.map(([x, y], i) => <line key={`l${i}`} x1={cx} y1={cy} x2={x} y2={y} {...STROKE} className="bay-o-link" strokeOpacity="0.3" />)}
      {nodes.map(([x, y], i) => <circle key={`n${i}`} cx={x} cy={y} r="5" fill="currentColor" className="bay-o-node" style={{ "--i": i } as React.CSSProperties} />)}
      <rect x={cx - 12} y={cy - 12} width="24" height="24" transform={`rotate(45 ${cx} ${cy})`} fill="var(--color-pitch)" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const HEX = ["a3f9…0c1e", "7be2…d94a", "0f5c…81b7", "e41d…2a6f", "9c07…f3d2", "52ab…6e90", "d8f3…1c4b", "36e0…a7d5", "c1b8…5f02", "6a4d…e8c3"];

function Chain() {
  return (
    <svg viewBox="0 0 560 340">
      <line x1="300" y1="0" x2="300" y2="340" {...STROKE} strokeOpacity="0.2" strokeDasharray="2 6" />
      <g className="bay-o-chain">
        {HEX.map((h, i) => {
          const y = -40 + i * 60;
          return (
            <g key={h}>
              <line x1="420" y1={y + 40} x2="420" y2={y + 60} stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
              <rect x="340" y={y} width="160" height="40" {...STROKE} strokeOpacity={i % 3 === 0 ? 0.9 : 0.4} strokeWidth="1.5" />
              <circle cx="300" cy={y + 20} r={i % 3 === 0 ? 4 : 2.5} fill="currentColor" fillOpacity={i % 3 === 0 ? 1 : 0.4} />
              <text x="356" y={y + 25} fill="currentColor" fillOpacity="0.6" fontSize="12" fontFamily="var(--font-mono)" letterSpacing="1.5">{h}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function Dyno() {
  return (
    <svg viewBox="0 0 560 340">
      {Array.from({ length: 8 }, (_, i) => <line key={`v${i}`} x1={60 + i * 66} y1="30" x2={60 + i * 66} y2="300" {...STROKE} strokeOpacity="0.1" />)}
      {Array.from({ length: 6 }, (_, i) => <line key={`h${i}`} x1="60" y1={30 + i * 54} x2="520" y2={30 + i * 54} {...STROKE} strokeOpacity="0.1" />)}
      <path d="M60 30 V300 H520" {...STROKE} strokeOpacity="0.5" strokeWidth="1.5" />
      <path className="bay-o-draw" pathLength={1} d="M60 280 C140 250 190 110 280 92 S420 120 520 190" {...STROKE} strokeWidth="2.5" />
      <path className="bay-o-draw bay-o-draw-2" pathLength={1} d="M60 296 C150 290 230 220 300 160 S440 60 520 52" fill="none" stroke="var(--color-signal2)" strokeOpacity="0.75" strokeWidth="2" />
    </svg>
  );
}

const r2 = (n: number) => +n.toFixed(2); // server/client trig can differ in the last digit

function Seal() {
  const cx = 280, cy = 170;
  const ticks = Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2);
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return `${r2(cx + 62 * Math.cos(a))},${r2(cy + 62 * Math.sin(a))}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 560 340">
      <g className="bay-o-spin">
        <circle cx={cx} cy={cy} r="150" {...STROKE} strokeOpacity="0.35" strokeDasharray="2 7" />
        {ticks.map((a, i) => {
          const r = i % 4 ? 134 : 140;
          return <line key={i} x1={r2(cx + 128 * Math.cos(a))} y1={r2(cy + 128 * Math.sin(a))} x2={r2(cx + r * Math.cos(a))} y2={r2(cy + r * Math.sin(a))} stroke="currentColor" strokeOpacity={i % 4 ? 0.3 : 0.7} />;
        })}
      </g>
      <g className="bay-o-spin bay-o-spin-rev">
        <circle cx={cx} cy={cy} r="104" {...STROKE} strokeOpacity="0.5" strokeDasharray="40 14" strokeWidth="2" />
      </g>
      <polygon points={hex} {...STROKE} strokeOpacity="0.8" strokeWidth="2" />
      <path className="bay-o-draw" pathLength={1} d={`M${cx - 26} ${cy + 2} L${cx - 6} ${cy + 22} L${cx + 30} ${cy - 20}`} {...STROKE} strokeWidth="4" strokeLinecap="square" />
    </svg>
  );
}

function Radar() {
  const cx = 300, cy = 175;
  const blips: [number, number, number][] = [[70, -60, 0], [-90, 40, 1], [110, 70, 2], [-40, -110, 3], [30, 120, 4], [-130, -20, 5]];
  return (
    <svg viewBox="0 0 560 340">
      <defs>
        <linearGradient id="bay-radar-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {[50, 100, 150].map((r) => <circle key={r} cx={cx} cy={cy} r={r} {...STROKE} strokeOpacity="0.25" />)}
      <line x1={cx - 160} y1={cy} x2={cx + 160} y2={cy} {...STROKE} strokeOpacity="0.15" />
      <line x1={cx} y1={cy - 160} x2={cx} y2={cy + 160} {...STROKE} strokeOpacity="0.15" />
      <g className="bay-o-spin bay-o-spin-fast" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <path d={`M${cx} ${cy} L${cx + 150} ${cy} A150 150 0 0 0 ${r2(cx + 150 * Math.cos(-0.7))} ${r2(cy + 150 * Math.sin(-0.7))} Z`} fill="url(#bay-radar-sweep)" />
        <line x1={cx} y1={cy} x2={cx + 150} y2={cy} stroke="currentColor" strokeWidth="2" />
      </g>
      {blips.map(([dx, dy, i]) => (
        <circle key={i} cx={cx + dx} cy={cy + dy} r="4" fill={i % 3 === 1 ? "var(--color-signal2)" : "currentColor"} className="bay-o-node" style={{ "--i": i * 2 } as React.CSSProperties} />
      ))}
    </svg>
  );
}

function Stands() {
  return (
    <svg viewBox="0 0 560 340">
      <line x1="40" y1="290" x2="540" y2="290" {...STROKE} strokeOpacity="0.5" strokeWidth="1.5" />
      {Array.from({ length: 8 }, (_, i) => {
        const x = 70 + i * 58;
        return (
          <g key={i}>
            <rect x={x} y="70" width="34" height="220" {...STROKE} strokeOpacity="0.14" />
            <rect className="bay-o-eq" x={x + 4} y="74" width="26" height="212" fill="currentColor" fillOpacity={i === 7 ? 0.75 : 0.35} style={{ "--i": i } as React.CSSProperties} />
            <text x={x + 17} y="310" textAnchor="middle" fill="currentColor" fillOpacity="0.5" fontSize="10" fontFamily="var(--font-mono)">0{i + 1}</text>
          </g>
        );
      })}
      <line x1="40" y1="216" x2="540" y2="216" stroke="var(--color-signal2)" strokeOpacity="0.6" strokeDasharray="6 6" />
    </svg>
  );
}

function Stamp() {
  const cx = 290, cy = 170;
  return (
    <svg viewBox="0 0 560 340">
      <defs>
        <path id="bay-stamp-ring" d={`M${cx - 118} ${cy} a118 118 0 1 1 236 0 a118 118 0 1 1 -236 0`} />
      </defs>
      <g className="bay-o-spin bay-o-spin-slow" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r="140" {...STROKE} strokeOpacity="0.6" strokeWidth="2" />
        <text fill="currentColor" fillOpacity="0.7" fontSize="15" fontFamily="var(--font-mono)" letterSpacing="5">
          <textPath href="#bay-stamp-ring">HOMOLOGATED · NEAR TESTNET · NEP-171 · RULES ARE CODE · </textPath>
        </text>
        <circle cx={cx} cy={cy} r="100" {...STROKE} strokeOpacity="0.4" />
      </g>
      <path className="bay-o-draw" pathLength={1} d={`M${cx - 40} ${cy + 2} L${cx - 10} ${cy + 32} L${cx + 46} ${cy - 30}`} {...STROKE} strokeWidth="6" strokeLinecap="square" />
    </svg>
  );
}

const TRACES = ["M0 80 H160 L210 130 H280", "M0 250 H120 L170 200 H280", "M560 60 H420 L370 110 H300", "M560 280 H440 L390 230 H300", "M280 330 V250"];

function Wiring() {
  return (
    <svg viewBox="0 0 560 340">
      {TRACES.map((d) => <path key={d} d={d} {...STROKE} strokeOpacity="0.25" strokeWidth="1.5" />)}
      {TRACES.map((d, i) => <path key={`p${d}`} d={d} {...STROKE} strokeWidth="2" className="bay-o-pulse" style={{ animationDelay: `${i * 0.5}s` }} />)}
      <rect x="244" y="140" width="72" height="62" {...STROKE} strokeWidth="2.5" />
      <path d="M258 140 V118 a22 22 0 0 1 44 0 V140" {...STROKE} strokeWidth="2.5" className="bay-o-shackle" />
      <circle cx="280" cy="168" r="6" fill="currentColor" />
      <line x1="280" y1="172" x2="280" y2="186" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

/** the escrow vault door — a bolted ring, a spoked handle turning slowly, the dial counting */
function Vault() {
  const cx = 290, cy = 170;
  const at = (deg: number, r: number) => [+(cx + r * Math.sin((deg * Math.PI) / 180)).toFixed(2), +(cy - r * Math.cos((deg * Math.PI) / 180)).toFixed(2)] as const;
  return (
    <svg viewBox="0 0 560 340">
      <circle cx={cx} cy={cy} r="150" {...STROKE} strokeOpacity="0.5" strokeWidth="2" />
      <circle cx={cx} cy={cy} r="128" {...STROKE} strokeOpacity="0.25" strokeDasharray="3 7" />
      {Array.from({ length: 12 }, (_, i) => {
        const [x, y] = at(i * 30 + 15, 139);
        return <circle key={i} cx={x} cy={y} r="4" fill="currentColor" fillOpacity="0.55" />;
      })}
      <g className="bay-o-spin bay-o-spin-slow" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        {Array.from({ length: 60 }, (_, i) => {
          const [x1, y1] = at(i * 6, i % 5 ? 112 : 104), [x2, y2] = at(i * 6, 118);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeOpacity={i % 5 ? 0.3 : 0.75} strokeWidth={i % 5 ? 1 : 2} />;
        })}
      </g>
      <g className="bay-o-spin bay-o-spin-rev" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        {[0, 120, 240].map((d) => {
          const [x, y] = at(d, 88);
          return (
            <g key={d}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
              <circle cx={x} cy={y} r="9" {...STROKE} strokeWidth="3" />
            </g>
          );
        })}
      </g>
      <circle cx={cx} cy={cy} r="26" fill="var(--color-pitch)" stroke="currentColor" strokeWidth="3" />
      <circle cx={cx} cy={cy} r="8" fill="var(--color-chartreuse)" />
    </svg>
  );
}

/** the pit — a hex bolt with a wrench turning round it, a socket rail and a live line to the engine */
function Pit() {
  const cx = 300, cy = 160;
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 * Math.PI) / 180;
    return `${(cx + 30 * Math.cos(a)).toFixed(2)},${(cy + 30 * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 560 340">
      <circle cx={cx} cy={cy} r="118" {...STROKE} strokeOpacity="0.25" strokeDasharray="2 6" />
      <circle cx={cx} cy={cy} r="64" {...STROKE} strokeOpacity="0.35" />
      <g className="bay-o-spin bay-o-spin-rev" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <path d={`M${cx + 44} ${cy - 16} L${cx + 190} ${cy - 10} a10 10 0 0 1 0 20 L${cx + 44} ${cy + 16}`} {...STROKE} strokeWidth="2.5" />
        <circle cx={cx} cy={cy} r="44" {...STROKE} strokeWidth="3" />
      </g>
      <polygon points={hex} {...STROKE} strokeWidth="3" />
      <circle cx={cx} cy={cy} r="10" fill="var(--color-chartreuse)" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={60 + i * 34} cy={300} r={8 + i * 1.6} {...STROKE} strokeOpacity="0.5" strokeWidth="1.5" className="bay-o-node" style={{ ["--i" as string]: i }} />
      ))}
      <path d={`M0 300 H40 M${cx} ${cy + 44} V300 H560`} {...STROKE} strokeOpacity="0.2" />
      <path d={`M${cx} ${cy + 44} V300 H560`} {...STROKE} strokeWidth="2" className="bay-o-pulse" />
    </svg>
  );
}

/** your floor, not yet connected — a garage shutter rolling up and down over an empty lane */
function Shutter() {
  const x = 130, w = 320, top = 40, h = 230;
  return (
    <svg viewBox="0 0 560 340">
      <path d={`M${x - 14} ${top + h} V${top - 6} H${x + w + 14} V${top + h}`} {...STROKE} strokeWidth="3" strokeOpacity="0.7" />
      <line x1="0" y1={top + h} x2="560" y2={top + h} {...STROKE} strokeOpacity="0.35" />
      {/* the empty lane receding into the bay */}
      <path d={`M${x + 60} ${top + h} L${x + 130} ${top + 70} M${x + w - 60} ${top + h} L${x + w - 130} ${top + 70}`} {...STROKE} strokeOpacity="0.3" />
      <line x1={x + w / 2} y1={top + h} x2={x + w / 2} y2={top + 70} {...STROKE} className="bay-o-dash" strokeOpacity="0.45" strokeWidth="2" />
      <g className="bay-o-shutter">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={x} y1={top + 4 + i * 11} x2={x + w} y2={top + 4 + i * 11} stroke="currentColor" strokeOpacity={0.55 - i * 0.03} strokeWidth="5" />
        ))}
        <rect x={x + w / 2 - 22} y={top + 128} width="44" height="7" fill="var(--color-chartreuse)" />
      </g>
    </svg>
  );
}

const MAP: Record<OrnamentKind, () => React.ReactElement> = { edge: Gauge, grid: Lanes, tuning: Scope, crew: Constellation, ledger: Chain, dyno: Dyno, proof: Seal, radar: Radar, bays: Stands, license: Stamp, register: Wiring, vault: Vault, pit: Pit, shutter: Shutter };

export default function Ornament({ kind }: { kind: OrnamentKind }) {
  const C = MAP[kind];
  return (
    <div aria-hidden className="bay-orn">
      <C />
    </div>
  );
}
