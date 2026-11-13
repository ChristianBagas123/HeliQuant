"use client";

/**
 * /onboarding — "REGISTER YOUR ENGINE" (Night Garage)
 *
 * NO-CUSTODY register. You run `agents-LocalReady` on your own machine, expose it via a tunnel
 * (ngrok), and this form POSTs your keys STRAIGHT to YOUR engine's /register — they're stored in its
 * local SQLite and never touch our server. After register, the dashboard connects to your engine.
 *
 * Groq: ten key slots (min 10) → joined into one comma-separated string the firm rotates across.
 *
 * Auth: NEP-413. The engine only accepts keys signed by the full-access key of its owner (HQ_OWNER_ACCOUNT in the
 * engine's .env): the wallet signs a one-time nonce from the engine + the sha256 of the creds (lib/nep413.ts).
 *
 * Motion: a 4-step stepper that tracks the real progress (URL typed → wallet connected → connected →
 * registered), fields that glow on focus, a 10-segment Groq meter, and locked sections behind a veil
 * that lifts once the engine answers.
 */

import { useRouter } from "next/navigation";
import { useNearWallet } from "near-connect-hooks";
import { useEffect, useState } from "react";

import BayShell from "@/components/garage/bay/BayShell";
import Tour, { type TourStep } from "@/components/garage/Tour";
import { CREDS, GROUPS } from "@/lib/credentials";
import { pingEngine, setEngineUrl } from "@/lib/engine";
import { b64ToBytes, credsSha256, registerMessage, signatureToString } from "@/lib/nep413";

const GROQ_SLOTS = 10;

const TOUR: TourStep[] = [
  { sel: '[data-tour="ob-engine"]', title: "Your engine", body: "Paste your local engine's tunnel URL and connect the NEAR wallet you set as HQ_OWNER_ACCOUNT on it. This is the engine the dashboard will read." },
  { sel: '[data-tour="ob-groq"]', title: "Groq keys", body: "Ten free Groq keys — the desks rotate across them to dodge rate limits. Joined into one string on submit." },
  { sel: '[data-tour="ob-creds"]', title: "Execution + power-ups", body: "Bitget keys to trade, a testnet wallet to anchor on-chain, and optional desk APIs (Nansen / Elfa; Allora is read keyless from its chain). All optional." },
  { sel: '[data-tour="ob-register"]', title: "Register", body: "Hit Register and sign the NEP-413 message in your wallet — your keys POST straight to YOUR engine's SQLite (never us), and the dashboard switches to your firm." },
  { sel: '[data-tour="/app"]', title: "Navbar · The floor", body: "The firm's live decision floor — desks → debate → PM, the autonomous loop at work." },
  { sel: '[data-tour="/campaign"]', title: "Navbar · The grid", body: "The live trading campaign — each open position as a race from its stop to its target. The owner's runs 24/7 here." },
  { sel: '[data-tour="/trade"]', title: "Navbar · Your floor", body: "Your OWN firm's live grid — reads YOUR connected local engine (vs The grid, which is the owner's showcase)." },
  { sel: '[data-tour="/carry"]', title: "Navbar · The edge", body: "The delta-neutral funding-carry monitor — market-neutral yield read live from Bitget funding." },
  { sel: '[data-tour="/learning"]', title: "Navbar · Tuning bay", body: "Self-learning — desk reliability weights + the edge lab that retires decayed edges." },
  { sel: '[data-tour="/agents"]', title: "Navbar · The crew", body: "The 12 desks as on-chain agents on NEAR — identity, reputation, sealed outputs, all verifiable." },
  { sel: '[data-tour="/ledger"]', title: "Navbar · Ledger", body: "Every decision + trade outcome, hashed and anchored on NEAR — the tamper-proof audit trail." },
  { sel: '[data-tour="/proof"]', title: "Navbar · Proof", body: "Every desk call is signed inside a NEAR AI TEE — check the attestation and the signatures yourself, no trust needed." },
  { sel: '[data-tour="/performance"]', title: "Navbar · The dyno", body: "Rigorous stats on the real ledger — Sharpe / Sortino / drawdown, no fantasy CAGR." },
  { sel: '[data-tour="/whales"]', title: "Navbar · Telemetry", body: "Live Hyperliquid whale positions the firm watches — and fades when they crowd a trade." },
  { sel: '[data-tour="/assets"]', title: "Navbar · Dyno bays", body: "Per-asset character — which assets are predictable vs efficient, driving the desk tilt." },
  { sel: '[data-tour="/hire"]', title: "Navbar · Hire", body: "The on-chain 'hire the firm' deposit product: test USDC, escrow, settle, claim." },
  { sel: '[data-tour="/firms/heliquant"]', title: "Navbar · License", body: "The firm's on-chain identity — the transferable strategy-brain NFT." },
  { sel: '[data-tour="/profile"]', title: "Navbar · Your pit", body: "Your engine status, wallet, and the credentials on file (names only) — your corner of the dApp." },
  { sel: '[data-tour="/onboarding"]', title: "Navbar · Register", body: "You're here — register your own engine to run your own firm. Replay this tour anytime from the guide." },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [engineUrl, setEngineUrlInput] = useState("");
  const { signedAccountId, signIn, signNEP413Message } = useNearWallet();
  const [owner, setOwner] = useState<string | null>(null); // HQ_OWNER_ACCOUNT reported by the engine (/setup-status)
  const [registerOn, setRegisterOn] = useState(true);
  const [groq, setGroq] = useState<string[]>(Array(GROQ_SLOTS).fill(""));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(CREDS.filter((c) => c.defaultValue).map((c) => [c.key, c.defaultValue!])),
  );
  const [reveal, setReveal] = useState(false);
  const [connected, setConnected] = useState(false); // engine verified reachable → unlocks the key fields
  const [status, setStatus] = useState<"idle" | "registering" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState("");
  const [showTour, setShowTour] = useState(false);
  const [registered, setRegistered] = useState(false);
  // first visit only: open the tour after mount (deferred a frame — the server can't see localStorage)
  useEffect(() => {
    let id = 0;
    try {
      if (!localStorage.getItem("hq_tour_seen")) {
        id = requestAnimationFrame(() => {
          try {
            localStorage.setItem("hq_tour_seen", "1");
          } catch {
            /* ignore */
          }
          setShowTour(true);
        });
      }
    } catch {
      /* ignore */
    }
    return () => cancelAnimationFrame(id);
  }, []);

  const setGroqAt = (i: number, v: string) => setGroq((g) => g.map((x, j) => (j === i ? v : x)));
  const setVal = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const groqFilled = groq.filter((g) => g.trim()).length;
  const connectReady = engineUrl.trim().length > 0 && !!signedAccountId;
  const ownerMismatch = !!owner && !!signedAccountId && signedAccountId !== owner;
  const credCount = CREDS.filter((c) => (values[c.key] ?? "").trim()).length;

  function buildCreds(): Record<string, string> {
    const creds: Record<string, string> = {};
    const gk = groq.map((g) => g.trim()).filter(Boolean).join(","); // 10 slots → ONE comma-separated string
    if (gk) creds.GROQ_API_KEY = gk;
    for (const c of CREDS) {
      const v = (values[c.key] ?? "").trim();
      if (v) creds[c.key] = v;
    }
    return creds;
  }

  async function onConnect() {
    // step 1 — verify the engine is reachable, then UNLOCK the key fields. Points the dashboard at it now.
    const url = engineUrl.trim().replace(/\/+$/, "");
    if (!url) {
      setStatus("fail");
      setMsg("enter your engine URL first (run agents-LocalReady + tunnel it)");
      return;
    }
    setStatus("registering");
    setMsg("connecting to your engine…");
    if (!(await pingEngine(url))) {
      setStatus("fail");
      setConnected(false);
      setMsg("engine unreachable — is agents-LocalReady running + tunnelled?");
      return;
    }
    setEngineUrl(url); // dashboard now reads YOUR engine
    setConnected(true);
    let on = true;
    try {
      const s = await (await fetch(`${url}/setup-status?cb=${Date.now()}`, { cache: "no-store" })).json();
      on = !!s.register_enabled;
      setOwner(s.owner ?? null);
    } catch {
      setOwner(null);
    }
    setRegisterOn(on);
    setStatus("ok");
    setMsg(on
      ? "✓ connected — your key fields are unlocked below. Already set up? Skip straight to your dashboard."
      : "✓ connected, but register is OFF on this engine — set HQ_OWNER_ACCOUNT=<your>.testnet in its .env and restart");
  }

  async function onRegister() {
    const url = engineUrl.trim().replace(/\/+$/, "");
    if (!connected) {
      setStatus("fail");
      setMsg("connect to your engine first (step 01) to unlock the key fields");
      return;
    }
    if (!signedAccountId) {
      setStatus("fail");
      setMsg("connect your NEAR wallet first — the engine only accepts keys signed by its owner");
      return;
    }
    if (ownerMismatch) {
      setStatus("fail");
      setMsg(`this engine belongs to ${owner} — you are signed in as ${signedAccountId}`);
      return;
    }
    setStatus("registering");
    setMsg("checking your engine…");
    if (!(await pingEngine(url))) {
      setStatus("fail");
      setMsg("engine unreachable — is agents-LocalReady running + tunnelled?");
      return;
    }
    try {
      const n = await fetch(`${url}/register/nonce?cb=${Date.now()}`, { cache: "no-store" });
      const nj = await n.json().catch(() => ({}));
      if (!n.ok || !nj.nonce) {
        setStatus("fail");
        setMsg(nj.error || `could not get a nonce from your engine (HTTP ${n.status})`);
        return;
      }
      const creds = buildCreds();
      setMsg("sign the NEP-413 message in your wallet…");
      let signed;
      try {
        signed = await signNEP413Message({
          message: registerMessage(signedAccountId, await credsSha256(creds)),
          recipient: nj.recipient,
          nonce: b64ToBytes(nj.nonce),
        });
      } catch (e) {
        setStatus("fail");
        setMsg(`signature cancelled or failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      setMsg("verifying your signature on the engine…");
      const r = await fetch(`${url}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: {
            account_id: signed.accountId || signedAccountId,
            public_key: String(signed.publicKey),
            signature: signatureToString(signed.signature),
            nonce: nj.nonce,
          },
          creds,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        setEngineUrl(url); // the dashboard now reads YOUR engine
        setStatus("ok");
        setRegistered(true);
        setMsg(`registered ${j.saved} credentials on your engine — launching your floor…`);
        setTimeout(() => router.push("/app"), 1100);
      } else {
        setStatus("fail");
        setMsg(j.error || `register failed (HTTP ${r.status})`);
      }
    } catch (e) {
      // fetch() rejects with a TypeError on network/CORS failures; anything else is a bug worth showing as-is
      setStatus("fail");
      setMsg(e instanceof TypeError
        ? `could not reach your engine's /register (network or CORS: ${e.message}) — check the URL, that it's running, and that it's up to date`
        : `register failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function onLogin() {
    // already set up: just point the dashboard at your engine (no creds re-submit)
    const url = engineUrl.trim().replace(/\/+$/, "");
    if (!url) {
      setStatus("fail");
      setMsg("enter your engine URL to connect");
      return;
    }
    setStatus("registering");
    setMsg("connecting…");
    if (!(await pingEngine(url))) {
      setStatus("fail");
      setMsg("engine unreachable — is it running + tunnelled?");
      return;
    }
    setEngineUrl(url);
    setStatus("ok");
    setMsg("connected — launching your floor…");
    setTimeout(() => router.push("/app"), 800);
  }

  // each step is judged on its own (Connect only needs the URL, so "wallet" can still be open after it):
  // URL typed · wallet connected · connected · registered. "now" = the first step not done yet.
  const stepDone = [!!engineUrl.trim(), !!signedAccountId, connected, registered];
  const nowStep = stepDone.indexOf(false);
  const STEPS: [string, string][] = [
    ["Run your engine", "Clone agents-LocalReady and start it (docker compose up). It auto-creates a local SQLite for your keys."],
    ["Tunnel + owner", "Expose it with ngrok and set HQ_OWNER_ACCOUNT=<your>.testnet in its .env. Paste the URL and connect that wallet in 01 below."],
    ["Connect", "Hit Connect — the dashboard verifies your engine is reachable and UNLOCKS the key fields below."],
    ["Add keys → register", "Fill Groq + execution keys (now unlocked), Register and sign in your wallet. They save to your engine's SQLite once, then load every restart — no re-entering."],
  ];

  return (
    <BayShell
      ornament="register"
      eyebrow="REGISTER · RUN YOUR OWN FIRM · NO CUSTODY"
      title={["Register your", "engine"]}
      lead={
        <>
          Run <span className="font-mono text-bone">agents-LocalReady</span> on your machine, tunnel it, then submit your keys below. They POST{" "}
          <span className="text-chartreuse">straight to your engine</span> — stored in its local SQLite, never on our servers.
        </>
      }
      aside={
        <div className="fl-cta mt-6 inline-block border-2 border-chartreuse bg-carbon px-4 py-2.5" style={{ boxShadow: "5px 5px 0 rgba(201,242,75,0.45)" }}>
          <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-bone/85">
            <span className="text-chartreuse">⚿ no custody</span> — your keys go from this page directly to YOUR engine (over your own tunnel) and into
            ITS SQLite. We never see or store them.
          </p>
        </div>
      }
      footer="HELIQUANT · REGISTER YOUR ENGINE · your keys, your machine, no custody"
    >
          {/* tour guide — what to do, step by step */}
          <div data-fx="rise" className="fl-card -mt-4 border-2 border-bone/25 bg-carbon p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-chartreuse">▸ how it works · 4 steps</p>
              <button onClick={() => setShowTour(true)} className="fl-cta gr-press border-2 border-chartreuse px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-chartreuse transition-colors hover:bg-chartreuse hover:text-pitch">▸ take the guided tour</button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-2 border-chartreuse/40 bg-pitch p-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-steel">get the engine:</span>
              <a href="https://github.com/ChristianBagas123/HeliQuant/archive/refs/heads/main.zip" className="fl-cta gr-press border-2 border-bone bg-chartreuse px-3.5 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-pitch">⬇ download .zip</a>
              <code className="border border-bone/20 bg-carbon px-2 py-1 font-mono text-[10px] text-bone/70">git clone https://github.com/ChristianBagas123/HeliQuant · cd HeliQuant/agents-LocalReady</code>
              <a href="https://github.com/ChristianBagas123/HeliQuant/tree/main/agents-LocalReady" target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-[0.14em] text-steel hover:text-chartreuse">repo ↗</a>
            </div>
            <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([t, d], i) => {
                const state = stepDone[i] ? "done" : i === nowStep ? "now" : "todo";
                return (
                  <li key={t} className="relative">
                    <div className="flex items-center gap-3">
                      <span className="bay-step grid h-9 w-9 shrink-0 place-items-center border-2 border-bone/30 font-display text-sm font-extrabold text-bone/60" data-state={state}>
                        {state === "done" ? "✓" : i + 1}
                      </span>
                      {i < STEPS.length - 1 && (
                        <span aria-hidden className="relative hidden h-[2px] flex-1 bg-bone/15 lg:block">
                          <span className="bay-step-line absolute inset-0 bg-chartreuse" style={{ transform: `scaleX(${stepDone[i] && stepDone[i + 1] ? 1 : 0})` }} />
                        </span>
                      )}
                    </div>
                    <p className={`mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] ${state === "todo" ? "text-bone/60" : "text-bone"}`}>{t}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-bone/50">{d}</p>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 border-t-2 border-bone/10 pt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-steel">
              ▸ the <span className="text-bone">navbar</span> has the full HeliQuant story — architecture, the desks, the findings — plus the <span className="text-chartreuse">owner&apos;s own live campaign</span> (The grid), running 24/7.
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-steel">
              ▸ prefer cloud over local? you can host the engine on <span className="text-bone">Railway</span> instead of local + ngrok — deploy the <a href="https://github.com/ChristianBagas123/HeliQuant/tree/main/agents" target="_blank" rel="noreferrer" className="text-chartreuse hover:underline">agents/ service</a>, set <span className="text-bone">HQ_OWNER_ACCOUNT</span> to your testnet account, and use that URL above. Local is the recommended path.
            </p>
          </div>

          {/* ── 1 · connect to your engine ── */}
          <div data-tour="ob-engine" data-fx="rise" className="fl-card mt-10 border-2 border-bone/25 bg-carbon" style={connected ? { borderColor: "rgba(201,242,75,0.6)" } : undefined}>
            <div className="flex items-baseline justify-between border-b-2 border-bone/15 px-5 py-3">
              <p className="font-display text-xl font-bold uppercase tracking-wide text-bone">01 · YOUR ENGINE</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-steel">tunnel URL + owner wallet</p>
            </div>
            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-steel">engine URL (ngrok / cloud)</p>
                <input value={engineUrl} onChange={(e) => { setEngineUrlInput(e.target.value); setConnected(false); }} placeholder="https://xxxx.ngrok-free.app" spellCheck={false} autoComplete="off"
                  className="mt-1.5 w-full bay-field border-2 border-bone/25 bg-pitch px-3 py-2 font-mono text-[12px] text-bone placeholder:text-steel/60 focus:border-chartreuse focus:outline-none" />
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-steel">owner wallet (HQ_OWNER_ACCOUNT · NEP-413)</p>
                {signedAccountId ? (
                  <p className={`mt-1.5 border-2 bg-pitch px-3 py-2 font-mono text-[12px] ${ownerMismatch ? "border-signal2 text-signal2" : "border-chartreuse/60 text-chartreuse"}`}>
                    ✓ {signedAccountId}
                    {ownerMismatch && <span className="block text-[10px] uppercase tracking-[0.12em]">engine owner is {owner} — switch wallet</span>}
                  </p>
                ) : (
                  <button onClick={() => signIn()} className="fl-cta gr-press mt-1.5 w-full border-2 border-bone bg-pitch px-3 py-2 text-left font-mono text-[12px] text-bone hover:border-chartreuse hover:text-chartreuse">
                    Connect NEAR wallet →
                  </button>
                )}
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-steel">
                  {owner ? `engine owner: ${owner}` : "must match HQ_OWNER_ACCOUNT on your engine · full-access key"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t-2 border-bone/15 px-5 py-3.5">
              <button onClick={onConnect} disabled={status === "registering"} className={`fl-cta gr-press border-2 px-5 py-2 font-display text-sm font-bold uppercase tracking-wide disabled:opacity-50 ${connected ? "border-chartreuse text-chartreuse" : "border-bone bg-chartreuse text-pitch"}`}>
                {connected ? "✓ connected — reconnect" : "Connect to your engine →"}
              </button>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-steel">
                {connected ? "engine verified · key fields unlocked below" : "verify your engine is reachable to unlock the key fields"}
              </p>
            </div>
          </div>

          {/* ── 2 · Groq keys (ten slots → one comma-string) ── */}
          <div data-tour="ob-groq" data-fx="rise" className="fl-card mt-7 border-2 border-bone/25 bg-carbon">
            <div className="flex items-baseline justify-between border-b-2 border-bone/15 px-5 py-3">
              <p className="font-display text-xl font-bold uppercase tracking-wide text-bone">02 · THE BRAIN · GROQ KEYS</p>
              <div className="flex items-center gap-3">
                <span aria-hidden className="hidden items-end gap-[3px] sm:flex">
                  {groq.map((g, i) => (
                    <span key={i} className="bay-seg h-3 w-2 bg-bone/15" data-on={g.trim() ? "" : undefined} />
                  ))}
                </span>
                <p className={`font-mono text-[10px] uppercase tracking-[0.18em] ${!connected ? "text-steel/70" : groqFilled >= GROQ_SLOTS ? "text-chartreuse" : "text-steel"}`}>{connected ? `${groqFilled}/${GROQ_SLOTS} filled · min 10` : "🔒 connect engine first"}</p>
              </div>
            </div>
            <div className="bay-lock" data-open={connected ? "" : undefined}>
            <Veil />
            <div className={`px-5 py-4 ${connected ? "" : "pointer-events-none select-none opacity-40"}`} aria-hidden={!connected || undefined}>
              <p className="mb-3 text-[11px] leading-relaxed text-bone/45">
                The desks rotate across many free Groq keys to dodge rate limits — paste <span className="text-bone">ten</span>{" "}
                (<span className="font-mono text-bone">console.groq.com</span>, free). They&apos;re joined into one comma-separated string on submit.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {groq.map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={`grid h-6 w-7 shrink-0 place-items-center border font-mono text-[10px] font-bold ${g.trim() ? "border-chartreuse text-chartreuse" : "border-bone/25 text-steel"}`}>{i + 1}</span>
                    <input value={g} onChange={(e) => setGroqAt(i, e.target.value)} type={reveal ? "text" : "password"} placeholder={`gsk_… #${i + 1}`} spellCheck={false} autoComplete="off"
                      className="w-full bay-field border-2 border-bone/25 bg-pitch px-3 py-1.5 font-mono text-[12px] text-bone placeholder:text-steel/50 focus:border-chartreuse focus:outline-none" />
                  </div>
                ))}
              </div>
            </div>
            </div>
          </div>

          {/* ── 3 · the rest of the credentials ── */}
          <div className="mt-7 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">03 · GUARDS · FUEL — {connected ? `${credCount} set` : "🔒 connect engine first"}</p>
            <button onClick={() => setReveal((r) => !r)} disabled={!connected} className="border border-bone/30 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-bone/70 hover:border-chartreuse hover:text-chartreuse disabled:opacity-40">{reveal ? "mask" : "reveal"}</button>
          </div>
          <div className="bay-lock mt-3" data-open={connected ? "" : undefined}>
          <Veil />
          <div data-tour="ob-creds" className={`space-y-6 ${connected ? "" : "pointer-events-none select-none opacity-40"}`} aria-hidden={!connected || undefined}>
            {GROUPS.map((grp) => (
              <div key={grp.id} className="fl-card border-2 border-bone/25 bg-carbon">
                <div className="flex items-baseline justify-between border-b-2 border-bone/15 px-5 py-2.5">
                  <p className="font-display text-lg font-bold uppercase tracking-wide text-bone">{grp.title}</p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-steel">{grp.sub}</p>
                </div>
                <div className="divide-y divide-bone/10">
                  {CREDS.filter((c) => c.group === grp.id).map((c) => (
                    <div key={c.key} className="bay-row grid gap-2 px-5 py-3.5 sm:grid-cols-[210px_1fr]">
                      <div>
                        <p className="flex items-center gap-2">
                          <span className={`inline-block h-2.5 w-2.5 ${(values[c.key] ?? "").trim() ? "bg-chartreuse" : "border border-bone/30 bg-pitch"}`} />
                          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-bone/85">{c.label}</span>
                        </p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-steel">{c.key}</p>
                      </div>
                      <div>
                        <input value={values[c.key] ?? ""} onChange={(e) => setVal(c.key, e.target.value)} type={c.secret && !reveal ? "password" : "text"} placeholder={c.placeholder} spellCheck={false} autoComplete="off"
                          className="w-full bay-field border-2 border-bone/25 bg-pitch px-3 py-2 font-mono text-[12px] text-bone placeholder:text-steel/60 focus:border-chartreuse focus:outline-none" />
                        <p className="mt-1.5 text-[11px] leading-relaxed text-bone/45">{c.why}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          </div>

          {/* ── launch row ── */}
          <div data-tour="ob-register" data-fx="rise" className="fl-card mt-8 flex flex-col gap-4 border-2 border-chartreuse bg-carbon p-5 sm:flex-row sm:items-center sm:justify-between" style={{ boxShadow: "6px 6px 0 rgba(201,242,75,0.4)" }}>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-steel">{!connected ? "connect your engine first (step 01) to unlock" : !registerOn ? "register is off on this engine — set HQ_OWNER_ACCOUNT" : !signedAccountId ? "connect your owner wallet (step 01) to sign" : groqFilled >= GROQ_SLOTS ? "ready to register · you will sign once in your wallet" : `need: 10 groq keys (${groqFilled} so far)`}</p>
              {msg && <p className={`mt-1 font-mono text-[12px] ${status === "ok" ? "text-chartreuse" : status === "fail" ? "text-signal2" : "text-bone/70"}`}>{msg}</p>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onLogin} disabled={status === "registering" || !connected} title="keys already saved in your engine's SQLite — just open the dashboard" className="gr-press border-2 border-bone/60 px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-bone/85 hover:border-chartreuse hover:text-chartreuse disabled:opacity-50">
                Already configured → dashboard
              </button>
              <button onClick={onRegister} disabled={status === "registering" || !connected || !registerOn || ownerMismatch || groqFilled < GROQ_SLOTS || !connectReady} className="fl-cta gr-press border-2 border-bone bg-chartreuse px-6 py-2.5 font-display text-base font-bold uppercase tracking-wide text-pitch disabled:opacity-40" style={{ boxShadow: "3px 3px 0 rgba(242,239,230,0.9)" }}>
                {status === "registering" ? "registering…" : "Register your engine"}
              </button>
            </div>
          </div>
      {showTour && <Tour steps={TOUR} onClose={() => setShowTour(false)} />}
    </BayShell>
  );
}

/** the veil over a locked section — lifts (and the shackle opens) once the engine is connected */
function Veil() {
  return (
    <div className="bay-lock-veil" aria-hidden>
      <div className="text-center">
        <svg viewBox="0 0 40 44" className="mx-auto h-10 w-10 text-chartreuse" aria-hidden>
          <path className="bay-lock-icon" d="M11 20 V13 a9 9 0 0 1 18 0 V20" fill="none" stroke="currentColor" strokeWidth="3" />
          <rect x="6" y="20" width="28" height="22" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="20" cy="30" r="3" fill="currentColor" />
        </svg>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/80">connect your engine (01) to unlock</p>
      </div>
    </div>
  );
}
