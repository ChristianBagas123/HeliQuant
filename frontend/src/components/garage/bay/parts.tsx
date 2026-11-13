/**
 * Shared bay pieces: a section head (outline number fills, a rule draws), stat tiles whose figures
 * roll up, and honesty plates with a light travelling down their rail.
 */

import { CountUp } from "@/components/garage/FloorMotion";

type Tone = "good" | "bad" | "muted" | "bitget";

const TONE: Record<Tone, string> = { good: "text-chartreuse", bad: "text-signal2", muted: "text-bone", bitget: "text-bitget" };

export function SectionHead({ n, title, sub, right }: { n: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div data-fx="head" className="bay-head mb-6 flex flex-wrap items-end gap-x-5 gap-y-2 pb-3">
      <span aria-hidden className="bay-num font-display text-5xl font-extrabold leading-[0.85] sm:text-6xl">
        {n}
      </span>
      <div className="bay-head-t min-w-0 flex-1">
        <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-bone sm:text-2xl">{title}</h2>
        {sub && <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-steel">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function StatStrip({ cols = 4, className = "", children }: { cols?: 2 | 3 | 4; className?: string; children: React.ReactNode }) {
  const c = cols === 4 ? "grid-cols-2 lg:grid-cols-4" : cols === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2";
  return <div className={`bay-strip ${c} ${className}`}>{children}</div>;
}

/** a stat tile — numeric values roll up when they change; set `count={false}` for words */
export function Stat({ k, v, sub, tone = "muted", i = 0, size = "lg", count = true }: { k: string; v: string; sub?: React.ReactNode; tone?: Tone; i?: number; size?: "md" | "lg"; count?: boolean }) {
  return (
    <div data-fx="rise" data-tone={tone} className="bay-stat px-5 py-4" style={{ "--i": i } as React.CSSProperties}>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">{k}</p>
      <p className={`bay-stat-v mt-1 font-display font-extrabold leading-none ${size === "lg" ? "text-4xl" : "text-2xl sm:text-3xl"} ${TONE[tone]}`}>
        {count && /\d/.test(v) ? <CountUp value={v} /> : v}
      </p>
      {sub && <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-bone/40">{sub}</p>}
    </div>
  );
}

export function Note({ tone, className = "", children }: { tone?: "warn"; className?: string; children: React.ReactNode }) {
  return (
    <p data-fx="rise" data-tone={tone} className={`bay-note bg-carbon px-5 py-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-bone/80 ${className}`}>
      {children}
    </p>
  );
}
