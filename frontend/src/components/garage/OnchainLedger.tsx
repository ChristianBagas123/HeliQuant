"use client";

/**
 * OnchainLedger — THE CHAIN TAPE. The recent transactions of HeliQuant's core contract on NEAR testnet: decision and
 * trade anchors (`anchor` seals a record's SHA-256 as an event), desk outputs (`record_output`) and job flow, fetched
 * LIVE from the agent's /onchain endpoint (NearBlocks API v3). A flight recorder — verifiable on NearBlocks, not a
 * claim. Modular: type any NEAR account to see its recent transactions (only the latest page is shown).
 * Motion: the spine draws down as the tape scrolls in, sealed anchors pulse, rows slide aside under the cursor.
 */

import { useEffect, useMemo, useState } from "react";

import { signerLabel } from "@/lib/account-label";
import { fetchOnchain, type OnchainLedger as Ledger } from "@/lib/campaign";
import { nearblocksTx } from "@/lib/contracts";
import { EXECUTOR_ACCOUNT } from "@/lib/heliquant";
import { isNearAccountId } from "@/lib/hire-logic";
import { CountUp } from "@/components/garage/FloorMotion";
import { Note } from "@/components/garage/bay/parts";

const POLL_MS = 30000;

function ago(sec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function OnchainLedger() {
  const [data, setData] = useState<Ledger | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [account, setAccount] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const d = await fetchOnchain(account);
      if (!alive) return;
      setReached(Boolean(d));
      if (d) setData(d);
    };
    void pull();
    const id = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [account]);

  const anchors = useMemo(() => (data?.txs ?? []).filter((t) => t.self_anchor).length, [data]);
  const valid = isNearAccountId(input.trim().toLowerCase());
  const explorer = data?.explorer ?? "";

  return (
    <div className="space-y-10">
      {/* recorder head — account + chain + counts */}
      <div data-fx="rise" className="fl-card border-2 border-bone/25 bg-carbon">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-bone/15 px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">recorder · account</p>
            {/* the full account name is shown, never truncated */}
            <a
              href={data && explorer ? `${explorer}/address/${data.account}` : "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all font-mono text-sm text-chartreuse hover:underline"
            >
              {data?.account ?? "—"}
            </a>
          </div>
          <div className="flex gap-8">
            <Stat k="chain" v={data?.chain ?? "NEAR testnet"} />
            <Stat k="recent tx" v={`${data?.total ?? 0}`} />
            <Stat k="sealed anchors" v={`${anchors}`} accent />
          </div>
        </div>
        {/* BYO account — modular */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-steel">trace any account</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="name.testnet"
            spellCheck={false}
            aria-label="NEAR account to trace"
            className="min-w-[220px] flex-1 border border-bone/25 bg-pitch px-3 py-1.5 font-mono text-xs text-bone placeholder:text-steel/60 focus:border-chartreuse focus:outline-none"
          />
          <button
            type="button"
            disabled={!valid && input.trim() !== ""}
            onClick={() => setAccount(input.trim().toLowerCase() || undefined)}
            className="fl-cta gr-press border-2 border-bone/40 px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-bone transition-colors hover:border-chartreuse hover:text-chartreuse disabled:opacity-40"
          >
            Trace
          </button>
          {account && (
            <button
              type="button"
              onClick={() => {
                setAccount(undefined);
                setInput("");
              }}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-steel hover:text-bone"
            >
              ↺ core contract
            </button>
          )}
        </div>
      </div>

      {/* the tape */}
      {reached === false && !data ? (
        <div className="border-2 border-bone/20 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
          chain tape unreachable — the agent service is not answering; retrying every 30s
        </div>
      ) : data?.error ? (
        <div className="border-2 border-signal2/40 bg-carbon px-6 py-8 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-signal2">
          {data.error}
        </div>
      ) : (data?.txs?.length ?? 0) === 0 ? (
        <div className="border-2 border-bone/15 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
          no transactions recorded for this account
        </div>
      ) : (
        <div data-fx="rise" className="relative">
          <div aria-hidden className="bay-spine" />
          <div className="space-y-px">
            {data!.txs.map((t, i) => {
              const who = signerLabel(t.from, EXECUTOR_ACCOUNT);
              return (
              <a
                key={t.hash}
                href={nearblocksTx(t.hash)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
                className="fl-row bay-tape-row group relative flex items-center gap-4 bg-carbon py-3 pl-8 pr-5"
              >
                <span
                  style={{ "--i": i % 6 } as React.CSSProperties}
                  className={`absolute left-[3px] h-2.5 w-2.5 rounded-full border-2 transition-transform duration-300 group-hover:scale-125 ${
                    t.is_error
                      ? "border-signal2 bg-pitch"
                      : t.self_anchor
                        ? "bay-seal border-chartreuse bg-chartreuse"
                        : "border-steel bg-pitch"
                  }`}
                />
                <span className="w-24 shrink-0 font-mono text-[10px] text-steel">#{t.block}</span>
                <span className="flex-1 truncate font-mono text-xs text-bone/85 group-hover:text-chartreuse">{t.hash}</span>
                <span
                  title={who.title}
                  className={`hidden shrink-0 font-mono text-[10px] md:inline ${who.executor ? "text-chartreuse" : "text-steel"}`}
                >
                  {who.text}
                </span>
                <span
                  className={`hidden shrink-0 border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] sm:inline ${
                    t.is_error
                      ? "border-signal2/50 text-signal2"
                      : t.self_anchor
                        ? "border-chartreuse/50 text-chartreuse"
                        : "border-bone/25 text-steel"
                  }`}
                >
                  {t.is_error ? "failed" : t.self_anchor ? "record sealed" : t.method || "tx"}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] text-steel">{ago(t.ts)}</span>
                <span aria-hidden className="shrink-0 font-mono text-[10px] text-steel/60 group-hover:text-chartreuse">↗</span>
              </a>
              );
            })}
          </div>
        </div>
      )}

      <Note>
        each <span className="text-chartreuse">sealed record</span> is a SHA-256 written by{" "}
        <span className="text-bone">core.anchor</span> as an on-chain event —{" "}
        <span className="text-bone">tap any row to verify on NearBlocks.</span> the firm can&apos;t rewrite history; the
        chain is the witness.
      </Note>
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">{k}</p>
      <p className={`font-display text-xl font-extrabold leading-none ${accent ? "text-chartreuse" : "text-bone"}`}>{/^\d+$/.test(v) ? <CountUp value={v} /> : v}</p>
    </div>
  );
}
