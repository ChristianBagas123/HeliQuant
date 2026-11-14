"use client";

/**
 * TradeLedger — THE LEDGER. Every RESOLVED trade HeliQuant has made, with its full data: direction,
 * entry→exit, net%, PnL$, exit reason, the regime it opened in, and the desk-votes that justified it.
 * Reads /trades live. Honest: these are paper trades at live prices (real fills on Bitget Demo when
 * armed); the DECISIONS are what get sealed on-chain (see the anchor strip below).
 *
 * Motion: filter chips (wins / losses / venue), a header that sticks under the nav, a win/loss rail on
 * every row, and rows that open in place to show the whole record (times, size, every reason, the tx).
 */

import { useEffect, useState } from "react";

import { nearblocksTx } from "@/lib/contracts";
import { TRADED_BASKET, fetchTrades, venueLabel, type Trade, type TradeLog } from "@/lib/campaign";
import { Note, Stat, StatStrip } from "@/components/garage/bay/parts";

const POLL_MS = 20000;
const PAGE = 25;

const REASON_META: Record<string, { color: string; label: string }> = {
  TP: { color: "text-chartreuse border-chartreuse/50", label: "take-profit" },
  SL: { color: "text-signal2 border-signal2/50", label: "stop-loss" },
  TIME: { color: "text-steel border-bone/30", label: "time-exit" },
  TRAIL: { color: "text-bone/70 border-bone/30", label: "trailed" },
  STALL: { color: "text-steel border-bone/30", label: "stalled — cut" },
  NEARTP: { color: "text-chartreuse border-chartreuse/50", label: "banked near TP" },
};
const REGIME_COLOR: Record<string, string> = { up: "text-chartreuse", down: "text-signal2", flat: "text-steel" };

type Filter = "all" | "wins" | "losses" | "bitget" | "paper";
const isBitget = (t: Trade) => (t.venue ?? "").includes("bitget");
const FILTERS: { k: Filter; label: string; test: (t: Trade) => boolean }[] = [
  { k: "all", label: "all", test: () => true },
  { k: "wins", label: "wins", test: (t) => (t.pnl_usd ?? 0) > 0 },
  { k: "losses", label: "losses", test: (t) => (t.pnl_usd ?? 0) <= 0 },
  { k: "bitget", label: "⚡ bitget demo", test: isBitget },
  { k: "paper", label: "📄 paper", test: (t) => !isBitget(t) },
];

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const utc = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
function held(t: Trade): string {
  if (!t.utc_close) return "—";
  const h = (Date.parse(t.utc_close) - Date.parse(t.utc_open)) / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`;
}

const COLS = "lg:grid-cols-[170px_1fr_80px_86px_100px_150px_16px]";

export default function TradeLedger() {
  const [log, setLog] = useState<TradeLog | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const t = await fetchTrades();
      if (!alive) return;
      setReached(Boolean(t));
      if (t) setLog(t);
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // the live Bitget basket — any non-basket trade is dropped from the ledger + its stats
  const trades = (log?.trades ?? []).filter((t) => TRADED_BASKET.has((t.asset || "").toUpperCase()));
  const wins = trades.filter((t) => (t.pnl_usd ?? 0) > 0).length;
  const winPct = trades.length ? Math.round((wins / trades.length) * 1000) / 10 : 0;
  const net = trades.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);
  const test = FILTERS.find((f) => f.k === filter)!.test;
  const rows = trades.filter(test);

  return (
    <div className="space-y-8">
      {/* summary blotter */}
      <StatStrip>
        <Stat i={0} k="trades resolved" v={`${trades.length}`} />
        <Stat i={1} k="win rate" v={`${winPct}%`} tone={winPct >= 50 ? "good" : "muted"} />
        <Stat i={2} k="net P&L (paper)" v={`${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(2)}`} tone={net >= 0 ? "good" : "bad"} />
        <Stat i={3} k="open now" v={`${log?.open_now ?? 0}`} />
      </StatStrip>

      {/* the blotter */}
      {reached === false && !log ? (
        <div className="border-2 border-bone/20 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
          ledger unreachable — the firm runs on Railway; retrying every 20s
        </div>
      ) : trades.length === 0 ? (
        <div className="border-2 border-bone/15 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
          {log ? "no resolved trades yet — the floor is still working its first positions" : "reading the ledger…"}
        </div>
      ) : (
        <div>
          <div role="group" aria-label="Filter trades" className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.k}
                type="button"
                className="bay-chip"
                data-on={filter === f.k ? "" : undefined}
                aria-pressed={filter === f.k}
                onClick={() => {
                  setFilter(f.k);
                  setOpen(null);
                  setLimit(PAGE);
                }}
              >
                {f.label}
                <span className="bay-chip-n">{trades.filter(f.test).length}</span>
              </button>
            ))}
          </div>

          <div className="border-2 border-bone/15">
            {/* header row — sticks under the nav */}
            <div className={`bay-sticky hidden gap-3 border-b-2 border-bone/15 bg-pitch/95 px-5 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-steel backdrop-blur lg:grid ${COLS}`}>
              <span>asset · side · venue</span>
              <span>entry → exit</span>
              <span className="text-right">net %</span>
              <span className="text-right">P&amp;L $</span>
              <span>exit · regime</span>
              <span>on-chain · age</span>
              <span />
            </div>
            <div className="divide-y divide-bone/10">
              {rows.length === 0 && <p className="bg-carbon px-5 py-8 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-steel">no trades match this filter</p>}
              {rows.slice(0, limit).map((t, i) => (
                <TradeRow key={t.id} t={t} i={i} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
              ))}
            </div>
          </div>
          {rows.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + PAGE * 2)} className="fl-btn fl-btn-ghost fl-cta mt-4 w-full">
              show more · {rows.length - limit} older
            </button>
          )}
        </div>
      )}

      <Note>
        honest scope — these are <span className="text-bone">paper trades at live prices</span> (real fills route
        to Bitget Demo when armed). no real capital is used. every resolved trade&apos;s
        outcome is <span className="text-chartreuse">sealed on NEAR</span> — tap any tx to verify on NearBlocks.
      </Note>
    </div>
  );
}

function TradeRow({ t, i, open, onToggle }: { t: Trade; i: number; open: boolean; onToggle: () => void }) {
  const long = t.dir === "LONG";
  const pnl = t.pnl_usd ?? 0;
  const net = t.net_pct ?? 0;
  const rm = REASON_META[t.exit_reason ?? "TIME"] ?? REASON_META.TIME;
  const win = pnl > 0;
  const bitget = isBitget(t);
  return (
    <div className="fl-row bay-row bg-carbon" data-open={open ? "" : undefined} data-tone={win ? undefined : "bad"} style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[2px] ${win ? "bg-chartreuse/70" : "bg-signal2/60"}`} />
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`grid cursor-pointer grid-cols-2 items-center gap-3 px-5 py-3 outline-none ${COLS}`}
      >
        {/* asset + side + venue (paper vs real Bitget Demo fill) */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display text-base font-extrabold uppercase text-bone">{venueLabel(t.asset, t.venue)}</span>
          <span className={`font-mono text-[10px] font-bold uppercase ${long ? "text-chartreuse" : "text-signal2"}`}>{long ? "↑L" : "↓S"}</span>
          <span
            title={bitget ? "real fill on Bitget Demo" : "paper trade at the live price"}
            className={`whitespace-nowrap border px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.08em] ${bitget ? "border-bitget/50 text-bitget" : "border-bone/25 text-steel"}`}
          >
            {bitget ? "⚡ Bitget Demo" : "📄 paper"}
          </span>
        </div>
        {/* entry -> exit */}
        <div className="font-mono text-[11px] text-bone/70">
          <span className="text-bone/50">{t.entry}</span>
          <span className="mx-1 text-steel">→</span>
          <span className="text-bone/80">{t.exit ?? "—"}</span>
          {t.reasons?.length ? <span className="ml-2 hidden text-[9px] uppercase tracking-wide text-steel xl:inline">· {t.reasons.slice(0, 2).join(" · ")}</span> : null}
        </div>
        <span className={`text-right font-mono text-sm font-bold ${win ? "text-chartreuse" : "text-signal2"}`}>{net >= 0 ? "+" : ""}{net.toFixed(2)}%</span>
        <span className={`text-right font-mono text-sm ${win ? "text-chartreuse" : "text-signal2"}`}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</span>
        <div className="flex items-center gap-2">
          <span className={`border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] ${rm.color}`}>{t.exit_reason ?? "—"}</span>
          {t.regime ? <span className={`font-mono text-[9px] uppercase ${REGIME_COLOR[t.regime] ?? "text-steel"}`}>{t.regime}</span> : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          {t.anchor_tx ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-chartreuse" title={t.anchor_tx}>
              <span className="bay-seal h-1.5 w-1.5 rounded-full bg-chartreuse" style={{ "--i": i % 6 } as React.CSSProperties} />
              {t.anchor_tx.slice(0, 6)}…{t.anchor_tx.slice(-4)}
            </span>
          ) : (
            <span className="flex items-center gap-1 font-mono text-[10px] text-steel">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-steel/70" />
              sealing…
            </span>
          )}
          <span className="font-mono text-[10px] text-steel">{ago(t.utc_close)}</span>
        </div>
        <span aria-hidden className="hidden font-mono text-xs text-steel transition-transform duration-300 lg:block" style={{ transform: open ? "rotate(90deg)" : undefined }}>›</span>
      </div>

      {/* the full record */}
      <div className="bay-expand">
        <div>
          <div className="grid gap-x-8 gap-y-3 border-t border-bone/10 px-5 py-4 font-mono text-[10px] uppercase tracking-[0.12em] sm:grid-cols-2 lg:grid-cols-4">
            <Field k="opened" v={utc(t.utc_open)} />
            <Field k="closed" v={utc(t.utc_close)} />
            <Field k="held" v={held(t)} />
            <Field k="size" v={`$${t.size_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`} />
            <Field k="tier" v={t.tier} />
            <Field k="exit" v={rm.label} />
            <Field k="regime at open" v={t.regime ?? "—"} />
            <Field k="trade id" v={`#${t.id}`} />
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-steel">why it opened</p>
              <p className="mt-1 normal-case tracking-normal text-bone/75">{t.reasons?.length ? t.reasons.join(" · ") : "—"}</p>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-steel">outcome sealed on NEAR</p>
              {t.anchor_tx ? (
                <a href={nearblocksTx(t.anchor_tx)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-all normal-case tracking-normal text-chartreuse hover:underline">
                  {t.anchor_tx} ↗
                </a>
              ) : (
                <p className="mt-1 text-bone/60">not sealed yet — the anchor is written after the close</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-steel">{k}</p>
      <p className="mt-0.5 text-bone/85">{v}</p>
    </div>
  );
}
