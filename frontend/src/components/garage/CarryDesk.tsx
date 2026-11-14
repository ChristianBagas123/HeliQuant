"use client";

/**
 * CarryDesk — the delta-neutral funding-carry monitor. Non-directional (long spot + short perp,
 * market-neutral, predicts nothing; it would earn the funding the perp pays).
 *
 * Honest by construction: the rates are read live from real Bitget funding via /carry. The desk says
 * HARVEST only when carry is rich (> risk-free) AND the asset is crash-robust in the stress-test table
 * (firm/carry_signal.py) — otherwise WAIT. Carry is a yield monitor, not a validated edge in the registry.
 *
 * Motion: each live read is a dial whose needle swings to the live rate, with a HARVEST/WAIT lamp.
 */

import { useEffect, useState } from "react";

import { fetchCarry, type CarryRead, type CarryStatus } from "@/lib/campaign";
import LiveBadge from "@/components/garage/LiveBadge";
import { Note, SectionHead, Stat, StatStrip } from "@/components/garage/bay/parts";

const POLL_MS = 30000;

// "updated HH:MM UTC" from the feed's own asof; honest fallbacks when the feed is missing/dead
function asofLabel(asof: string | null | undefined): string {
  if (asof === undefined) return "live";
  if (asof === null) return "feed: never / stale";
  const d = new Date(asof);
  if (Number.isNaN(d.getTime())) return "feed: stale";
  return `updated ${d.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" }).slice(0, 5)} UTC`;
}
const RISK_FREE = 5.0; // ~stablecoin yield benchmark — carry must clear this to be worth the legs

// Perp symbols the desk reads live (Bitget funding via /carry).
const ASSETS = ["HYPE", "SUI", "BTC", "ETH"];

export default function CarryDesk() {
  const [c, setC] = useState<CarryStatus | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);
  const [lastGood, setLastGood] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const r = await fetchCarry();
      if (!alive) return;
      setReached(Boolean(r));
      if (r) {
        setC(r);
        setLastGood(new Date());
      }
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const live = c?.carry ?? {};
  const liveFor = (a: string) => live[`${a}USDT`] ?? null;
  const harvestable = c?.best_harvestable ?? "";
  const waiting = !c || harvestable.startsWith("none");

  return (
    <div className="space-y-16">
      {/* proof-of-life */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">delta-neutral funding-carry desk</p>
        <LiveBadge at={lastGood} />
      </div>

      {/* headline strip */}
      <div className="space-y-6">
        <StatStrip>
          <Stat i={0} k="strategy" v="delta-neutral" count={false} tone="good" size="md" sub="long spot · short perp · predicts nothing" />
          <Stat i={1} k="assets read" v={`${ASSETS.length}`} count={false} size="md" sub="live Bitget funding" />
          <Stat i={2} k="risk-free bar" v={`${RISK_FREE.toFixed(1)}%`} size="md" sub="carry must clear this" />
          <div data-fx="rise" data-tone={waiting ? "bad" : "good"} className="bay-stat px-5 py-4" style={{ "--i": 3 } as React.CSSProperties}>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">harvestable now</p>
            <p className={`bay-stat-v mt-1 flex items-center gap-3 font-display text-2xl font-extrabold leading-none sm:text-3xl ${waiting ? "text-signal2" : "text-chartreuse"}`}>
              <span className="bay-lamp" data-on={c ? (waiting ? "wait" : "go") : undefined} />
              {!c ? "—" : waiting ? "none — wait" : "live"}
            </p>
            <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-bone/40">{waiting ? "nothing rich + crash-robust → wait" : "carry clears the bar"}</p>
          </div>
        </StatStrip>

        <Note>
          the directional desks ask &quot;which way?&quot;. This desk asks where the firm could earn yield
          <span className="text-bone"> without predicting</span>: the funding a perp pays, held market-neutral. It is a
          monitor, not a validated edge — it says <span className="text-chartreuse">harvest</span> only when carry is rich
          and the asset is crash-robust, otherwise it waits.
        </Note>
      </div>

      {/* live carry now */}
      <section>
        <SectionHead
          n="01"
          title="Live carry — right now"
          sub={`read from real Bitget funding · ${reached === false ? "desk unreachable, retrying" : asofLabel(c?.asof)}`}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {ASSETS.map((a, i) => (
            <Dial key={a} asset={a} read={liveFor(a)} i={i} />
          ))}
        </div>
        <Note tone="warn" className="mt-5">
          {harvestable === ""
            ? "waiting for the first live funding read."
            : harvestable.startsWith("none")
              ? "right now: no asset is both above risk-free and crash-robust, so the firm waits."
              : harvestable}
        </Note>
      </section>

    </div>
  );
}

/* ── a live carry dial: −2 … +10 %/yr, risk-free tick at 5, needle swings to the live rate ── */
const DMIN = -2, DMAX = 10;
const dfrac = (x: number) => Math.max(0, Math.min(1, (x - DMIN) / (DMAX - DMIN)));
function onArc(f: number, r: number) {
  const a = Math.PI * (1 - f);
  return [+(60 + r * Math.cos(a)).toFixed(2), +(62 - r * Math.sin(a)).toFixed(2)] as const; // rounded: server/client trig can differ in the last digit
}

function Dial({ asset, read, i }: { asset: string; read: CarryRead | null; i: number }) {
  const rate = read?.carry_ann_pct ?? null;
  const harvest = (read?.verdict ?? "").toUpperCase().startsWith("HARVEST");
  const f = rate == null ? null : dfrac(rate);
  const f0 = dfrac(0);
  const start = f == null ? 0 : +(Math.min(f, f0) * 100).toFixed(2);
  const len = f == null ? 0 : +(Math.abs(f - f0) * 100).toFixed(2);
  const color = rate == null ? "#8b8b80" : harvest ? "var(--color-chartreuse)" : rate < 0 ? "var(--color-signal2)" : "#cfccc2";
  const [rx1, ry1] = onArc(dfrac(RISK_FREE), 40), [rx2, ry2] = onArc(dfrac(RISK_FREE), 56);
  const ticks = Array.from({ length: 13 }, (_, k) => k / 12);

  return (
    <div data-fx="rise" data-tilt className="fl-card fl-tilt flex items-center gap-5 border-2 border-bone/15 bg-carbon px-5 py-5" style={{ "--i": i } as React.CSSProperties}>
      <svg viewBox="0 0 120 72" className="h-24 w-36 shrink-0 overflow-visible" aria-hidden>
        <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="rgba(242,239,230,0.12)" strokeWidth="7" />
        {f != null && (
          <path className="bay-arc" d="M12 62 A48 48 0 0 1 108 62" pathLength={100} fill="none" stroke={color} strokeWidth="7" strokeDasharray={`${len} 100`} strokeDashoffset={-start} style={{ filter: harvest ? "drop-shadow(0 0 4px rgba(201,242,75,0.8))" : undefined }} />
        )}
        {ticks.map((t) => {
          const [a1, b1] = onArc(t, 42), [a2, b2] = onArc(t, 46);
          return <line key={t} x1={a1} y1={b1} x2={a2} y2={b2} stroke="rgba(242,239,230,0.3)" strokeWidth="1" />;
        })}
        <line x1={rx1} y1={ry1} x2={rx2} y2={ry2} stroke="#f7f5ee" strokeWidth="2" style={{ filter: "drop-shadow(0 0 2px #fff)" }} />
        <g className="bay-needle" style={{ "--deg": `${f == null ? -90 : -90 + f * 180}deg` } as React.CSSProperties}>
          <line x1="60" y1="62" x2="60" y2="22" stroke={color} strokeWidth="2" />
        </g>
        <circle cx="60" cy="62" r="4.5" fill="var(--color-pitch)" stroke={color} strokeWidth="1.5" />
        <text x="12" y="72" fill="#8b8b80" fontSize="6" fontFamily="var(--font-mono)">{DMIN}%</text>
        <text x="108" y="72" fill="#8b8b80" fontSize="6" fontFamily="var(--font-mono)" textAnchor="end">+{DMAX}%</text>
      </svg>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-xl font-extrabold uppercase text-bone">{asset}USDT</span>
          <span className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: rate == null ? "#8b8b80" : harvest ? "var(--color-chartreuse)" : "var(--color-signal2)" }}>
            <span className="bay-lamp" data-on={rate == null ? undefined : harvest ? "go" : "wait"} />
            {rate == null ? "no read" : harvest ? "harvest" : "wait"}
          </span>
        </div>
        <p className="mt-1 font-display text-4xl font-extrabold leading-none" style={{ color }}>
          {rate == null ? "—" : `${rate >= 0 ? "+" : ""}${rate}%`}
          <span className="ml-1.5 font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-steel">/yr</span>
        </p>
        <p className={`mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] ${harvest ? "text-chartreuse" : "text-bone/50"}`}>{read?.verdict ?? "no live read"}</p>
      </div>
    </div>
  );
}
