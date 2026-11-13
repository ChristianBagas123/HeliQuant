"use client";

/**
 * LearningBay — THE TUNING BAY. HeliQuant's self-learning made watchable across its THREE layers:
 *   L1 · Edge Discovery   — the edge registry (edge_lab): validated edges gate aggression; candidates
 *                            on probation. "Earn the edge."
 *   L2 · Desk Reliability  — desk_performance: each of the 9 desks earns a weight 0.6–1.4 by track record.
 *   L3 · Tactical Re-map   — campaign cond_record (regime-aware) + intake refusals + cooling bays.
 *
 * Distinct metaphor from THE GRID (race lanes): a tuning console — bars are the data geometry.
 * Reads /edges, /desks, /campaign, live (20s poll). Honest throughout: 0 edges faked.
 * Motion: bars grow as each layer scrolls in, desk needles swing out from neutral, vetoed entries get
 * struck through, rows light up under the cursor, candidate cards tilt.
 */

import { useEffect, useMemo, useState } from "react";

import {
  fetchCampaign,
  fetchDesks,
  fetchEdges,
  type CampaignStatus,
  type DeskWeights,
  type EdgeRegistry,
  type EdgeRec,
} from "@/lib/campaign";
import LiveBadge from "@/components/garage/LiveBadge";
import { Note, SectionHead, Stat, StatStrip } from "@/components/garage/bay/parts";

const POLL_MS = 20000;

function runDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/* ───────────────────────── helpers ───────────────────────── */
type Cell = { key: string; asset: string; signal: string; regime: string; n: number; wins: number; pnl: number; status: "faded" | "trusted" | "watching"; mult: number };

function parseCond(rec: { cond: string; n: number; wins: number; pnl: number }): Cell {
  const [body, regime = "flat"] = rec.cond.split(" @");
  const [asset, ...sig] = body.split("|");
  const avg = rec.n ? rec.pnl / rec.n : 0;
  const status: Cell["status"] = rec.n < 4 ? "watching" : avg < 0 ? "faded" : "trusted";
  return { key: rec.cond, asset, signal: sig.join(" · "), regime, n: rec.n, wins: rec.wins, pnl: rec.pnl, status, mult: status === "faded" ? 0.5 : 1 };
}

const REGIME_COLOR: Record<string, string> = {
  up: "text-chartreuse border-chartreuse/50",
  down: "text-signal2 border-signal2/50",
  flat: "text-steel border-bone/30",
};
const STATUS_META = {
  faded: { tag: "DIALED BACK", color: "text-signal2", bar: "#ff5a1f" },
  trusted: { tag: "TRUSTED", color: "text-chartreuse", bar: "#c9f24b" },
  watching: { tag: "LEARNING", color: "text-bone/60", bar: "#8b8b80" },
} as const;

function ago(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

/* ───────────────────────── component ───────────────────────── */
export default function LearningBay() {
  const [camp, setCamp] = useState<CampaignStatus | null>(null);
  const [desks, setDesks] = useState<DeskWeights | null>(null);
  const [edges, setEdges] = useState<EdgeRegistry | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);
  const [lastGood, setLastGood] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const [c, d, e] = await Promise.all([fetchCampaign(), fetchDesks(), fetchEdges()]);
      if (!alive) return;
      setReached(Boolean(c || d || e));
      if (c) setCamp(c);
      if (d) setDesks(d);
      if (e) setEdges(e);
      if (c || d || e) setLastGood(new Date());
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // the firm's live Bitget basket — the lab tests these; non-basket leftovers from old runs are hidden
  const BASKET = useMemo(() => new Set(["BTC", "ETH", "SOL", "HYPE", "SUI", "XRP"]), []);
  const inBasket = (a?: string) => !a || BASKET.has(a.toUpperCase());

  const cells = useMemo(() => (camp?.learned?.records ?? []).map(parseCond).filter((c) => inBasket(c.asset)).sort((a, b) => a.pnl - b.pnl), [camp]); // eslint-disable-line react-hooks/exhaustive-deps
  const cooling = useMemo(() => Object.entries(camp?.last_scan ?? {}).filter(([, v]) => v.startsWith("cooldown")), [camp]);
  const skips = camp?.recent_skips ?? [];
  const worstPnl = Math.min(-1, ...cells.map((c) => c.pnl));

  const candidates = useMemo<EdgeRec[]>(() => Object.values(edges?.candidate ?? {}).filter((e) => inBasket(e.asset)), [edges]); // eslint-disable-line react-hooks/exhaustive-deps
  const validatedN = Object.keys(edges?.validated ?? {}).length;
  const lastRun = runDate(edges?.last_run);
  const [lo, hi] = desks?.bounds ?? [0.6, 1.4];
  const deskRows = useMemo(
    () => (desks?.desks ?? []).map((name) => {
      const w = desks?.weights?.[name] ?? 1;
      const det = desks?.detail?.[name];
      return { name, w, samples: det?.samples ?? 0, align: det?.align_rate ?? null };
    }),
    [desks]
  );

  if (reached === false && !camp && !desks && !edges) {
    return (
      <div className="border-2 border-bone/20 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
        tuning bay unreachable — the firm runs on Railway; retrying every 20s
      </div>
    );
  }

  const minSamples = desks?.min_samples ?? 15;

  return (
    <div className="space-y-20">
      {/* proof-of-life */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">self-learning console · /edges · /desks · /campaign</p>
        <LiveBadge at={lastGood} />
      </div>

      {/* ── headline stat strip ── */}
      <StatStrip className="-mt-12">
        <Stat i={0} k="validated edges · traded" v={`${validatedN}`} tone={validatedN ? "good" : "muted"} />
        <Stat i={1} k="tested · on probation · not traded" v={`${candidates.length}`} />
        <Stat i={2} k="desks earning trust" v={`${desks?.desks?.length ?? 0}`} />
        <Stat i={3} k="conditions learned" v={`${camp?.learned?.tracked ?? 0}`} />
      </StatStrip>

      {/* ════ LAYER 1 · EDGE DISCOVERY ════ */}
      <section>
        <SectionHead n="L1" title="Edge discovery" sub="earn the edge · cost-aware OOS + walk-forward + FDR → ONLY validated edges trade" />
        <Note tone={validatedN ? undefined : "warn"} className="text-[11px]">
          {validatedN ? (
            <><span className="text-chartreuse">{validatedN} VALIDATED EDGE(S)</span> — cleared to trade. Only validated edges ever touch capital.</>
          ) : (
            <><span className="text-signal2">0 VALIDATED EDGES → NOTHING TRADES.</span> The lab keeps testing, but only a validated edge touches capital. The candidates below are <span className="text-bone">tested, NOT traded</span>. Discipline over a fabricated number.</>
          )}
        </Note>
        <div className="mb-3 mt-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">
            tested by the edge lab · <span className="text-bone/70">not traded</span> · awaiting validation
            <span className="text-bone/40"> — passed an OOS replay, but only graduate (and trade) after fresh-data confirmation</span>
          </p>
          {lastRun && (
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-steel">
              last edge-lab run: <span className="text-bone/70">{lastRun}</span>
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.length === 0 ? (
            <div className="border-2 border-bone/15 bg-carbon px-5 py-8 font-mono text-[11px] uppercase tracking-[0.16em] text-steel">no candidates in registry</div>
          ) : (
            candidates.map((e, i) => {
              const grad = (e.confirmations ?? 0) >= 1;
              const pw = e.p_win != null ? Math.max(0, Math.min(1, e.p_win)) : null;
              return (
                <div key={`${e.asset}-${e.edge}`} data-fx="rise" data-tilt className="fl-card fl-tilt group border-2 border-bone/15 bg-carbon p-5" style={{ "--i": i } as React.CSSProperties}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-3xl font-extrabold uppercase text-bone">{e.asset}USDT</span>
                    <span className="border border-bone/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-bone/60">tested · not traded</span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-bone/70">
                    {e.edge}{e.horizon_h ? ` · ${e.horizon_h}h` : ""}
                    {grad && <span className="text-steel"> · {e.confirmations}× confirmed (still gated)</span>}
                  </p>
                  {pw != null && (
                    <div className="mt-4">
                      <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-steel">
                        <span>p(win)</span>
                        <span className="text-bone/80">{(pw * 100).toFixed(1)}%</span>
                      </div>
                      <div className="relative mt-1 h-1.5 bg-pitch">
                        <div className="bay-grow h-full bg-bone/60" style={{ width: `${pw * 100}%` }} />
                        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-bone/40" />
                      </div>
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
                    <Metric k="OOS ROI" v={e.oos_roi_pct != null ? `${e.oos_roi_pct >= 0 ? "+" : ""}${e.oos_roi_pct.toFixed(0)}%` : "—"} good={(e.oos_roi_pct ?? 0) > 0} />
                    <Metric k="payoff" v={e.payoff_b != null ? `${e.payoff_b.toFixed(2)}×` : "—"} good={(e.payoff_b ?? 0) > 1} />
                    <Metric k="samples" v={`${e.sample_n ?? "—"}`} />
                    <Metric k="p-value" v={e.pval != null ? e.pval.toFixed(3) : "—"} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ════ LAYER 2 · DESK RELIABILITY ════ */}
      <section>
        <SectionHead n="L2" title="Desk reliability" sub={`who the firm trusts · each desk earns ${lo}–${hi} by track record (≥${minSamples} graded samples)`} />
        <div className="hidden grid-cols-[230px_1fr_180px] gap-4 px-5 pb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-steel lg:grid">
          <span>desk</span>
          <span className="text-center">← discounted · neutral 1.0 · trusted →</span>
          <span className="text-right">record · verdict</span>
        </div>
        <div className="space-y-px bg-bone/10">
          {deskRows.map((d, i) => {
            const trusted = d.w > 1.05;
            const discounted = d.w < 0.95;
            const color = trusted ? "var(--color-chartreuse)" : discounted ? "var(--color-signal2)" : "#8b8b80";
            const wPct = ((d.w - lo) / (hi - lo)) * 100;
            const centerPct = ((1 - lo) / (hi - lo)) * 100;
            const left = Math.min(centerPct, wPct);
            const width = Math.abs(wPct - centerPct);
            const verdict = trusted ? "TRUSTED" : discounted ? "DISCOUNTED" : d.samples < minSamples ? "EARNING" : "NEUTRAL";
            const earn = Math.min(1, d.samples / minSamples);
            return (
              <div key={d.name} tabIndex={0} data-fx="rise" data-tone={discounted ? "bad" : undefined} className="bay-row grid items-center gap-4 bg-carbon px-5 py-3.5 lg:grid-cols-[230px_1fr_180px]" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                <span className="font-display text-base font-bold uppercase tracking-wide text-bone">{d.name}</span>
                {/* centred weight bar: neutral 1.0 at the tick, fills right = trusted / left = discounted, the needle marks the weight */}
                <div className="flex items-center gap-3">
                  <span className="w-7 shrink-0 text-right font-mono text-[10px] text-steel">{lo}</span>
                  <div className="relative h-3 flex-1 border border-bone/20 bg-pitch" style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0 calc(12.5% - 1px), rgba(242,239,230,0.07) calc(12.5% - 1px) 12.5%)" }}>
                    <div className="absolute top-[-3px] h-[calc(100%+6px)] w-px bg-bone/50" style={{ left: `${centerPct}%` }} />
                    <div className="bay-grow absolute top-0 h-full" style={{ left: `${left}%`, width: `${width}%`, background: color, opacity: 0.85, transformOrigin: wPct >= centerPct ? "0 50%" : "100% 50%" }} />
                    <span className="bay-marker" style={{ left: `${wPct}%`, background: color, boxShadow: `0 0 10px ${color}`, "--from": `${centerPct}%` } as React.CSSProperties} />
                  </div>
                  <span className="w-7 shrink-0 font-mono text-[10px] text-steel">{hi}</span>
                  <span className="w-12 shrink-0 text-right font-mono text-xs font-bold" style={{ color }}>×{d.w.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 lg:justify-end">
                  <span className="flex items-center gap-2 font-mono text-[10px] text-bone/45">
                    {verdict === "EARNING" && (
                      <span className="relative inline-block h-1 w-10 bg-pitch" title={`${d.samples} of ${minSamples} graded samples`}>
                        <span className="bay-grow absolute inset-y-0 left-0 bg-bone/50" style={{ width: `${earn * 100}%` }} />
                      </span>
                    )}
                    {d.samples}/{minSamples}
                    {d.align != null ? ` · ${(d.align * 100).toFixed(0)}%` : ""}
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{verdict}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-bone/55">
          neutral 1.0 until a desk proves itself · graded 24h after each call against the live mark · weights are an
          ADVISORY prior to the PM — gates still bind
        </p>
      </section>

      {/* ════ LAYER 3 · TACTICAL RE-MAP ════ */}
      <section>
        <SectionHead n="L3" title="Tactical re-map" sub="every closed trade dials a condition's throttle · regime-aware" />
        {cells.length === 0 ? (
          <div className="border-2 border-bone/15 bg-carbon px-6 py-10 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
            still gathering first runs — no condition has enough closes to re-map yet
          </div>
        ) : (
          <div className="space-y-px bg-bone/10">
            {cells.map((c, i) => {
              const m = STATUS_META[c.status];
              const lossFrac = Math.max(0, Math.min(1, -c.pnl / -worstPnl));
              return (
                <div key={c.key} tabIndex={0} data-fx="rise" data-tone={c.status === "faded" ? "bad" : undefined} className="bay-row grid items-center gap-4 bg-carbon px-5 py-4 lg:grid-cols-[260px_1fr_210px]" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-2xl font-extrabold uppercase text-bone">{c.asset}USDT</span>
                    <span className={`border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${REGIME_COLOR[c.regime] ?? REGIME_COLOR.flat}`}>{c.regime}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-bone/50">{c.signal}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-steel">throttle</span>
                      <div className="relative h-3 flex-1 border border-bone/20 bg-pitch">
                        <div className="bay-grow h-full" style={{ width: `${c.mult * 100}%`, background: m.bar, opacity: 0.85, boxShadow: `0 0 10px ${m.bar}66` }} />
                        <div className="absolute left-1/2 top-0 h-full w-px bg-bone/30" />
                      </div>
                      <span className={`w-12 shrink-0 font-mono text-xs font-bold ${m.color}`}>×{c.mult}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-steel">P&amp;L</span>
                      <div className="h-1.5 flex-1 bg-pitch">
                        <div className="bay-grow h-full" style={{ width: `${lossFrac * 100}%`, background: c.pnl < 0 ? "#ff5a1f" : "#c9f24b", opacity: 0.6 }} />
                      </div>
                      <span className={`w-16 shrink-0 text-right font-mono text-[11px] ${c.pnl < 0 ? "text-signal2" : "text-chartreuse"}`}>{c.pnl >= 0 ? "+" : ""}${c.pnl.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 lg:justify-end">
                    <span className="font-mono text-[11px] text-bone/55">{c.wins}/{c.n} won</span>
                    <span className={`border-2 px-2.5 py-1 font-display text-xs font-extrabold uppercase tracking-wider ${m.color}`} style={{ borderColor: m.bar }}>{m.tag}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* intake refusals + cooling */}
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <div>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-steel">refused at intake · <span className="text-signal2">{camp?.skips ?? 0}</span> counter-trend entries vetoed</p>
            <div data-fx="rise" className="fl-card border-2 border-bone/25 bg-carbon">
              {skips.length === 0 ? (
                <p className="px-5 py-6 font-mono text-[11px] uppercase tracking-[0.16em] text-steel">none in window</p>
              ) : (
                <div className="divide-y divide-bone/10">
                  {skips.slice().reverse().map((s, i) => (
                    <div key={`${s.utc}-${i}`} className="bay-row flex items-center gap-3 px-5 py-2.5 font-mono text-[11px]" data-tone="bad">
                      <span className="w-20 font-display text-base font-bold uppercase text-bone">{s.asset}USDT</span>
                      <span className="bay-strike text-signal2" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>⊘ {s.dir}</span>
                      <span className="text-bone/45">vs regime {s.regime}</span>
                      <span className="ml-auto text-steel">{ago(s.utc)} ago</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-steel">cooling off · benched after a losing round</p>
            <div data-fx="rise" className="fl-card border-2 border-bone/25 bg-carbon" style={{ "--i": 1 } as React.CSSProperties}>
              {cooling.length === 0 ? (
                <p className="flex items-center gap-3 px-5 py-6 font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
                  <span className="bay-lamp" data-on="go" /> all bays active
                </p>
              ) : (
                <div className="divide-y divide-bone/10">
                  {cooling.map(([asset, v]) => (
                    <div key={asset} className="bay-row flex items-center gap-3 px-5 py-2.5 font-mono text-[11px]" data-tone="bad">
                      <span className="bay-lamp" data-on="wait" />
                      <span className="w-12 font-display text-base font-bold uppercase text-bone">{asset}</span>
                      <span className="text-bone/55">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Note>
        three layers, one principle — the firm <span className="text-bone">earns</span> every edge, <span className="text-bone">weights</span> every
        desk by record, and <span className="text-signal2">dials back</span> every proven loser in its regime.
        <span className="text-chartreuse"> no validated edge is faked</span> — discipline is the product.
      </Note>
    </div>
  );
}

function Metric({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-bone/10 pb-1">
      <span className="text-[9px] uppercase tracking-[0.12em] text-steel">{k}</span>
      <span className={good == null ? "text-bone/80" : good ? "text-chartreuse" : "text-signal2"}>{v}</span>
    </div>
  );
}
