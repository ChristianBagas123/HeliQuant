"use client";

/**
 * InspectPanel — the detail card for the part being inspected: the engine part, the desk it stands
 * for, how that desk works, and the desk's LIVE numbers from the firm (reliability weight, samples,
 * align rate, on-chain identity, the PM's latest call that mentions it). Every live field says
 * where it came from; a missing field says "not reported" instead of inventing a value.
 */

import type { Decision } from "@/lib/live";

import { PARTS, type PartInfo } from "./parts";
import type { Agent, DeskLive } from "./useDeskLive";

function ago(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.floor(s / 60)}m ago`;
  if (s < 172800) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const agoIso = (iso?: string | null) => (iso ? ago(Date.parse(iso)) : "—");

function Row({ k, v, accent }: { k: string; v: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-bone/10 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-steel">{k}</span>
      <span className={`text-right font-mono text-[12px] ${accent ? "text-chartreuse" : "text-bone"}`}>{v}</span>
    </div>
  );
}

function WeightBar({ w, bounds }: { w: number; bounds: [number, number] }) {
  const [lo, hi] = bounds;
  const pct = ((w - lo) / (hi - lo)) * 100;
  const mid = ((1 - lo) / (hi - lo)) * 100;
  return (
    <div className="relative mt-2 h-2 bg-bone/10">
      <span className="absolute inset-y-0 w-px bg-bone/40" style={{ left: `${mid}%` }} />
      <span className="fl-bar absolute inset-y-0 left-0 bg-chartreuse" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

function latestMention(decisions: Decision[] | null, re: RegExp | null): Decision | null {
  if (!decisions || !re) return null;
  return decisions.find((d) => d.reason && re.test(d.reason)) ?? null;
}

function excerpt(text: string, re: RegExp, span = 120) {
  const m = re.exec(text);
  if (!m) return { before: text.slice(0, span), hit: "", after: "" };
  const start = Math.max(0, m.index - span / 2);
  return { before: (start > 0 ? "…" : "") + text.slice(start, m.index), hit: m[0], after: text.slice(m.index + m[0].length, m.index + m[0].length + span / 2) + "…" };
}

export default function InspectPanel({ part, live, onClose, onStep }: { part: PartInfo; live: DeskLive; onClose: () => void; onStep: (d: 1 | -1) => void }) {
  const idx = PARTS.findIndex((p) => p.id === part.id);
  const detail = part.desk ? live.desks?.detail[part.desk] : undefined;
  const agent: Agent | undefined = part.desk ? live.agents?.list.find((a) => a.name === part.desk) : part.id === "block" ? live.agents?.list.find((a) => a.kind === "Firm") : undefined;
  const mention = latestMention(live.decisions, part.mentions);
  const decisions = live.decisions ?? [];
  const enters = decisions.filter((d) => d.decision === "ENTER").length;
  const explorer = live.agents?.explorer;

  return (
    <aside key={part.id} className="fl-panel pointer-events-auto flex max-h-full flex-col border-2 border-bone/25 bg-pitch/88 backdrop-blur-md" aria-label={`${part.name} — ${part.label}`}>
      {/* header */}
      <div className="flex items-center justify-between border-b-2 border-bone/15 px-5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">
          inspect · <span className="text-bone">{String(idx + 1).padStart(2, "0")}</span>/{PARTS.length}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onStep(-1)} aria-label="Previous part" className="fl-icon-btn">
            ←
          </button>
          <button type="button" onClick={() => onStep(1)} aria-label="Next part" className="fl-icon-btn">
            →
          </button>
          <button type="button" onClick={onClose} aria-label="Close inspector" className="fl-icon-btn ml-1">
            ✕
          </button>
        </div>
      </div>

      <div className="fl-panel-body overflow-y-auto px-5 pb-6 pt-5" data-lenis-prevent>
        <p className="fl-stagger font-mono text-[10px] uppercase tracking-[0.26em] text-signal2" style={{ "--i": 0 } as React.CSSProperties}>
          {part.name}
        </p>
        <h3 className="fl-stagger mt-1 font-display text-4xl font-extrabold uppercase leading-none text-chartreuse" style={{ "--i": 1 } as React.CSSProperties}>
          {part.label}
        </h3>
        <p className="fl-stagger mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-bone/70" style={{ "--i": 2 } as React.CSSProperties}>
          {part.role}
        </p>

        <p className="fl-stagger mt-4 text-[13px] leading-relaxed text-bone/75" style={{ "--i": 3 } as React.CSSProperties}>
          {part.how}
        </p>

        {/* ── live ── */}
        <div className="fl-stagger mt-6" style={{ "--i": 4 } as React.CSSProperties}>
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-steel">
            <span className={`inline-block h-1.5 w-1.5 ${live.reached ? "animate-pulse bg-chartreuse" : "bg-signal2"}`} />
            {live.reached === false ? "live · firm unreachable" : `live from the firm · ${ago(live.at)}`}
          </p>

          {part.desk && (
            <div className="mt-2">
              {detail ? (
                <>
                  <Row k="reliability weight" v={detail.weight.toFixed(2)} accent={detail.weight > 1} />
                  {live.desks?.bounds && <WeightBar w={detail.weight} bounds={live.desks.bounds} />}
                  <Row k="graded samples" v={`${detail.samples}${live.desks?.minSamples ? ` / ${live.desks.minSamples} to earn weight` : ""}`} />
                  <Row k="align rate" v={detail.align_rate == null ? "not graded yet" : `${(detail.align_rate * 100).toFixed(0)}%`} />
                </>
              ) : live.desks?.names.includes(part.desk) ? (
                // listed by the firm but no track record yet: the firm treats it as neutral (1.0)
                <>
                  <Row k="reliability weight" v="1.00 · neutral" />
                  <Row k="graded samples" v={`0${live.desks.minSamples ? ` / ${live.desks.minSamples} to earn weight` : ""}`} />
                  <Row k="align rate" v="not graded yet" />
                </>
              ) : (
                <Row k="reliability" v={live.desks ? "not reported" : "loading…"} />
              )}
            </div>
          )}

          {part.id === "crank" && (
            <div className="mt-2">
              <Row k="decisions in feed" v={decisions.length || "—"} />
              <Row k="ENTER / ABSTAIN" v={decisions.length ? `${enters} / ${decisions.length - enters}` : "—"} accent={enters > 0} />
              <Row k="cycles run" v={live.status?.cycles ?? "—"} />
              <Row k="last cycle" v={agoIso(live.status?.last_cycle_utc)} />
            </div>
          )}

          {part.id === "block" && (
            <div className="mt-2">
              <Row k="cycles run" v={live.status?.cycles ?? "—"} />
              <Row k="assets watched" v={live.status?.assets?.join(" · ") ?? "—"} />
              <Row k="interval" v={live.status?.interval_min ? `${live.status.interval_min} min` : "—"} />
              <Row k="real execution" v={live.status ? (live.status.execute ? "on" : "off · paper") : "—"} />
            </div>
          )}

          {(agent || part.desk) && (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">on-chain identity · {live.agents?.network ?? "near"}</p>
              {agent ? (
                <>
                  <Row k="agent token" v={agent.tokenId ? `#${agent.tokenId}` : "—"} />
                  {agent.account && (
                    <Row
                      k="account"
                      v={
                        explorer ? (
                          <a href={`${explorer}/address/${agent.account}`} target="_blank" rel="noreferrer" className="underline decoration-bone/30 underline-offset-4 hover:text-chartreuse">
                            {agent.account}
                          </a>
                        ) : (
                          agent.account
                        )
                      }
                    />
                  )}
                  <Row k="credentials" v={agent.reputation?.credentials ?? "—"} />
                  {part.id === "block" && <Row k="jobs · success" v={agent.reputation ? `${agent.reputation.total_jobs ?? 0} · ${agent.reputation.successful_jobs ?? 0}` : "—"} />}
                  {part.id === "block" && agent.reputation?.cum_pnl_usd != null && <Row k="cumulative pnl" v={`${agent.reputation.cum_pnl_usd >= 0 ? "+" : ""}$${agent.reputation.cum_pnl_usd.toFixed(4)}`} />}
                </>
              ) : (
                <Row k="registry" v={live.agents ? "not registered on-chain" : "loading…"} />
              )}
            </div>
          )}

          {(mention || part.id === "crank") && (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">{part.id === "crank" ? "the PM's latest call" : "latest PM call that cites this desk"}</p>
              {(() => {
                const d = part.id === "crank" ? decisions[0] : mention;
                if (!d) return <p className="mt-2 font-mono text-[11px] text-steel">no call in the feed yet</p>;
                const ex = part.mentions && d.reason ? excerpt(d.reason, part.mentions) : { before: (d.reason ?? "").slice(0, 160) + "…", hit: "", after: "" };
                return (
                  <div className="mt-2 border-l-2 border-chartreuse/60 bg-carbon/80 px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-bone">
                      {d.asset} · <span className={d.decision === "ENTER" ? "text-chartreuse" : "text-bone/60"}>{d.decision}</span> · <span className="text-steel">{agoIso(d.utc)}</span>
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-bone/60">
                      {ex.before}
                      {ex.hit && <mark className="bg-chartreuse/20 px-0.5 text-chartreuse">{ex.hit}</mark>}
                      {ex.after}
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* ── anatomy ── */}
        <div className="fl-stagger mt-6" style={{ "--i": 5 } as React.CSSProperties}>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">anatomy · pinned on the part</p>
          <ol className="mt-2 space-y-1.5">
            {part.anatomy.map((a, i) => (
              <li key={a} className="flex gap-3 text-[12px] leading-snug text-bone/70">
                <span className="fl-spot-num">{i + 1}</span>
                {a}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </aside>
  );
}
