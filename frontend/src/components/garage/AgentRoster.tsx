"use client";

/**
 * AgentRoster — THE CREW. HeliQuant's firm + 12 desks as on-chain identities (NEP-171 tokens in the core contract
 * on NEAR testnet). Each desk is a registered agent with a tokenId, an on-chain reputation that
 * accrues from its track record, and (cross-referenced) its off-chain desk_performance reliability.
 * Reads /agents live. Honest: reputation accrues forward — most read zero until outcomes are recorded.
 *
 * Motion: the firm card is a holographic plate whose light follows the cursor; desk cards tilt, their
 * kind strip widens and the outline token number lights on hover; kind chips filter the crew with
 * cards gliding to their new places.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { NEARBLOCKS } from "@/lib/contracts";
import { fetchAgents, fetchTeeBundle, fetchTeeList, type Agent, type AgentRoster as Roster, type TeeBundle } from "@/lib/campaign";
import { deskVerified } from "@/lib/tee-logic";
import { Note, Stat, StatStrip } from "@/components/garage/bay/parts";

const POLL_MS = 60000;

const KIND_COLOR: Record<string, string> = {
  Firm: "text-bone border-bone/40",
  Signal: "text-chartreuse border-chartreuse/40",
  Research: "text-[#7fd1ff] border-[#7fd1ff]/40",
  Risk: "text-signal2 border-signal2/40",
  Execution: "text-bone/70 border-bone/30",
};
const KIND_STRIP: Record<string, string> = { Signal: "text-chartreuse", Research: "text-[#7fd1ff]", Risk: "text-signal2", Execution: "text-bone/60" };

export default function AgentRoster() {
  const [data, setData] = useState<Roster | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);
  const [tee, setTee] = useState<TeeBundle | null>(null); // latest cycle bundle; null = /tee unavailable → no badges
  const [kind, setKind] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const d = await fetchAgents();
      if (!alive) return;
      setReached(Boolean(d));
      if (d) setData(d);
    };
    const pullTee = async () => {
      const list = await fetchTeeList(1);
      const b = list?.[0]?.cycle_id ? await fetchTeeBundle(list[0].cycle_id) : null;
      if (alive) setTee(b);
    };
    pull();
    void pullTee();
    const id = setInterval(() => {
      void pull();
      void pullTee();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const explorer = data?.explorer ?? NEARBLOCKS;
  const identity = data?.core ?? "";
  const tokenLink = (tid: number | null) =>
    tid != null && identity ? `${explorer}/nft-token/${identity}/${tid}` : `${explorer}/address/${identity}`;
  const firm = data?.agents?.find((a) => a.kind === "Firm");
  const desks = data?.agents?.filter((a) => a.kind !== "Firm") ?? [];
  const kinds = Array.from(new Set(desks.map((a) => a.kind)));
  const shown = kind === "all" ? desks : desks.filter((a) => a.kind === kind);
  const sealed = (data?.agents ?? []).reduce((s, a) => s + (a.reputation?.credentials ?? 0), 0);
  const teeN = desks.filter((a) => deskVerified(tee, a.name)).length;

  if (reached === false && !data) {
    return (
      <div className="border-2 border-bone/20 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
        roster unreachable — the agent service is not answering; retrying every 60s
      </div>
    );
  }
  if (data?.error) {
    return (
      <div className="border-2 border-bone/15 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
        {data.error}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <StatStrip>
        <Stat i={0} k="registered agents" v={`${data?.agents?.length ?? 0}`} sub={data?.network ? `NEP-171 · ${data.network}` : "NEP-171"} />
        <Stat i={1} k="outputs sealed on-chain" v={`${sealed}`} tone={sealed ? "good" : "muted"} sub="credentials across the crew" />
        <Stat i={2} k="TEE-verified desks · latest cycle" v={`${teeN}`} tone={teeN ? "good" : "muted"} sub={tee ? "desks whose LLM call is signed, ed25519" : "no bundle read"} />
        <Stat i={3} k="ML desk" v={`${desks.filter((a) => a.ml).length}`} sub="Regime · XGBoost" />
      </StatStrip>

      {/* firm card — holographic plate */}
      {firm && (
        <a
          href={tokenLink(firm.tokenId)}
          target="_blank"
          rel="noopener noreferrer"
          data-fx="rise"
          data-tilt
          className="bay-holo fl-card fl-tilt group flex flex-wrap items-center justify-between gap-6 border-2 border-chartreuse/50 bg-carbon px-6 py-7 sm:px-8"
          style={{ boxShadow: "6px 6px 0 rgba(201,242,75,0.85)" }}
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">the firm · on-chain identity</p>
            <p className="mt-1 font-display text-4xl font-extrabold uppercase text-bone sm:text-5xl">
              Heli<span className="text-chartreuse">Quant</span>
            </p>
            <p className="mt-1 max-w-xl font-mono text-[10px] uppercase tracking-wide text-bone/55">{firm.role}</p>
            {firm.reputation && (
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/60">
                <span>jobs <span className="text-bone">{firm.reputation.total_jobs ?? 0}</span></span>
                <span>success <span className="text-bone">{firm.reputation.successful_jobs ?? 0}</span></span>
                <span>sealed <span className="text-chartreuse">{firm.reputation.credentials ?? 0}</span></span>
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="bay-outline font-display text-7xl font-extrabold leading-none sm:text-8xl">#{firm.tokenId}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-steel group-hover:text-chartreuse">token · verify on nearblocks ↗</p>
          </div>
        </a>
      )}

      {/* kind filter */}
      {kinds.length > 1 && (
        <div role="group" aria-label="Filter the crew by kind" className="flex flex-wrap gap-2">
          {["all", ...kinds].map((k) => {
            const n = k === "all" ? desks.length : desks.filter((a) => a.kind === k).length;
            return (
              <button key={k} type="button" className="bay-chip" data-on={kind === k ? "" : undefined} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "all desks" : k}
                <span className="bay-chip-n">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* desk grid */}
      <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {shown.map((a, i) => (
            <motion.div
              key={a.tokenId ?? a.name}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.45, delay: Math.min(i * 0.04, 0.4), ease: [0.22, 1, 0.36, 1] }}
            >
              <AgentCard a={a} href={tokenLink(a.tokenId)} tee={deskVerified(tee, a.name)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <Note>
        every desk is a <span className="text-chartreuse">registered on-chain agent</span> (NEP-171) — not a
        claim. its reputation is its <span className="text-bone">real track record</span>, written to NEAR as
        outcomes resolve. tap any to verify on NearBlocks.
      </Note>
    </div>
  );
}

function AgentCard({ a, href, tee }: { a: Agent; href: string; tee: boolean }) {
  const kc = KIND_COLOR[a.kind] ?? "text-bone/70 border-bone/30";
  const rep = a.reputation;
  const w = a.weight;
  const wColor = w == null ? "text-steel" : w > 1.05 ? "text-chartreuse" : w < 0.95 ? "text-signal2" : "text-bone/60";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-tilt
      className="fl-card fl-tilt group relative flex h-full flex-col justify-between border-2 border-bone/12 bg-carbon p-5 pl-6"
    >
      <span aria-hidden className={`bay-kind ${KIND_STRIP[a.kind] ?? "text-bone/40"}`} />
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="bay-outline absolute -right-1 -top-3 font-display text-7xl font-extrabold leading-none">{a.tokenId ?? "—"}</span>
      </span>
      <div className="relative">
        <span className="block pr-16 font-display text-lg font-extrabold uppercase leading-tight text-bone">{a.name}</span>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] ${kc}`}>{a.kind}</span>
          <span className="border border-bone/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-bone/60">token #{a.tokenId ?? "—"}</span>
          {tee && (
            <span title="Its LLM call in the latest cycle ran in a NEAR AI Cloud TEE and its ed25519 signature verified" className="border border-chartreuse/50 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-chartreuse">
              TEE ✓
            </span>
          )}
          {a.ml && <span className="border border-chartreuse/50 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-chartreuse">ML · XGBoost</span>}
        </div>
        <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-bone/45">{a.role}</p>
      </div>
      <div className="relative mt-4 flex items-end justify-between border-t border-bone/10 pt-3 font-mono text-[10px]">
        <div>
          <p className="text-steel">outputs sealed on-chain</p>
          <p className={rep?.credentials ? "text-chartreuse" : "text-bone/60"}>
            {rep?.credentials ?? 0}
            {rep && (rep.credentials ?? 0) === 0 ? <span className="text-steel"> · first cycle</span> : " sealed"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-steel">reliability</p>
          <p className={wColor}>{w != null ? `${w.toFixed(2)}×` : "neutral"}</p>
        </div>
      </div>
      <span aria-hidden className="bay-hint relative mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-chartreuse">verify on nearblocks ↗</span>
    </a>
  );
}
