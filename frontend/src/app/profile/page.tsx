"use client";

/**
 * /profile — "YOUR PIT" (Night Garage). The user's own corner: which engine the dashboard reads,
 * its health, the wallet, the credentials on file (KEY NAMES only — never values), and quick links.
 * No-custody: credential names are read from YOUR engine's /setup-status; values never leave it.
 *
 * Look: the bay shell (wrench-on-a-bolt ornament), a stat strip from live reads (engine health, the
 * measured ping, keys on file, wallet), an engine card with a re-check and a confirm-before-disconnect,
 * a holographic wallet plate, and a keyring that lights one lamp per credential name your engine holds
 * (veiled while you are on the owner showcase or your engine is offline).
 */

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useNearWallet } from "near-connect-hooks";

import BayShell from "@/components/garage/bay/BayShell";
import CopyButton from "@/components/garage/bay/CopyButton";
import { SectionHead, Stat, StatStrip } from "@/components/garage/bay/parts";
import { ConnectWallet } from "@/components/connect-wallet";
import { CREDS, GROQ_KEY, GROUPS } from "@/lib/credentials";
import { nearblocksAccount } from "@/lib/contracts";
import { clearEngineUrl, getEngineUrl, isOwnerEngine, pingEngine } from "@/lib/engine";

type SetupStatus = { register_enabled: boolean; stored_keys: string[] };
type Health = "checking" | "online" | "offline";

const v = (o: Record<string, string | number>) => o as React.CSSProperties;

// the keyring: the Groq pool first, then the form's two groups
const RING: { id: string; title: string; sub: string; keys: { key: string; label: string }[] }[] = [
  { id: "groq", title: "Groq pool", sub: "the desks' LLM rotation", keys: [{ key: GROQ_KEY, label: "Groq keys (rotation pool)" }] },
  ...GROUPS.map((g) => ({ id: g.id, title: g.title, sub: g.sub, keys: CREDS.filter((c) => c.group === g.id).map((c) => ({ key: c.key, label: c.label })) })),
];
const KNOWN = new Set(RING.flatMap((g) => g.keys.map((k) => k.key)));

/** ping YOUR engine and time the round trip; read the key names it holds (never values) */
async function probe(url: string, isOwner: boolean): Promise<{ health: Health; ms: number | null; setup: SetupStatus | null }> {
  const t0 = performance.now();
  const ok = await pingEngine(url);
  const ms = Math.round(performance.now() - t0);
  if (!ok) return { health: "offline", ms: null, setup: null };
  let setup: SetupStatus | null = null;
  if (!isOwner) {
    try {
      const r = await fetch(`${url}/setup-status?cb=${Date.now()}`, { cache: "no-store" });
      if (r.ok) setup = (await r.json()) as SetupStatus;
    } catch {
      /* ignore */
    }
  }
  return { health: "online", ms, setup };
}

// the engine choice lives in localStorage: read it as an external store (server snapshot = owner showcase)
function subscribeEngine(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
const noopSubscribe = () => () => {};

export default function ProfilePage() {
  const { signedAccountId, loading: walletLoading } = useNearWallet();
  const engineUrl = useSyncExternalStore(subscribeEngine, getEngineUrl, () => "");
  const owner = useSyncExternalStore(subscribeEngine, isOwnerEngine, () => true);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [health, setHealth] = useState<Health>("checking");
  const [ms, setMs] = useState<number | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    let alive = true;
    void probe(getEngineUrl(), isOwnerEngine()).then((r) => {
      if (!alive) return;
      setHealth(r.health);
      setMs(r.ms);
      setSetup(r.setup);
    });
    return () => {
      alive = false;
    };
  }, []);

  const recheck = async () => {
    setHealth("checking");
    const r = await probe(getEngineUrl(), isOwnerEngine());
    setHealth(r.health);
    setMs(r.ms);
    setSetup(r.setup);
  };

  const disconnect = () => {
    clearEngineUrl();
    window.location.href = "/profile";
  };

  const stored = new Set(setup?.stored_keys ?? []);
  const extra = (setup?.stored_keys ?? []).filter((k) => !KNOWN.has(k));
  const onFile = [...KNOWN].filter((k) => stored.has(k)).length;
  const locked = owner || health !== "online" || !setup;
  const lamp = health === "online" ? "go" : health === "offline" ? "wait" : undefined;

  return (
    <BayShell
      ornament="pit"
      eyebrow="YOUR PIT · ENGINE · WALLET · KEYS"
      title={["Your", "pit"]}
      lead={
        <>
          Your corner of the garage: which engine the dashboard reads, whether it answers, the wallet you hire with, and{" "}
          <span className="text-bone">which credentials your engine holds — by name only.</span>
        </>
      }
      aside={
        <div className="fl-cta mt-6 inline-block border-2 border-chartreuse bg-carbon px-4 py-2.5" style={{ boxShadow: "5px 5px 0 rgba(201,242,75,0.45)" }}>
          <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-bone/85">
            <span className="text-chartreuse">⚿ no custody</span> — values never leave your engine&apos;s local SQLite. This page reads key <em>names</em> only.
          </p>
        </div>
      }
      footer="HELIQUANT · YOUR PIT · your engine, your keys, no custody"
    >
      <StatStrip className="mb-14">
        <Stat i={0} k="engine" v={health} count={false} size="md" tone={health === "online" ? "good" : health === "offline" ? "bad" : "muted"} sub={owner ? "owner showcase · read-only" : "your engine"} />
        <Stat i={1} k="ping · round trip" v={ms === null ? "—" : `${ms} ms`} tone={ms === null ? "muted" : ms < 400 ? "good" : "muted"} sub="measured from this browser" />
        <Stat i={2} k="keys on file" v={owner || !setup ? "—" : `${onFile}/${KNOWN.size}`} sub={owner ? "connect your engine to read" : extra.length ? `+${extra.length} other name(s)` : "names only, never values"} />
        <Stat i={3} k="wallet" v={!mounted || walletLoading ? "…" : signedAccountId ? "connected" : "not connected"} count={false} size="md" tone={signedAccountId ? "good" : "muted"} sub="NEAR testnet" />
      </StatStrip>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── ENGINE ── */}
        <div data-fx="rise" data-tilt className="fl-card fl-tilt relative border-2 border-bone/20 bg-carbon p-6" style={v({ "--i": 0 })}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-steel">connected engine</p>
            <span className="flex items-center gap-2 border border-bone/20 bg-pitch px-2.5 py-1">
              {health === "checking" ? (
                <span aria-hidden className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-chartreuse border-t-transparent" />
              ) : (
                <span className="bay-lamp !h-2 !w-2" data-on={lamp} />
              )}
              <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.18em] ${health === "online" ? "text-chartreuse" : health === "offline" ? "text-signal2" : "text-bone/60"}`}>{health}</span>
            </span>
          </div>

          <p className={`mt-4 font-display text-4xl font-extrabold uppercase leading-none tracking-wide ${owner ? "text-bone" : "text-chartreuse"}`}>{owner ? "Owner showcase" : "Your engine"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {owner ? (
              <p className="font-mono text-[11px] text-bone/45">the founder&apos;s firm, running 24/7 — read-only</p>
            ) : (
              <>
                <p className="min-w-0 break-all font-mono text-[11px] text-bone/60">{engineUrl}</p>
                <CopyButton text={engineUrl} />
              </>
            )}
          </div>

          {/* ping trace — a sweep while checking, the measured round trip once it answers */}
          <div className="mt-5 border border-bone/10 bg-pitch px-3 py-2.5">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-steel">
              <span>/health</span>
              <span className={health === "online" ? "text-chartreuse" : health === "offline" ? "text-signal2" : ""}>{health === "checking" ? "pinging…" : ms !== null ? `${ms} ms` : "no answer"}</span>
            </div>
            <div className="relative mt-2 h-1.5 overflow-hidden bg-bone/10">
              {health === "checking" ? (
                <span className="pit-sweep absolute inset-y-0 w-1/3 bg-chartreuse" />
              ) : (
                <span
                  className={`absolute inset-y-0 left-0 transition-[width] duration-700 ${health === "online" ? "bg-chartreuse" : "bg-signal2"}`}
                  style={{ width: health === "online" && ms !== null ? `${Math.max(6, 100 - Math.min(ms, 1500) / 15)}%` : "100%" }}
                />
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/onboarding" className="fl-cta gr-press border-2 border-bone bg-chartreuse px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-pitch">
              {owner ? "register your engine" : "update / re-register"}
            </Link>
            <button
              type="button"
              onClick={() => void recheck()}
              disabled={health === "checking"}
              className="border-2 border-bone/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/70 transition-colors hover:border-chartreuse hover:text-chartreuse disabled:opacity-50"
            >
              ↻ re-check
            </button>
            {!owner &&
              (confirmOff ? (
                <span className="hire-pop flex items-center gap-2 border-2 border-signal2/60 px-2 py-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-signal2">back to showcase?</span>
                  <button type="button" onClick={disconnect} className="bg-signal2 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-pitch">
                    yes
                  </button>
                  <button type="button" onClick={() => setConfirmOff(false)} className="px-1 font-mono text-[9px] uppercase tracking-[0.14em] text-bone/60 hover:text-bone">
                    cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmOff(true)}
                  className="border-2 border-bone/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/70 transition-colors hover:border-signal2 hover:text-signal2"
                >
                  disconnect → showcase
                </button>
              ))}
          </div>
        </div>

        {/* ── WALLET ── a holographic plate */}
        <div data-fx="rise" data-tilt className="bay-holo fl-card fl-tilt relative border-2 border-bone/20 bg-carbon p-6" style={v({ "--i": 1 })}>
          {["left-2.5 top-2.5", "right-2.5 top-2.5", "left-2.5 bottom-2.5", "right-2.5 bottom-2.5"].map((pos) => (
            <span key={pos} aria-hidden className={`bay-rivet absolute ${pos} h-2.5 w-2.5 rounded-full`} />
          ))}
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-steel">wallet · NEAR testnet</p>
          {!mounted || walletLoading ? (
            <p className="mt-4 font-mono text-[12px] text-bone/45" aria-busy="true">
              reading wallet session…
            </p>
          ) : signedAccountId ? (
            <>
              <p className="mt-4 font-display text-4xl font-extrabold uppercase leading-none tracking-wide text-bone">
                <span className="fl-shine">Connected</span>
              </p>
              {/* the full account name is shown (no truncation) */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="min-w-0 break-all font-mono text-[12px] text-chartreuse">{signedAccountId}</p>
                <CopyButton text={signedAccountId} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                <a href={nearblocksAccount(signedAccountId)} target="_blank" rel="noreferrer" className="text-steel transition-colors hover:text-chartreuse">
                  view on NearBlocks ↗
                </a>
                <Link href="/hire" className="text-steel transition-colors hover:text-chartreuse">
                  hire the firm →
                </Link>
              </div>
              <p className="mt-4 font-mono text-[10px] leading-relaxed text-bone/45">hire the firm, claim payouts and settle jobs from this account on NEAR testnet.</p>
              <div className="mt-4">
                <ConnectWallet />
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 font-display text-4xl font-extrabold uppercase leading-none tracking-wide text-bone/35">Not connected</p>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-bone/45">connect a NEAR testnet account to hire the firm and settle jobs.</p>
              <div className="mt-4">
                <ConnectWallet />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── KEYRING — one lamp per credential name your engine holds ── */}
      <section className="mt-20">
        <SectionHead
          n="01"
          title="Keyring"
          sub="credentials on your engine · names only"
          right={
            <Link href="/onboarding" className="font-mono text-[10px] uppercase tracking-[0.14em] text-steel transition-colors hover:text-chartreuse">
              manage →
            </Link>
          }
        />

        <div className="bay-lock" data-open={locked ? undefined : ""}>
          {locked && (
            <div className="bay-lock-veil" aria-live="polite" style={{ placeItems: "start center", paddingTop: "4.5rem" }}>
              <div className="px-6 text-center">
                <svg viewBox="0 0 40 44" className="mx-auto h-10 w-10 text-chartreuse" aria-hidden>
                  <path className="bay-lock-icon" d="M11 20 V13 a9 9 0 0 1 18 0 V20" fill="none" stroke="currentColor" strokeWidth="3" />
                  <rect x="6" y="20" width="28" height="22" fill="none" stroke="currentColor" strokeWidth="3" />
                  <circle cx="20" cy="30" r="3" fill="currentColor" />
                </svg>
                <p className="mt-3 max-w-md font-mono text-[10px] uppercase leading-relaxed tracking-[0.18em] text-bone/85">
                  {owner
                    ? "you're viewing the owner showcase — connect your own engine to see your credentials here"
                    : health === "offline"
                      ? "your engine is offline — start it and make sure the tunnel is up"
                      : "reading from your engine…"}
                </p>
                {owner && (
                  <Link href="/onboarding" className="fl-cta gr-press mt-4 inline-block border-2 border-bone bg-chartreuse px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-pitch">
                    register your engine
                  </Link>
                )}
                {!owner && health === "offline" && (
                  <button type="button" onClick={() => void recheck()} className="mt-4 border-2 border-bone/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/80 hover:border-chartreuse hover:text-chartreuse">
                    ↻ re-check
                  </button>
                )}
              </div>
            </div>
          )}

          <div className={locked ? "pointer-events-none select-none opacity-40" : ""} aria-hidden={locked || undefined}>
            {/* completeness */}
            <div data-fx="rise" className="mb-6 border-2 border-bone/20 bg-carbon px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-steel">names on file</p>
                <p className="font-display text-2xl font-extrabold text-bone">
                  {locked ? "—" : onFile}
                  <span className="text-steel"> / {KNOWN.size}</span>
                </p>
              </div>
              <div className="mt-3 h-2 border border-bone/15 bg-pitch">
                <span className="bay-grow block h-full bg-chartreuse" style={{ width: `${locked ? 0 : (onFile / KNOWN.size) * 100}%`, boxShadow: "0 0 12px rgba(201,242,75,0.55)" }} />
              </div>
              <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-bone/40">most keys are optional — a dark lamp just means that line isn&apos;t set</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {RING.map((g, gi) => (
                <div key={g.id} data-fx="rise" className="fl-card border-2 border-bone/20 bg-carbon" style={v({ "--i": gi })}>
                  <div className="flex items-baseline justify-between border-b border-bone/10 px-5 py-3">
                    <p className="font-display text-lg font-extrabold uppercase tracking-wide text-bone">{g.title}</p>
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-steel">
                      {g.keys.filter((k) => stored.has(k.key)).length}/{g.keys.length}
                    </p>
                  </div>
                  <p className="px-5 pt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-bone/40">{g.sub}</p>
                  <ul className="px-2 py-2">
                    {g.keys.map((k, i) => {
                      const on = stored.has(k.key);
                      return (
                        <li key={k.key} className="bay-row flex items-center gap-3 px-3 py-2" style={v({ "--i": i })}>
                          <span className="bay-lamp !h-2 !w-2 shrink-0" data-on={on ? "go" : undefined} />
                          <span className="min-w-0 flex-1">
                            <span className={`block text-[12px] leading-tight ${on ? "text-bone" : "text-bone/50"}`}>{k.label}</span>
                            <span className="block truncate font-mono text-[9px] tracking-[0.08em] text-steel">{k.key}</span>
                          </span>
                          <span className={`font-mono text-[9px] uppercase tracking-[0.14em] ${on ? "text-chartreuse" : "text-bone/30"}`}>{on ? "on file" : "—"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            {extra.length > 0 && (
              <div data-fx="rise" className="mt-6 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-steel">other names on file ▸</span>
                {extra.map((k) => (
                  <span key={k} className="border border-chartreuse/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-chartreuse">
                    ✓ {k}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── shortcuts ── */}
      <section className="mt-20">
        <SectionHead n="02" title="Pit exits" sub="where to next" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/trade", t: "Your floor", d: "your firm's live grid, read from your engine" },
            { href: "/onboarding", t: "Register", d: "add or update the keys on your engine" },
            { href: "/hire", t: "Hire", d: "escrow test USDC and hire the firm on NEAR" },
            { href: "/proof", t: "Proof", d: "the TEE-signed desk calls, verifiable" },
          ].map((x, i) => (
            <Link key={x.href} href={x.href} data-fx="rise" className="fl-card group relative border-2 border-bone/20 bg-carbon px-5 py-5" style={v({ "--i": i })}>
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">{x.href}</p>
              <p className="mt-2 font-display text-2xl font-extrabold uppercase tracking-wide text-bone transition-colors group-hover:text-chartreuse">{x.t}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-bone/50">{x.d}</p>
              <span aria-hidden className="absolute right-5 top-5 font-display text-xl text-steel transition-[color,transform] duration-300 group-hover:translate-x-1 group-hover:text-chartreuse">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </BayShell>
  );
}
