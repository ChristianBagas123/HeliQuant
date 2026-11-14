"use client";

/**
 * DynoSheet — THE DYNO. A dynamometer measures an engine's REAL output under load; you can't market
 * your way past the curve. So we put the firm's trade ledger on the dyno: quantstats-grade metrics
 * (Sharpe / Sortino / max-drawdown / profit-factor) computed from REAL resolved trades, plus the
 * compounded equity "power band". Honest by construction — annualized figures stay BLANK until the
 * sample is meaningful (≥30d & ≥30 trades), because extrapolating a 3-day window to a CAGR is a lie.
 * The directional floor has no validated edge, so the curve reads ~breakeven/loss; we show it anyway.
 * Reads /performance (live, 20s poll).
 *
 * Motion: the power band draws itself as it scrolls in, the deepest drawdown is shaded from its peak to
 * its trough, and a crosshair reads any trade's compounded equity under the cursor (or finger).
 */

import { useEffect, useId, useRef, useState } from "react";

import { fetchPerformance, type PerfStats } from "@/lib/campaign";
import { Note, SectionHead, Stat, StatStrip } from "@/components/garage/bay/parts";

const POLL_MS = 20000;
const H = 260, PX = 14, PY = 18;

/** the deepest peak→trough fall in the equity curve */
function deepestDrawdown(eq: number[]) {
  let peakI = 0, best = { from: 0, to: 0, dd: 0 };
  for (let i = 1; i < eq.length; i++) {
    if (eq[i] > eq[peakI]) peakI = i;
    const dd = (eq[peakI] - eq[i]) / eq[peakI];
    if (dd > best.dd) best = { from: peakI, to: i, dd };
  }
  return best;
}

function PowerCurve({ eq }: { eq: number[] }) {
  const gid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!eq || eq.length < 2) return <p className="py-10 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-steel">needs two closed trades to draw a curve</p>;
  const min = Math.min(...eq, 1), max = Math.max(...eq, 1);
  const range = max - min || 1;
  const x = (i: number) => PX + (i / (eq.length - 1)) * (W - 2 * PX);
  const y = (v: number) => PY + (1 - (v - min) / range) * (H - 2 * PY);
  const path = eq.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = eq[eq.length - 1];
  const up = last >= 1;
  const stroke = up ? "#c9f24b" : "#ff5a1f";
  const area = `${path} L${x(eq.length - 1).toFixed(1)} ${H - PY} L${x(0).toFixed(1)} ${H - PY} Z`;
  const base = y(1);
  const dd = deepestDrawdown(eq);

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const f = (clientX - r.left - PX) / (r.width - 2 * PX);
    setHover(Math.max(0, Math.min(eq.length - 1, Math.round(f * (eq.length - 1)))));
  };
  const hv = hover == null ? null : eq[hover];
  const flip = hover != null && x(hover) > W * 0.7;

  return (
    <div
      ref={box}
      className="relative touch-pan-y select-none"
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block" role="img" aria-label={`Compounded equity over ${eq.length} trades, ending at ${last.toFixed(4)}`}>
        <defs>
          <linearGradient id={`${gid}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <pattern id={`${gid}h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#ff5a1f" strokeOpacity="0.35" strokeWidth="2" />
          </pattern>
        </defs>
        {/* grid */}
        {Array.from({ length: 5 }, (_, k) => {
          const yy = PY + (k / 4) * (H - 2 * PY);
          return <line key={k} x1={PX} y1={yy} x2={W - PX} y2={yy} stroke="#fff" strokeOpacity="0.05" />;
        })}
        {/* deepest drawdown, peak → trough */}
        {dd.dd > 0 && (
          <rect className="bay-area" x={x(dd.from)} y={PY} width={Math.max(2, x(dd.to) - x(dd.from))} height={H - 2 * PY} fill={`url(#${gid}h)`} />
        )}
        <line x1={PX} y1={base} x2={W - PX} y2={base} stroke="#fff" strokeOpacity="0.22" strokeDasharray="5 5" />
        <path className="bay-area" d={area} fill={`url(#${gid}a)`} />
        <path className="bay-curve" pathLength={1} d={path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${stroke}88)` }} />
        <circle cx={x(eq.length - 1)} cy={y(last)} r="4" fill={stroke} className="bay-area" />
        {hover != null && hv != null && (
          <g className="bay-cross">
            <line x1={x(hover)} y1={PY} x2={x(hover)} y2={H - PY} stroke="#f2efe6" strokeOpacity="0.4" />
            <line x1={PX} y1={y(hv)} x2={W - PX} y2={y(hv)} stroke="#f2efe6" strokeOpacity="0.12" />
            <circle cx={x(hover)} cy={y(hv)} r="5.5" fill="var(--color-pitch)" stroke={hv >= 1 ? "#c9f24b" : "#ff5a1f"} strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* axis notes */}
      <span className="pointer-events-none absolute left-3 top-1 font-mono text-[9px] text-steel">{max.toFixed(4)}</span>
      <span className="pointer-events-none absolute bottom-1 left-3 font-mono text-[9px] text-steel">{min.toFixed(4)}</span>
      <span className="pointer-events-none absolute right-3 font-mono text-[9px] uppercase tracking-[0.14em] text-bone/45" style={{ top: base - 16 }}>breakeven 1.0</span>
      {dd.dd > 0 && (
        <span className="pointer-events-none absolute bottom-1 -translate-x-full whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-signal2/80" style={{ left: Math.max(x(dd.to) - 4, 150) }}>
          deepest dd −{(dd.dd * 100).toFixed(2)}%
        </span>
      )}

      {/* crosshair readout */}
      {hover != null && hv != null && (
        <div
          className="pointer-events-none absolute z-10 border-l-2 bg-pitch/90 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] backdrop-blur"
          style={{ left: flip ? undefined : x(hover) + 12, right: flip ? W - x(hover) + 12 : undefined, top: Math.max(4, Math.min(H - 64, y(hv) - 30)), borderColor: hv >= 1 ? "#c9f24b" : "#ff5a1f" }}
        >
          <p className="text-steel">trade {hover + 1} / {eq.length}</p>
          <p className="mt-0.5 text-bone">equity {hv.toFixed(4)}</p>
          <p style={{ color: hv >= 1 ? "#c9f24b" : "#ff5a1f" }}>
            {hv >= 1 ? "+" : ""}{((hv - 1) * 100).toFixed(2)}% from $1
          </p>
        </div>
      )}
    </div>
  );
}

const sign = (n?: number | null, d = 2, suf = "") => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}${suf}`);
const tone = (n?: number | null, flip = false): "good" | "bad" | "muted" => (n == null ? "muted" : (flip ? n < 0 : n > 0) ? "good" : "bad");

export default function DynoSheet() {
  const [p, setP] = useState<PerfStats | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const r = await fetchPerformance();
      if (!alive) return;
      setReached(Boolean(r));
      if (r) setP(r);
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (reached === false && !p) {
    return <div className="border-2 border-bone/20 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">dyno unreachable — the firm runs on Railway; retrying every 20s</div>;
  }
  if (!p) {
    return <div className="border-2 border-bone/15 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">spinning up the dyno…</div>;
  }
  if (!p.n) {
    return <div className="border-2 border-bone/15 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">no resolved trades yet — the dyno needs a closed run to measure</div>;
  }

  return (
    <div className="space-y-16">
      {/* headline strip */}
      <StatStrip>
        <Stat i={0} k="resolved trades" v={`${p.n}`} sub={p.span_days != null ? `over ${p.span_days}d` : undefined} />
        <Stat i={1} k="win rate" v={p.win_rate != null ? `${p.win_rate}%` : "—"} tone={(p.win_rate ?? 0) >= 50 ? "good" : "bad"} />
        <Stat i={2} k="total return" v={sign(p.total_return_pct, 2, "%")} tone={tone(p.total_return_pct)} sub="$1/trade compounded" />
        <Stat i={3} k="profit factor" v={p.profit_factor != null ? p.profit_factor.toFixed(2) : "—"} tone={(p.profit_factor ?? 0) >= 1 ? "good" : "bad"} sub="gross win ÷ gross loss" />
      </StatStrip>

      {/* the power band */}
      <section>
        <SectionHead n="01" title="The power band" sub="compounded equity from $1, per trade · dashed = breakeven 1.0 · hatched = deepest drawdown · hover to read any trade" />
        <div data-fx="rise" className="fl-card border-2 border-bone/20 bg-pitch p-3 sm:p-4" style={{ backgroundImage: "radial-gradient(rgba(242,239,230,0.05) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
          <PowerCurve eq={p.equity_curve ?? []} />
        </div>
      </section>

      {/* per-trade truth — no extrapolation */}
      <section>
        <SectionHead n="02" title="Per-trade truth" sub="measured, not extrapolated · return = pnl ÷ size" />
        <StatStrip>
          <Stat i={0} size="md" k="sharpe / trade" v={sign(p.sharpe_per_trade, 3)} tone={tone(p.sharpe_per_trade)} />
          <Stat i={1} size="md" k="sortino / trade" v={sign(p.sortino_per_trade, 3)} tone={tone(p.sortino_per_trade)} />
          <Stat i={2} size="md" k="max drawdown" v={sign(p.max_drawdown_pct, 2, "%")} tone="bad" />
          <Stat i={3} size="md" k="expectancy / trade" v={sign(p.mean_trade_pct, 3, "%")} tone={tone(p.mean_trade_pct)} />
          <Stat i={4} size="md" k="avg win" v={sign(p.avg_win_pct, 3, "%")} tone="good" />
          <Stat i={5} size="md" k="avg loss" v={sign(p.avg_loss_pct, 3, "%")} tone="bad" />
          <Stat i={6} size="md" k="best trade" v={sign(p.best_pct, 2, "%")} tone="good" />
          <Stat i={7} size="md" k="worst trade" v={sign(p.worst_pct, 2, "%")} tone="bad" />
        </StatStrip>
      </section>

      {/* annualized — honest gate */}
      <section>
        <SectionHead n="03" title="Annualized" sub="only when the sample earns it" />
        {p.annualized ? (
          <StatStrip>
            <Stat i={0} size="md" k="sharpe (ann.)" v={sign(p.sharpe_annualized, 2)} tone={tone(p.sharpe_annualized)} />
            <Stat i={1} size="md" k="sortino (ann.)" v={sign(p.sortino_annualized, 2)} tone={tone(p.sortino_annualized)} />
            <Stat i={2} size="md" k="calmar" v={sign(p.calmar, 2)} tone={tone(p.calmar)} />
            <Stat i={3} size="md" k="cagr" v={sign(p.cagr_pct, 1, "%")} tone={tone(p.cagr_pct)} sub={p.trades_per_year ? `${p.trades_per_year} trades/yr` : undefined} />
          </StatStrip>
        ) : (
          <div data-fx="rise" className="fl-card relative overflow-hidden border-2 border-signal2/50 bg-carbon px-6 py-8">
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "repeating-linear-gradient(-45deg, #ff5a1f 0 12px, transparent 12px 24px)" }} />
            <div className="relative flex flex-wrap items-start gap-x-10 gap-y-5">
              <p className="bay-stamp font-display text-3xl font-extrabold uppercase tracking-wide">Withheld</p>
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl font-extrabold uppercase text-signal2">On purpose</p>
                <p className="mt-2 max-w-2xl font-mono text-[11px] uppercase leading-relaxed tracking-[0.14em] text-bone/70">
                  {p.sample_warning ?? "sample too small to annualize honestly"}. A 3-day window of fast trades extrapolates to a
                  fantasy CAGR and a double-digit Sharpe — so we refuse to print it. The per-trade numbers above
                  are the real ones. <span className="text-chartreuse">Most projects show the fantasy. We don&apos;t.</span>
                </p>
              </div>
            </div>
            <div className="relative mt-6 grid grid-cols-2 gap-px bg-bone/10 lg:grid-cols-4">
              {["sharpe (ann.)", "sortino (ann.)", "calmar", "cagr"].map((k) => (
                <div key={k} className="bg-carbon/90 px-4 py-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">{k}</p>
                  <p className="mt-1 font-display text-2xl font-extrabold leading-none text-bone/20">— — —</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <Note>
        the dyno doesn&apos;t lie. the directional floor has <span className="text-bone">no validated edge</span>, so this
        curve reads ~breakeven/loss — and we show it anyway. <span className="text-chartreuse">delta-neutral funding-carry</span>{" "}
        is tracked on its own bench as a market-neutral yield monitor, not a validated edge.{" "}
        <span className="text-signal2">honesty is the product.</span>
      </Note>
    </div>
  );
}
