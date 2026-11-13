"use client";

/**
 * ProofView — THE PROOF. TEE proofs of the LLM calls, read live from the agent's GET /tee and GET /tee/{cycle_id}
 * (NEAR AI Cloud). Display only: the agent reports the verification result, and anyone can re-check it with
 * agents/scripts/verify_tee.py. Fails quietly when the agent does not answer.
 *
 * Motion: cycle chips carry a mini verified bar; the selected cycle's verified share fills a ring; the
 * attestation preflight reads as lamps; each call row opens to its full chat id and signer (copyable);
 * the verify command types itself into a terminal.
 */

import { useEffect, useState } from "react";

import { fetchTeeBundle, fetchTeeList, type TeeBundle, type TeeSummary } from "@/lib/campaign";
import { getEngineUrl } from "@/lib/engine";
import { allVerified, shortHex, verifiedText, verifyCommand } from "@/lib/tee-logic";
import CopyButton from "@/components/garage/bay/CopyButton";
import { Note, SectionHead, Stat, StatStrip } from "@/components/garage/bay/parts";

const POLL_MS = 60000;
const DOCS_URL = "https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md";

const ratio = (v?: number, n?: number) => (n ? Math.max(0, Math.min(1, (v ?? 0) / n)) : 0);

function Lamp({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <span className={`flex items-center gap-2 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${ok ? "border-chartreuse/50 text-chartreuse" : "border-signal2/50 text-signal2"}`}>
      <span className="bay-lamp" data-on={ok ? "go" : "wait"} />
      {label} · {ok ? "ok" : "no"}
    </span>
  );
}

function Ring({ v, n }: { v?: number; n?: number }) {
  const f = ratio(v, n);
  const ok = !!n && v === n;
  const color = ok ? "var(--color-chartreuse)" : "var(--color-signal2)";
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(242,239,230,0.1)" strokeWidth="8" />
        <circle className="bay-arc" cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="8" pathLength={100} strokeDasharray={`${(f * 100).toFixed(1)} 100`} style={{ filter: ok ? "drop-shadow(0 0 5px rgba(201,242,75,0.7))" : undefined }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="font-display text-3xl font-extrabold leading-none" style={{ color }}>{v ?? 0}<span className="text-lg text-steel">/{n ?? 0}</span></p>
          <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.18em] text-steel">verified</p>
        </div>
      </div>
    </div>
  );
}

export default function ProofView() {
  const [list, setList] = useState<TeeSummary[] | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [bundle, setBundle] = useState<TeeBundle | null>(null);
  const [bundleErr, setBundleErr] = useState(false);
  const [openCall, setOpenCall] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const l = await fetchTeeList(10);
      if (!alive) return;
      setReached(l !== null);
      if (l) {
        setList(l);
        setSelected((cur) => cur ?? l[0]?.cycle_id ?? null);
      }
    };
    void pull();
    const id = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    void fetchTeeBundle(selected).then((b) => {
      if (!alive) return;
      setBundle(b);
      setBundleErr(b === null);
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  if (reached === false && !list) {
    return (
      <div className="border-2 border-bone/20 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
        proofs unreachable — the agent service is not answering; retrying every 60s
      </div>
    );
  }
  if (list && list.length === 0) {
    return (
      <div className="border-2 border-bone/15 bg-carbon px-6 py-12 text-center font-mono text-xs uppercase tracking-[0.2em] text-steel">
        no cycle with TEE proofs yet — the first one appears after the next cycle
      </div>
    );
  }

  const cur = bundle && bundle.cycle_id === selected ? bundle : null;
  const pre = cur?.preflight;
  const cycles = list ?? [];
  const sumV = cycles.reduce((s, c) => s + (c.n_verified ?? 0), 0);
  const sumN = cycles.reduce((s, c) => s + (c.n_calls ?? 0), 0);
  const fullCycles = cycles.filter((c) => allVerified(c)).length;
  const cmd = verifyCommand(getEngineUrl() || "<agent-url>", selected ?? "<cycle_id>");

  return (
    <div className="space-y-16">
      <StatStrip>
        <Stat i={0} k="cycles with proofs" v={`${cycles.length}`} sub="latest, newest first" />
        <Stat i={1} k="calls verified" v={sumN ? `${sumV}/${sumN}` : "—"} tone={sumN && sumV === sumN ? "good" : sumN ? "bad" : "muted"} sub="across the listed cycles" />
        <Stat i={2} k="fully verified cycles" v={`${fullCycles}`} tone={fullCycles ? "good" : "muted"} sub="every call signed + checked" />
        <Stat i={3} k="model" v={cur?.model ?? cycles[0]?.model ?? "—"} count={false} size="md" sub="NEAR AI Cloud · TEE" />
      </StatStrip>

      <section>
        <SectionHead n="01" title="Pick a cycle" sub="each chip is one firm cycle · the bar is its verified share" />
        <div role="group" aria-label="Cycles" data-fx="stagger" className="flex flex-wrap gap-2">
          {cycles.map((c) => {
            const on = c.cycle_id === selected;
            const f = ratio(c.n_verified, c.n_calls);
            return (
              <button
                key={c.cycle_id}
                type="button"
                onClick={() => {
                  setBundle(null);
                  setBundleErr(false);
                  setOpenCall(null);
                  setSelected(c.cycle_id);
                }}
                aria-pressed={on}
                className={`bay-pill min-w-[118px] border-2 bg-carbon px-3.5 py-2 text-left font-mono text-[10px] uppercase tracking-[0.12em] ${on ? "border-chartreuse text-chartreuse" : "border-bone/15 text-bone/70 hover:border-bone/40"}`}
                style={on ? { boxShadow: "4px 4px 0 rgba(201,242,75,0.45)" } : undefined}
              >
                <span className="block font-display text-base font-extrabold text-bone">{c.asset ?? "—"}</span>
                <span className="block">{verifiedText(c.n_verified, c.n_calls)}</span>
                <span className="mt-1.5 block h-1 bg-pitch">
                  <span className="block h-full transition-[width] duration-700" style={{ width: `${f * 100}%`, background: f === 1 ? "var(--color-chartreuse)" : "var(--color-signal2)" }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <SectionHead n="02" title="The cycle's proofs" sub="signed by the TEE · checked by the agent · re-checkable by you" />
        {bundleErr && (
          <div className="border-2 border-signal2/40 bg-carbon px-6 py-8 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-signal2">
            this cycle&apos;s bundle could not be loaded
          </div>
        )}
        {!cur && !bundleErr && <div className="border-2 border-bone/15 bg-carbon px-6 py-10 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-steel">opening the bundle…</div>}

        {cur && (
          <div key={cur.cycle_id} data-fx="rise" className="fl-card border-2 border-bone/25 bg-carbon">
            <div className="flex flex-wrap items-center gap-6 border-b-2 border-bone/15 px-5 py-5">
              <Ring v={cur.n_verified} n={cur.n_calls} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">cycle</p>
                <p className="flex flex-wrap items-center gap-3 font-mono text-sm text-chartreuse">
                  <span className="break-all">{cur.cycle_id}</span>
                  <CopyButton text={cur.cycle_id} />
                </p>
                <p className="mt-1 font-mono text-[10px] text-steel">
                  {cur.asset ?? "—"} · {cur.at ?? "—"} · model {cur.model ?? "—"}
                </p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-steel" title={cur.proofs_sha256}>
                  proofs sha256 <span className="text-bone/70">{shortHex(cur.proofs_sha256, 10, 6)}</span>
                </p>
              </div>
              <p className={`font-display text-2xl font-extrabold uppercase ${allVerified(cur) ? "text-chartreuse" : "text-signal2"}`}>{allVerified(cur) ? "all signed ✓" : "partly signed"}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-bone/10 px-5 py-3">
              <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-steel">attestation preflight</span>
              <Lamp ok={pre?.nonce_ok} label="nonce" />
              <Lamp ok={pre?.nvidia_ok} label="NVIDIA GPU" />
              <span className="font-mono text-[10px] text-steel" title={pre?.nonce}>nonce {shortHex(pre?.nonce, 10, 6)}</span>
              {pre?.reason && <span className="font-mono text-[10px] text-signal2">{pre.reason}</span>}
            </div>

            <div className="hidden grid-cols-[1fr_200px_160px_130px_16px] gap-3 px-5 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-steel md:grid">
              <span>call</span>
              <span>chat id</span>
              <span>signer</span>
              <span>result</span>
              <span />
            </div>
            <div className="divide-y divide-bone/10">
              {(cur.calls ?? []).map((c, i) => {
                const open = openCall === i;
                return (
                  <div key={`${c.label}-${i}`} className="fl-row bay-row" data-open={open ? "" : undefined} data-tone={c.verified ? undefined : "bad"} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setOpenCall(open ? null : i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpenCall(open ? null : i);
                        }
                      }}
                      className="grid cursor-pointer grid-cols-2 items-center gap-3 px-5 py-2.5 font-mono text-[11px] outline-none md:grid-cols-[1fr_200px_160px_130px_16px]"
                    >
                      <span className="flex items-center gap-2 text-bone">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.verified ? "bay-seal bg-chartreuse" : "bg-signal2"}`} style={{ "--i": i % 6 } as React.CSSProperties} />
                        {c.label}
                      </span>
                      <span className="hidden text-bone/70 md:block" title={c.chat_id}>{shortHex(c.chat_id, 12, 6)}</span>
                      <span className="hidden text-bone/70 md:block" title={c.signing_address}>{shortHex(c.signing_address, 8, 6)}</span>
                      <span className={`text-right md:text-left ${c.verified ? "text-chartreuse" : "text-signal2"}`}>{c.verified ? "verified" : "unverified"}</span>
                      <span aria-hidden className="hidden text-steel transition-transform duration-300 md:block" style={{ transform: open ? "rotate(90deg)" : undefined }}>›</span>
                    </div>
                    <div className="bay-expand">
                      <div>
                        <div className="grid gap-3 border-t border-bone/10 px-5 py-3 font-mono text-[10px] sm:grid-cols-2">
                          <Detail k="chat id" v={c.chat_id} />
                          <Detail k="signing address" v={c.signing_address} />
                          <Detail k="provider · model" v={[c.provider, c.model].filter(Boolean).join(" · ") || undefined} />
                          <Detail k="result" v={c.verified ? "signature verified" : `unverified${c.reason ? ` · ${c.reason}` : ""}`} plain />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* verify it yourself */}
      <section>
        <SectionHead n="03" title="Verify it yourself" sub="the check needs only requests + pynacl" />
        <div data-fx="rise" className="fl-card border-2 border-chartreuse/50 bg-pitch">
          <div className="flex items-center justify-between gap-3 border-b border-bone/10 px-4 py-2">
            <span className="flex items-center gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-signal2/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-bone/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-chartreuse/80" />
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-steel">verify_tee.py · {selected ? shortHex(selected, 8, 4) : "no cycle"}</span>
            <CopyButton text={cmd} label="copy command" />
          </div>
          <div className="overflow-x-auto px-4 py-4">
            <p className="whitespace-nowrap font-mono text-xs text-bone">
              <span className="text-chartreuse">$ </span>
              <span key={cmd} className="bay-type" style={{ "--n": cmd.length } as React.CSSProperties}>{cmd}</span>
              <span aria-hidden className="bay-caret" />
            </p>
          </div>
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-steel">
          this page only shows what the agent reports · signature format:{" "}
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-chartreuse hover:underline">
            NEAR AI Cloud response signatures ↗
          </a>
        </p>
      </section>

      {/* honest limits */}
      <Note tone="warn">
        what this proves: <span className="text-bone">which model produced which answer from which exact input</span>.
        what it does not: that the market data was right, or that the answer reasons well. The Intel TDX quote itself is
        not verified here; the check covers the signature, the signer&apos;s attestation nonce and the NVIDIA GPU
        attestation. A call that fell back to another provider shows as unverified.
      </Note>
    </div>
  );
}

function Detail({ k, v, plain }: { k: string; v?: string; plain?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="uppercase tracking-[0.16em] text-steel">{k}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-bone/85">
        <span className="break-all">{v ?? "—"}</span>
        {v && !plain && <CopyButton text={v} />}
      </p>
    </div>
  );
}
