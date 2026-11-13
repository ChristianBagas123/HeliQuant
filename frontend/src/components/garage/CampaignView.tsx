"use client";

/**
 * CampaignView — "THE GRID" (Night Garage · live-trading floor), parameterized by engine.
 *
 * Each open position is a race lane from its STOP (left) to its TARGET (right); the car = the live
 * price, trailing light from its entry. Used twice: /campaign (mode="owner" → pinned to the Owner
 * showcase engine, public) and /trade (mode="user" → reads YOUR connected local engine).
 *
 * Motion: lane markings roll, the car glides on a spring with a ping; hovering (or focusing) a lane
 * reads out how far price sits from its stop and target; recent closes run as a ticker that pauses
 * under the cursor; money figures roll up.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchCampaign, laneFrac, pairLabel, venueBadge, venueLabel, type CampaignStatus, type ClosedPosition, type OpenPosition } from "@/lib/campaign";
import BitgetConsole from "@/components/garage/BitgetConsole";
import { CountUp } from "@/components/garage/FloorMotion";
import BayShell from "@/components/garage/bay/BayShell";
import { SectionHead } from "@/components/garage/bay/parts";

const POLL_MS = 20000;

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

function mmss(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.max(0, Math.round(s - m * 60));
  return m + ":" + (sec < 10 ? "0" + sec : "" + sec);
}

/** where a price sits on the SL→TP lane (0 = stop, 1 = target) */
function onLane(p: OpenPosition, price: number | null | undefined): number | null {
  if (price == null || p.sl == null || p.tp == null || p.tp === p.sl) return null;
  return Math.max(0, Math.min(1, (price - p.sl) / (p.tp - p.sl)));
}
const away = (from: number | null | undefined, to: number | null | undefined) =>
  from == null || to == null || !from ? null : Math.abs(((to - from) / from) * 100);

const usd0 = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pnl2 = (n: number) => (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Lane({ p, i }: { p: OpenPosition; i: number }) {
  const frac = laneFrac(p);
  const entryF = onLane(p, p.entry) ?? 0.5;
  const up = (p.upnl_pct ?? 0) >= 0;
  const carColor = up ? "var(--color-chartreuse)" : "var(--color-signal2)";
  const toSl = away(p.now, p.sl);
  const toTp = away(p.now, p.tp);
  const v = venueBadge(p.venue);
  return (
    <div tabIndex={0} data-fx="rise" data-tone={up ? undefined : "bad"} className="bay-row border-b border-bone/10 px-4 py-4 sm:px-6" style={{ "--i": i } as React.CSSProperties}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="font-display text-lg font-extrabold uppercase tracking-wide text-bone">{venueLabel(p.asset, p.venue)}</span>
          <span className={`border px-1.5 py-px font-mono text-[9px] font-bold tracking-[0.14em] ${p.dir === "LONG" ? "border-chartreuse text-chartreuse" : "border-bone/45 text-bone/70"}`}>{p.dir}</span>
          <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${v.cls}`}>{v.label}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-steel">
            {p.tier} · net {p.votes > 0 ? "+" : ""}{p.votes}
          </span>
          {p.horizon_h != null && (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone/45">· ⏱ {(p.held_h ?? 0).toFixed(1)}/{p.horizon_h}h</span>
          )}
        </span>
        <span className="font-display text-2xl font-extrabold leading-none" style={{ color: carColor, textShadow: `0 0 18px ${up ? "rgba(201,242,75,0.35)" : "rgba(255,90,31,0.35)"}` }}>
          {up ? "+" : ""}{(p.upnl_pct ?? 0).toFixed(2)}%
        </span>
      </div>

      <div className="bay-lane">
        <span aria-hidden className="absolute inset-y-0 left-0 z-[1] w-[3px] bg-signal2" style={{ boxShadow: "0 0 10px rgba(255,90,31,0.7)" }} />
        <span aria-hidden className="gr-hazard gr-hazard-live absolute inset-y-0 right-0 z-[1] w-[10px]" />
        <span aria-hidden className="absolute inset-y-0 z-[1] w-px bg-bone/45" style={{ left: `${entryF * 100}%` }} title="entry" />
        {frac != null ? (
          <>
            <span
              aria-hidden
              className="bay-lane-trail"
              style={{
                left: `${Math.min(frac, entryF) * 100}%`,
                width: `${Math.abs(frac - entryF) * 100}%`,
                background: up
                  ? `linear-gradient(${frac >= entryF ? 90 : 270}deg, rgba(201,242,75,0.04), rgba(201,242,75,0.32))`
                  : `linear-gradient(${frac >= entryF ? 90 : 270}deg, rgba(255,90,31,0.04), rgba(255,90,31,0.32))`,
              }}
            />
            <span aria-hidden className="bay-car z-[2]" style={{ left: `${frac * 100}%`, color: carColor }} />
          </>
        ) : (
          <span className="absolute inset-0 z-[2] grid place-items-center font-mono text-[9px] uppercase tracking-widest text-steel">awaiting mark</span>
        )}
      </div>
      <div className="relative mt-1.5 h-3 font-mono text-[8px] uppercase tracking-[0.12em]">
        <span className="absolute left-0 text-signal2/80">SL {fmtPrice(p.sl)}</span>
        <span className="absolute -translate-x-1/2 text-steel" style={{ left: `${Math.min(88, Math.max(12, entryF * 100))}%` }}>@ {fmtPrice(p.entry)}</span>
        <span className="absolute right-0 text-chartreuse/80">TP {fmtPrice(p.tp)}</span>
      </div>

      {/* hover / focus readout */}
      <p className="bay-readout mt-2.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/70">
        <span>mark <span className="text-bone">{fmtPrice(p.now)}</span></span>
        <span>stop <span className="text-signal2">{toSl == null ? "—" : `${toSl.toFixed(2)}% away`}</span></span>
        <span>target <span className="text-chartreuse">{toTp == null ? "—" : `${toTp.toFixed(2)}% away`}</span></span>
        {p.tp_progress_pct != null && <span>travelled <span className="text-bone">{p.tp_progress_pct.toFixed(0)}% to TP</span></span>}
      </p>

      {p.near_tp && (
        <p className="mt-2.5 inline-block border border-chartreuse/50 bg-chartreuse/5 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-chartreuse">
          🏁 {(p.tp_progress_pct ?? 0) >= 100 ? "at TP" : "near TP " + (p.tp_progress_pct ?? 0).toFixed(0) + "%"} ·{" "}
          {p.near_tp_lock_in_s != null ? "banking in " + mmss(p.near_tp_lock_in_s) : "banking near-win"}
        </p>
      )}
      {p.reasons && p.reasons.length > 0 && (
        <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-steel">▸ {p.reasons.slice(0, 3).join(" · ")}</p>
      )}
    </div>
  );
}

function ClosePill({ c }: { c: ClosedPosition }) {
  const win = (c.pnl_usd ?? 0) > 0;
  const icon = c.exit_reason === "TP" ? "🎯" : c.exit_reason === "SL" ? "🛑" : c.exit_reason === "TRAIL" ? "🪤" : c.exit_reason === "NEARTP" ? "🏁" : c.exit_reason === "STALL" ? "✂" : "⏱";
  return (
    <span
      className="bay-pill flex shrink-0 items-center gap-1.5 border-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em]"
      style={{ borderColor: win ? "rgba(201,242,75,0.5)" : "rgba(255,90,31,0.5)", color: win ? "var(--color-chartreuse)" : "var(--color-signal2)" }}
    >
      {icon} {pairLabel(c.asset)} {c.dir} {(c.net_pct ?? 0) >= 0 ? "+" : ""}{(c.net_pct ?? 0).toFixed(2)}%
    </span>
  );
}

export default function CampaignView({ base, mode }: { base?: string; mode: "owner" | "user" }) {
  const [data, setData] = useState<CampaignStatus | null>(null);
  const [err, setErr] = useState(false);
  const owner = mode === "owner";

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const d = await fetchCampaign(base);
      if (!alive) return;
      if (d) { setData(d); setErr(false); } else { setErr(true); }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [base]);

  const net = data?.net_usd ?? 0;
  const netUp = net >= 0;
  const closes = data?.recent_closes.slice().reverse() ?? [];

  return (
    <BayShell
      ornament="grid"
      eyebrow={owner ? "THE LIVE FLOOR · DESK-DRIVEN · PAPER AT LIVE PRICES" : "YOUR LIVE FLOOR · YOUR ENGINE · YOUR KEYS"}
      title={[owner ? "The" : "Your", "grid"]}
      lead={
        <>
          Every car is a position the firm opened on a desk vote. It runs from its <span className="text-signal2">stop</span> to its{" "}
          <span className="text-chartreuse">target</span> — where the car sits is how far the trade has travelled. Live. Hover a lane to read the gaps.
        </>
      }
      aside={
        <div className="mt-6 flex flex-col items-start gap-4">
          <span className={`inline-block border-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${owner ? "border-bone/40 text-bone/70" : "border-chartreuse text-chartreuse"}`}>
            {owner ? "🏠 owner engine · showcase (running 24/7)" : "🛰 your engine"}
          </span>
          <div className="fl-cta inline-block border-2 border-chartreuse bg-carbon px-4 py-2.5" style={{ boxShadow: "5px 5px 0 rgba(201,242,75,0.45)" }}>
            <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-bone/85">
              paper capital at live prices — <span className="text-chartreuse">no real capital — fills go to the Bitget Demo.</span>
              <br />opened only on quantitative desk votes · ATR-sized SL/TP · the discipline is the product.
            </p>
          </div>
        </div>
      }
      footer={<>HELIQUANT · {owner ? "THE GRID" : "YOUR GRID"} · {data?.principle ?? "paper at live prices — no real capital — fills go to the Bitget Demo"}</>}
    >
      {/* ⚡ BITGET EXECUTION CONSOLE — the venue made unmissable (teal = Bitget integration) */}
      <div data-fx="rise" className="-mt-8">
        <BitgetConsole data={data} />
      </div>

      {/* ── CAPITAL · how much profit, paper vs Bitget Demo ── */}
      {data?.capital && (() => {
        const c = data.capital;
        const bg = c.bitget_saldo;
        const HERO = "clamp(2.6rem, 7vw, 4rem)";
        const pPnl = c.realized_pnl_usd + c.unrealized_pnl_usd;
        const pUp = pPnl >= 0;
        const roiUp = c.roi_pct >= 0;
        return (
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div data-fx="rise" data-tilt className="fl-card fl-tilt border-2 border-bone/25 bg-carbon">
              <div className="flex items-center justify-between border-b-2 border-bone/15 px-5 py-2.5">
                <p className="font-display text-sm font-bold uppercase tracking-wide text-bone">📄 Paper accounting</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-steel">bankroll at live prices</p>
              </div>
              <div className="p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-steel">net profit · paper</p>
                <p className="font-display font-extrabold leading-none" style={{ fontSize: HERO, color: pUp ? "var(--color-chartreuse)" : "var(--color-signal2)", textShadow: `0 0 30px ${pUp ? "rgba(201,242,75,0.25)" : "rgba(255,90,31,0.25)"}` }}>
                  <CountUp value={pnl2(pPnl)} />
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t-2 border-bone/10 pt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-bone/70">
                  <span>ROI <span className="font-bold" style={{ color: roiUp ? "var(--color-chartreuse)" : "var(--color-signal2)" }}>{roiUp ? "+" : ""}{c.roi_pct.toFixed(2)}%</span></span>
                  <span>equity <span className="font-bold text-bone">{usd0(c.equity_usd)}</span> <span className="text-steel">from {usd0(c.starting_capital_usd)}</span></span>
                </div>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-steel">realized {pnl2(c.realized_pnl_usd)} · unrealized {pnl2(c.unrealized_pnl_usd)}</p>
              </div>
            </div>

            <div data-fx="rise" data-tilt className={`fl-card fl-tilt border-2 ${bg ? "border-bitget/55" : "border-bone/20"} bg-carbon`} style={{ "--i": 1 } as React.CSSProperties}>
              <div className="flex items-center justify-between border-b-2 border-bone/15 px-5 py-2.5">
                <p className="font-display text-sm font-bold uppercase tracking-wide" style={{ color: bg ? "var(--color-bitget)" : "rgba(242,239,230,0.4)" }}>⚡ Bitget Demo</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-steel">real demo fills · no real funds</p>
              </div>
              {bg ? (() => {
                const bReal = bg.realized_pnl_usd ?? 0, bUnreal = bg.unrealized_pnl_usd ?? 0, bRoi = bg.roi_pct ?? 0;
                const bPnl = bReal + bUnreal, bUp = bPnl >= 0;
                return (
                  <div className="p-5">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-steel">net profit · Bitget Demo</p>
                    <p className="font-display font-extrabold leading-none" style={{ fontSize: HERO, color: bUp ? "var(--color-bitget)" : "var(--color-signal2)", textShadow: `0 0 30px ${bUp ? "rgba(28,229,207,0.25)" : "rgba(255,90,31,0.25)"}` }}>
                      <CountUp value={pnl2(bPnl)} />
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t-2 border-bone/10 pt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-bone/70">
                      <span>ROI <span className="font-bold" style={{ color: bUp ? "var(--color-bitget)" : "var(--color-signal2)" }}>{bRoi >= 0 ? "+" : ""}{bRoi.toFixed(2)}%</span></span>
                      <span>balance <span className="font-bold text-bitget">{usd0(bg.equity_usd)}</span> <span className="text-steel">avail {usd0(bg.available_usd)}</span></span>
                    </div>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-steel">realized {pnl2(bReal)} · unrealized {pnl2(bUnreal)}{bg.baseline_usd ? ` · since base ${usd0(bg.baseline_usd)}` : ""}</p>
                  </div>
                );
              })() : (
                <div className="px-5 py-7">
                  <p className="font-display text-2xl font-extrabold uppercase leading-none text-bone/40">not armed</p>
                  <p className="mt-2 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-steel/80">set BITGET_EXECUTE=1 + keys on the engine to trade on Bitget Demo — the real demo profit shows here.</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── lap board ── */}
      {data && (
        <div className="bay-strip mt-10 grid-cols-2 lg:grid-cols-4">
          <div data-fx="rise" className="bay-stat px-5 py-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">positions opened {data.target == null ? "· always-on" : ""}</p>
            <p className="bay-stat-v mt-1 font-display text-4xl font-extrabold leading-none text-bone">
              <CountUp value={String(data.opened)} />
              {data.target != null && <span className="text-xl text-steel">/{data.target}</span>}
            </p>
            <div className="mt-3 h-2 overflow-hidden border border-bone/20 bg-pitch">
              {data.target == null ? (
                <div className="h-full w-full animate-pulse bg-chartreuse/70" />
              ) : (
                <div className="bay-grow h-full bg-chartreuse" style={{ width: `${(data.opened / data.target) * 100}%` }} />
              )}
            </div>
          </div>
          <div data-fx="rise" data-tone={netUp ? "good" : "bad"} className="bay-stat px-5 py-4" style={{ "--i": 1 } as React.CSSProperties}>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">net realized P&amp;L</p>
            <p className="bay-stat-v mt-1 font-display text-4xl font-extrabold leading-none" style={{ color: netUp ? "var(--color-chartreuse)" : "var(--color-signal2)" }}>
              <CountUp value={`${netUp ? "+" : "−"}$${Math.abs(net).toFixed(2)}`} />
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-steel">{data.closed} closed · win {data.win_pct}%</p>
          </div>
          <div data-fx="rise" className="bay-stat px-5 py-4" style={{ "--i": 2 } as React.CSSProperties}>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">exits</p>
            <div className="bay-stat-v mt-2 flex flex-wrap items-end gap-3 font-display text-2xl font-extrabold leading-none">
              <span className="text-chartreuse" title="take-profit">🎯{data.exits_by_reason.TP}</span>
              <span className="text-signal2" title="stop-loss">🛑{data.exits_by_reason.SL}</span>
              <span className="text-bone/70" title="time exit">⏱{data.exits_by_reason.TIME}</span>
              {(data.exits_by_reason.TRAIL ?? 0) > 0 && <span className="text-chartreuse" title="trailed">🪤{data.exits_by_reason.TRAIL}</span>}
            </div>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-steel">{data.open_now} on track now</p>
          </div>
          <div data-fx="rise" className="bay-stat px-5 py-4" style={{ "--i": 3 } as React.CSSProperties}>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">demo fills</p>
            <p className="bay-stat-v mt-1 font-display text-4xl font-extrabold leading-none text-bone">
              <CountUp value={String(data.testnet_fills)} />
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-steel">{data.risk_model}</p>
          </div>
        </div>
      )}

      {/* ── the grid (open positions as race lanes) ── */}
      <section className="mt-16">
        <SectionHead
          n="01"
          title="On the grid"
          sub={<>{data?.open_now ?? 0} cars · <span className="text-signal2">SL</span> ◂ entry ▸ <span className="text-chartreuse">TP</span> · ◆ = live price</>}
        />
        <div className="border-2 border-bone/25 bg-carbon">
          {!data && !err && <p className="py-10 text-center font-mono text-sm uppercase tracking-[0.2em] text-steel">connecting to the floor…</p>}
          {err && (
            <p className="py-10 text-center font-mono text-sm uppercase tracking-[0.2em] text-steel">
              {owner ? "floor unreachable — the firm is on Railway; retrying every 20s" : (
                <>your engine unreachable — is it running + tunnelled? <Link href="/onboarding" className="text-chartreuse underline">register →</Link></>
              )}
            </p>
          )}
          {data && data.open_positions.length === 0 && (
            <p className="py-10 text-center font-mono text-sm uppercase tracking-[0.2em] text-steel">grid empty — desks flat, nothing to open (the firm doesn&apos;t coin-flip)</p>
          )}
          {data?.open_positions.map((p, i) => <Lane key={p.id} p={p} i={i} />)}
        </div>
      </section>

      {/* ── results ticker (recent closes) ── */}
      {closes.length > 0 && (
        <section className="mt-16">
          <SectionHead n="02" title="Crossed the line" sub="recent closes · hover to hold the ticker" />
          {closes.length > 4 ? (
            <div data-fx="rise" className="bay-marquee py-1">
              <div className="bay-marquee-track" style={{ "--dur": `${closes.length * 3.5}s` } as React.CSSProperties}>
                <div className="flex gap-2">
                  {closes.map((c) => <ClosePill key={c.id} c={c} />)}
                </div>
                <div aria-hidden className="flex gap-2">
                  {closes.map((c) => <ClosePill key={`d${c.id}`} c={c} />)}
                </div>
              </div>
            </div>
          ) : (
            <div data-fx="stagger" className="flex flex-wrap gap-2">
              {closes.map((c) => <ClosePill key={c.id} c={c} />)}
            </div>
          )}
        </section>
      )}
    </BayShell>
  );
}
