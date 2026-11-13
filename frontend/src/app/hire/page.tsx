"use client";

/**
 * /hire — HeliQuant's on-chain trading PRODUCT: "hire the firm".
 *
 * A client deposits mUSDC into the core contract's escrow with ONE `ft_transfer_call` (no approve step on NEAR); the
 * firm runs its gated decision loop and, on NEAR today, most often ABSTAINS (capital preserved — that restraint IS
 * the product). When the job matures anyone may settle it on-chain; profit splits by performance fee, losses are the
 * client's. A payout left in the contract can be pulled with `claim_payout`.
 *
 * Stack: Next 16 · React 19 · near-connect-hooks · motion/react. Strict TS, no `any`.
 * Reads go straight to the RPC (src/lib/near.ts), so they work before login. A hire that the contract rejects still
 * "succeeds" as a transaction (the amount is refunded and `job_rejected` is emitted), so the result is read from the
 * events — see src/lib/hire-logic.ts.
 *
 * Look: the bay shell (vault-door ornament), a stat strip, the four-step job rail, the live radial engine, then the
 * faucet + hire desk (quick-amount chips, a sliding term selector, the payout formula) and the job cards with a
 * maturity bar. Panels reveal on scroll and light up under the cursor.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { Actions, useNearWallet } from "near-connect-hooks";

import AgentMarketCta from "@/components/garage/AgentMarketCta";
import BayShell from "@/components/garage/bay/BayShell";
import { SectionHead, Stat, StatStrip } from "@/components/garage/bay/parts";
import { CountUp } from "@/components/garage/FloorMotion";
import RadialEngine from "@/components/garage/RadialEngine";
import {
  BASE_DECIMALS,
  DEFAULT_PERF_FEE_BPS,
  DURATION_PRESETS,
  FIRM_TOKEN_ID,
  METHODS,
  missingEnv,
  NEAR_BASE_TOKEN,
  NEAR_CORE,
  NEAR_TOKEN,
  nearblocksAccount,
  nearblocksTx,
  PRINCIPAL_DECIMALS,
  type JobView,
} from "@/lib/contracts";
import {
  classifyWalletError,
  fromUnits,
  GAS_CLAIM,
  GAS_CREATE_JOB,
  GAS_SETTLE_JOB,
  GAS_SIMPLE,
  hasFailure,
  interpretHire,
  maturity,
  minOutFromQuote,
  ONE_YOCTO,
  rejectionText,
  STORAGE_DEPOSIT,
  toUnits,
  txHashOf,
} from "@/lib/hire-logic";
import { claimableOf, defaultPoolId, dexReturn, jobsByClient, tokenBalance, tokenRegistered } from "@/lib/near";

const ZERO = BigInt(0); // ES2017 target → no 0n literal
const FEE_PCT = DEFAULT_PERF_FEE_BPS / 100;
const v = (o: Record<string, string | number>) => o as React.CSSProperties;

// ───────────────────────────── tiny formatting helpers (locale-stable, never throw) ─────────────────────────────
function fmtUnits(value: bigint | undefined, decimals: number, maxFrac = 2): string {
  if (value === undefined) return "—";
  try {
    const n = Number(fromUnits(value, decimals));
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: maxFrac });
  } catch {
    return "—";
  }
}
function truncHash(h: string, head = 6, tail = 4): string {
  if (!h) return "";
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

// a shared 1-second clock so countdowns tick without each panel owning a timer
function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

// ───────────────────────────── garage panel pieces ─────────────────────────────
function Panel({ children, className = "", i = 0, tilt = false, accent = false }: { children: React.ReactNode; className?: string; i?: number; tilt?: boolean; accent?: boolean }) {
  return (
    <div
      data-fx="rise"
      data-tilt={tilt ? "" : undefined}
      className={`fl-card ${tilt ? "fl-tilt" : ""} relative border-2 bg-carbon ${accent ? "border-chartreuse" : "border-bone/20"} ${className}`}
      style={v({ "--i": i, ...(accent ? { boxShadow: "6px 6px 0 rgba(201,242,75,0.4)" } : {}) })}
    >
      {children}
    </div>
  );
}

function PanelHeader({ kicker, title, right }: { kicker: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-bone/10 px-5 py-4">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-steel">{kicker}</p>
        <p className="mt-1 font-display text-xl font-extrabold uppercase tracking-wide text-bone">{title}</p>
      </div>
      {right}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-steel">{children}</span>;
}

type Tone = "good" | "bad" | "wait" | "idle";
const TONE_TXT: Record<Tone, string> = { good: "text-chartreuse", bad: "text-signal2", wait: "text-bone", idle: "text-steel" };

// status pill: a lamp + text
function StatusPill({ tone, label, pulse }: { tone: Tone; label: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 border border-bone/20 bg-pitch px-2.5 py-1">
      <span className="bay-lamp !h-2 !w-2" data-on={tone === "good" ? "go" : tone === "bad" ? "wait" : pulse ? "go" : undefined} />
      <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.2em] ${TONE_TXT[tone]}`}>{label}</span>
    </span>
  );
}

// ───────────────────────────── primary (chartreuse) + ghost buttons ─────────────────────────────
type BtnState = "idle" | "disabled" | "pending";

function PrimaryButton({ children, onClick, state = "idle", type = "button" }: { children: React.ReactNode; onClick?: () => void; state?: BtnState; type?: "button" | "submit" }) {
  const disabled = state !== "idle";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-busy={state === "pending"}
      className="fl-cta gr-press group relative inline-flex w-full items-center justify-center gap-2.5 overflow-hidden border-2 border-bone bg-chartreuse px-6 py-3 font-display text-base font-bold uppercase tracking-wide text-pitch disabled:cursor-not-allowed disabled:border-bone/30 disabled:bg-chartreuse/20 disabled:text-bone/50 disabled:shadow-none"
    >
      {state === "pending" ? <Spinner /> : null}
      {children}
      {state === "idle" ? <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">▸</span> : null}
    </button>
  );
}

function GhostButton({ children, onClick, state = "idle" }: { children: React.ReactNode; onClick?: () => void; state?: BtnState }) {
  const disabled = state !== "idle";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={state === "pending"}
      className="gr-press inline-flex w-full items-center justify-center gap-2 border-2 border-bone/40 px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-bone transition-colors enabled:hover:border-chartreuse enabled:hover:text-chartreuse disabled:cursor-not-allowed disabled:opacity-45"
    >
      {state === "pending" ? <Spinner muted /> : null}
      {children}
    </button>
  );
}

function Spinner({ muted }: { muted?: boolean }) {
  return <span aria-hidden className={`inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${muted ? "text-bone" : "text-pitch"}`} />;
}

// ───────────────────────────── tx status line (idle/pending/confirming/success/error) ─────────────────────────────
type TxPhase = "idle" | "signing" | "confirming" | "success" | "error";

function TxStatus({ phase, hash, error, label }: { phase: TxPhase; hash?: string; error?: string; label?: string }) {
  if (phase === "idle") return null;
  const tone: Tone = phase === "success" ? "good" : phase === "error" ? "bad" : "wait";
  const text =
    phase === "signing"
      ? `${label ?? "Transaction"} — confirm in wallet…`
      : phase === "confirming"
        ? `${label ?? "Transaction"} — confirming on NEAR…`
        : phase === "success"
          ? `${label ?? "Transaction"} confirmed`
          : (error ?? "Transaction failed");
  return (
    <div className="hire-pop mt-3 flex items-start gap-2.5 border-l-2 border-bone/20 bg-pitch px-3 py-2" role="status" aria-live="polite">
      <span className="bay-lamp mt-[3px] !h-2 !w-2 shrink-0" data-on={tone === "good" ? "go" : tone === "bad" ? "wait" : "go"} />
      <div className="min-w-0">
        <p className={`font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] ${TONE_TXT[tone]}`}>{text}</p>
        {hash ? (
          <a href={nearblocksTx(hash)} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.16em] text-steel transition-colors hover:text-chartreuse">
            {truncHash(hash, 10, 8)} <span aria-hidden>↗</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════ TX RUNNER (wallet → outcome → phase) ═══════════════════════════════════════════
type TxState = { phase: TxPhase; hash?: string; error?: string; note?: string };

/**
 * Runs one wallet request and maps it to idle/signing/success/error. A cancelled or closed popup is a normal outcome:
 * the button is re-enabled and a calm note is shown. A failed receipt is an error, never a success.
 */
function useTx() {
  const [state, setState] = useState<TxState>({ phase: "idle" });
  const busy = state.phase === "signing" || state.phase === "confirming";

  const reset = () => setState({ phase: "idle" });

  async function run(fn: () => Promise<unknown>): Promise<unknown | undefined> {
    setState({ phase: "signing" });
    try {
      const outcome = await fn();
      const hash = txHashOf(outcome);
      if (hasFailure(outcome)) {
        setState({ phase: "error", hash, error: "The transaction failed on chain." });
        return undefined;
      }
      setState({ phase: "success", hash });
      return outcome;
    } catch (e) {
      const c = classifyWalletError(e);
      if (c.kind === "other") setState({ phase: "error", error: c.message });
      else setState({ phase: "idle", note: c.message });
      return undefined;
    }
  }

  return { state, busy, run, reset, setState };
}

function Note({ children, tone = "mute" }: { children: React.ReactNode; tone?: "mute" | "bad" | "good" }) {
  const c = tone === "bad" ? "text-signal2" : tone === "good" ? "text-chartreuse" : "text-steel";
  return (
    <p className={`hire-pop mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] ${c}`} role="status" aria-live="polite">
      {children}
    </p>
  );
}

/** Poll a read-only async function; never throws into render. */
function usePoll<T>(fn: () => Promise<T>, deps: unknown[], everyMs = 12_000): { data: T | undefined; error: boolean; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const v = await fn();
        if (alive) {
          setData(v);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const id = window.setInterval(load, everyMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, everyMs]);
  return { data, error, loading, refetch: () => setTick((t) => t + 1) };
}

/** a big balance figure that rolls when it changes */
function Figure({ value, unit, size = "lg", tone = "text-bone" }: { value: string; unit: string; size?: "lg" | "md"; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`font-display font-extrabold leading-none tabular-nums ${size === "lg" ? "text-5xl" : "text-3xl"} ${tone}`}>
        {/\d/.test(value) ? <CountUp value={value} /> : value}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel">{unit}</span>
    </div>
  );
}

// ═══════════════════════════════════════════ FAUCET ═══════════════════════════════════════════
function FaucetPanel({ account, onMinted }: { account: string; onMinted: () => void }) {
  const near = useNearWallet();
  const bal = usePoll(() => tokenBalance(account), [account]);
  const reg = usePoll(() => tokenRegistered(account), [account]);
  const tx = useTx();

  async function mint() {
    const registered = reg.data === true;
    const actions = [
      ...(registered
        ? []
        : [Actions.functionCall(METHODS.tokenStorageDeposit, { account_id: account, registration_only: true }, GAS_SIMPLE, STORAGE_DEPOSIT)]),
      Actions.functionCall(METHODS.tokenMint, { account_id: account, amount: toUnits("1000", PRINCIPAL_DECIMALS)!.toString() }, GAS_SIMPLE, "0"),
    ];
    const out = await tx.run(() => near.signAndSendTransaction({ receiverId: NEAR_TOKEN, actions }));
    if (out) {
      bal.refetch();
      reg.refetch();
      onMinted();
    }
  }

  return (
    <Panel i={0} tilt>
      <PanelHeader
        kicker="STEP 1 · TESTNET FUEL"
        title="Get test capital"
        right={
          <a href={nearblocksAccount(NEAR_TOKEN)} target="_blank" rel="noreferrer" className="font-mono text-[9px] uppercase tracking-[0.16em] text-steel transition-colors hover:text-chartreuse">
            token ↗
          </a>
        }
      />
      <div className="p-5">
        <Label>Your mUSDC balance</Label>
        <div className="mt-2">
          <Figure value={bal.loading ? "···" : bal.data === undefined ? "—" : fmtUnits(bal.data, PRINCIPAL_DECIMALS)} unit="mUSDC" />
        </div>
        {/* fuel gauge: the balance against one faucet drop (1,000) */}
        <div className="mt-4 h-2 overflow-hidden border border-bone/15 bg-pitch">
          <span
            className="block h-full bg-chartreuse transition-[width] duration-700"
            style={{ width: `${bal.data === undefined ? 0 : Math.min(100, Number(fromUnits(bal.data, PRINCIPAL_DECIMALS)) / 10)}%`, boxShadow: "0 0 12px rgba(201,242,75,0.6)" }}
          />
        </div>
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-bone/40">gauge · one faucet drop = 1,000 mUSDC</p>

        <div className="mt-5 sm:max-w-[300px]">
          <GhostButton onClick={mint} state={tx.busy ? "pending" : "idle"}>
            {reg.data === false ? "Register + get 1,000 test USDC" : "⛽ Get 1,000 test USDC"}
          </GhostButton>
        </div>
        <TxStatus phase={tx.state.phase} hash={tx.state.hash} error={tx.state.error} label="Faucet mint" />
        {tx.state.note ? <Note>{tx.state.note}</Note> : null}
        {reg.data === false ? <Note>First time: the token needs a one-time storage deposit (0.00125 NEAR) before it can hold your balance.</Note> : null}
        <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-bone/40">mock USDC on NEAR testnet · public faucet · no real value</p>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════ HIRE ═══════════════════════════════════════════
function HirePanel({ account, onHired }: { account: string; onHired: () => void }) {
  const near = useNearWallet();
  const [amount, setAmount] = useState("100");
  const [durationSec, setDurationSec] = useState<number>(DURATION_PRESETS[0]!.seconds);
  const parsedAmount = useMemo(() => toUnits(amount, PRINCIPAL_DECIMALS), [amount]);
  const balance = usePoll(() => tokenBalance(account), [account]);
  const tx = useTx();
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const insufficient = parsedAmount !== null && balance.data !== undefined && parsedAmount > balance.data;

  async function hire() {
    if (parsedAmount === null) return;
    setResult(null);
    tx.reset();
    let before: number | null = null;
    try {
      before = (await jobsByClient(account, 100)).length;
    } catch {
      before = null;
    }
    const msg = JSON.stringify({
      firm_token_id: FIRM_TOKEN_ID,
      base_token: NEAR_BASE_TOKEN,
      duration_sec: durationSec,
      perf_fee_bps: DEFAULT_PERF_FEE_BPS,
    });
    const outcome = await tx.run(() =>
      near.callFunctionRaw({
        contractId: NEAR_TOKEN,
        method: METHODS.tokenTransferCall,
        args: { receiver_id: NEAR_CORE, amount: parsedAmount.toString(), msg },
        gas: GAS_CREATE_JOB,
        deposit: ONE_YOCTO,
      }),
    );
    if (!outcome) return;

    // A "successful" transfer can still mean NO job: the core refunds everything and emits `job_rejected`.
    const res = interpretHire(outcome);
    if (res.kind === "rejected") {
      tx.setState({ phase: "error", hash: txHashOf(outcome), error: rejectionText(res.reason) });
      setResult({ tone: "bad", text: rejectionText(res.reason) });
    } else if (res.kind === "created") {
      setResult({ tone: "good", text: `Job #${res.jobId} created. Your mUSDC is escrowed.` });
      onHired();
    } else {
      // no event seen: confirm by comparing the job list before and after
      await new Promise((r) => window.setTimeout(r, 2500));
      let after: number | null = null;
      try {
        after = (await jobsByClient(account, 100)).length;
      } catch {
        after = null;
      }
      if (before !== null && after !== null && after > before) {
        setResult({ tone: "good", text: "Job created. Your mUSDC is escrowed." });
        onHired();
      } else {
        tx.setState({ phase: "error", hash: txHashOf(outcome), error: "No job was created — your mUSDC should be back in your balance." });
        setResult({ tone: "bad", text: "No job was created — check your balance and try again." });
      }
    }
    balance.refetch();
  }

  const btnState: BtnState = tx.busy ? "pending" : parsedAmount === null || insufficient ? "disabled" : "idle";
  const maxStr = balance.data === undefined ? null : fromUnits(balance.data, PRINCIPAL_DECIMALS);
  const quick: [string, string | null][] = [
    ["100", "100"],
    ["250", "250"],
    ["500", "500"],
    ["MAX", maxStr],
  ];
  const shownAmount = parsedAmount === null ? "P" : `${fmtUnits(parsedAmount, PRINCIPAL_DECIMALS)}`;

  return (
    <Panel i={1} accent>
      <PanelHeader kicker="STEP 2 · ESCROW JOB" title="Hire HeliQuant" right={<StatusPill tone="wait" label="1 tx" />} />
      <div className="p-5">
        {/* amount */}
        <div className="flex items-center justify-between">
          <Label>Principal</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-bone/40">balance {balance.data === undefined ? "—" : fmtUnits(balance.data, PRINCIPAL_DECIMALS)}</span>
        </div>
        <div className={`bay-field mt-2 flex border-2 bg-pitch ${insufficient ? "border-signal2/70" : "border-bone/25"}`}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="100"
            aria-label="Principal amount in mUSDC"
            className="min-w-0 flex-1 bg-transparent px-4 py-3 font-display text-2xl font-extrabold tracking-wide text-bone outline-none placeholder:text-bone/25"
          />
          <span className="grid place-items-center border-l border-bone/15 px-4 font-mono text-[11px] uppercase tracking-[0.16em] text-steel">mUSDC</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {quick.map(([label, val]) => (
            <button
              key={label}
              type="button"
              disabled={val === null}
              onClick={() => val !== null && setAmount(val)}
              className="bay-chip disabled:opacity-40"
              data-on={val !== null && amount === val ? "" : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        {insufficient ? <p className="hire-pop mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-signal2">Exceeds balance — get more from the faucet.</p> : null}

        {/* term — a sliding selector */}
        <div className="mt-6">
          <Label>Term</Label>
          <div className="relative mt-2 grid grid-cols-3 border-2 border-bone/20 bg-pitch p-1">
            {DURATION_PRESETS.map((d) => {
              const active = d.seconds === durationSec;
              return (
                <button
                  key={d.seconds}
                  type="button"
                  onClick={() => setDurationSec(d.seconds)}
                  aria-pressed={active}
                  className={`relative px-2 py-2.5 text-center font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${active ? "text-pitch" : "text-bone/60 hover:text-chartreuse"}`}
                >
                  {active && <motion.span layoutId="hire-term" className="absolute inset-0 bg-chartreuse" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <span className="relative font-bold">{d.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* the payout formula — no forecast, just the rule the contract applies */}
        <div className="mt-6 border-2 border-bone/15 bg-pitch">
          <div className="flex items-center justify-between border-b border-bone/10 px-4 py-3">
            <div>
              <Label>Performance fee</Label>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-bone/40">on positive PnL only · losses are yours</p>
            </div>
            <span className="font-display text-3xl font-extrabold text-chartreuse">{FEE_PCT}%</span>
          </div>
          <div className="space-y-1.5 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-bone/70">
            <p className="flex justify-between gap-3">
              <span className="text-steel">profit</span>
              <span>
                {shownAmount} + PnL − {FEE_PCT}% × PnL
              </span>
            </p>
            <p className="flex justify-between gap-3">
              <span className="text-steel">flat / loss</span>
              <span>{shownAmount} + PnL · no fee</span>
            </p>
          </div>
        </div>

        {/* one transaction: ft_transfer_call (no approve step on NEAR) */}
        <div className="mt-6">
          <PrimaryButton onClick={hire} state={btnState}>
            {tx.busy ? "Hiring…" : "Hire the firm"}
          </PrimaryButton>
          <TxStatus phase={tx.state.phase} hash={tx.state.hash} error={tx.state.error} label="Hire HeliQuant" />
          {tx.state.note ? <Note>{tx.state.note}</Note> : null}
          {result ? <Note tone={result.tone}>{result.text}</Note> : null}
        </div>

        {/* honest expectation-setting */}
        <p className="bay-note mt-5 bg-pitch px-4 py-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-bone/70">
          The firm escrows your funds and runs its gated decision loop. On NEAR today it most often{" "}
          <span className="text-bone">abstains — capital preserved</span>: the edge lab found no validated edge for NEAR. That discipline is the product, not a bug.
        </p>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════ DASHBOARD ═══════════════════════════════════════════
function Dashboard({ account, refreshKey }: { account: string; refreshKey: number }) {
  const jobs = usePoll(() => jobsByClient(account, 100), [account, refreshKey], 15_000);
  const claim = usePoll(() => claimableOf(account, NEAR_TOKEN), [account, refreshKey], 15_000);
  const list = jobs.data ?? [];

  return (
    <div>
      <SectionHead
        n="04"
        title="Your jobs"
        sub="escrowed on the core contract · settled on-chain"
        right={<StatusPill tone={jobs.error && !jobs.data ? "bad" : "idle"} label={jobs.error && !jobs.data ? "feed error" : `${list.length} on record`} />}
      />

      {claim.data !== undefined && claim.data > ZERO ? (
        <ClaimBar
          account={account}
          amount={claim.data}
          onClaimed={() => {
            claim.refetch();
            jobs.refetch();
          }}
        />
      ) : null}

      {jobs.error && !jobs.data ? (
        <Panel>
          <div className="px-5 py-8">
            <StatusPill tone="bad" label="unreachable" />
            <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-steel">Could not read jobs from the core contract. Check your connection to NEAR testnet.</p>
          </div>
        </Panel>
      ) : jobs.loading ? (
        <Panel>
          <div className="flex items-center gap-3 px-5 py-8" aria-busy="true">
            <Spinner muted />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-steel">reading escrow…</span>
          </div>
        </Panel>
      ) : list.length === 0 ? (
        <EmptyJobs />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {list.map((job, i) => (
            <JobCard key={job.job_id} job={job} index={i} onChanged={() => jobs.refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Payout left in the contract (a failed transfer returns it to `claimable`): one button to pull it. */
function ClaimBar({ account, amount, onClaimed }: { account: string; amount: bigint; onClaimed: () => void }) {
  const near = useNearWallet();
  const tx = useTx();
  async function claim() {
    const out = await tx.run(() => near.callFunctionRaw({ contractId: NEAR_CORE, method: METHODS.claimPayout, args: { token: NEAR_TOKEN }, gas: GAS_CLAIM }));
    if (out) onClaimed();
  }
  return (
    <div className="mb-6">
      <Panel accent>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <Label>Claimable payout · {account}</Label>
            <div className="mt-2">
              <Figure value={fmtUnits(amount, PRINCIPAL_DECIMALS, 4)} unit="mUSDC" size="md" tone="text-chartreuse" />
            </div>
          </div>
          <div className="w-full sm:w-[240px]">
            <PrimaryButton onClick={claim} state={tx.busy ? "pending" : "idle"}>
              {tx.busy ? "Claiming…" : "Claim payout"}
            </PrimaryButton>
          </div>
        </div>
        <div className="px-5 pb-4">
          <TxStatus phase={tx.state.phase} hash={tx.state.hash} error={tx.state.error} label="Claim payout" />
          {tx.state.note ? <Note>{tx.state.note}</Note> : null}
        </div>
      </Panel>
    </div>
  );
}

function EmptyJobs() {
  return (
    <Panel>
      <div className="group flex flex-col items-center px-6 py-14 text-center">
        {/* the vault, door ajar on hover */}
        <svg viewBox="0 0 64 64" className="h-14 w-14 text-steel transition-colors group-hover:text-chartreuse" fill="none" aria-hidden>
          <rect x="6" y="10" width="52" height="42" stroke="currentColor" strokeWidth="2.5" />
          <g className="origin-center transition-transform duration-700 group-hover:rotate-90" style={{ transformBox: "fill-box" }}>
            <circle cx="32" cy="31" r="11" stroke="currentColor" strokeWidth="2.5" />
            <line x1="32" y1="20" x2="32" y2="42" stroke="currentColor" strokeWidth="2.5" />
            <line x1="21" y1="31" x2="43" y2="31" stroke="currentColor" strokeWidth="2.5" />
          </g>
          <line x1="12" y1="56" x2="18" y2="56" stroke="currentColor" strokeWidth="3" />
          <line x1="46" y1="56" x2="52" y2="56" stroke="currentColor" strokeWidth="3" />
        </svg>
        <p className="mt-5 font-display text-xl font-extrabold uppercase tracking-wide text-bone">No jobs yet</p>
        <p className="mt-2 max-w-sm font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-steel">
          Get test USDC, then hire the firm above. Your escrowed jobs — and every gated decision — appear here.
        </p>
      </div>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-t border-bone/10 py-2">
      <Label>{label}</Label>
      <span className="font-mono text-[12px] tracking-[0.06em] text-bone">{children}</span>
    </div>
  );
}

function JobCard({ job, index, onChanged }: { job: JobView; index: number; onChanged: () => void }) {
  const near = useNearWallet();
  const now = useNowSeconds();
  const tx = useTx();
  const [msg, setMsg] = useState<{ tone: "good" | "bad" | "mute"; text: string } | null>(null);

  const principalIn = BigInt(job.principal_in);
  const principal = BigInt(job.principal);
  const baseBalance = BigInt(job.base_balance);
  const finalPrincipal = BigInt(job.final_principal);
  const finalPnL = BigInt(job.final_pnl);
  const settled = job.status === "Settled";
  const settlingState = job.status === "Settling";
  const { matured, text: maturityText } = maturity(BigInt(job.end_ns), now);

  // the term as a bar: start → maturity
  const startS = Number(BigInt(job.start_ns) / BigInt(1_000_000_000));
  const endS = Number(BigInt(job.end_ns) / BigInt(1_000_000_000));
  const progress = settled || matured ? 1 : endS > startS ? Math.min(1, Math.max(0, (now - startS) / (endS - startS))) : 0;

  const stateTone: Tone = settled ? "good" : "wait";
  const stateLabel = settled ? "settled" : settlingState ? "settling" : "active";
  const pnlCls = !settled ? "text-bone" : finalPnL > ZERO ? "text-chartreuse" : finalPnL < ZERO ? "text-signal2" : "text-steel";

  async function settle() {
    setMsg(null);
    tx.reset();
    // min_out from Rhea get_return with 1% tolerance (only needed when the job still holds base token)
    let minOut: bigint | undefined;
    if (baseBalance > ZERO) {
      const pool = defaultPoolId();
      if (pool === undefined) {
        setMsg({ tone: "bad", text: "DEX pool is not configured (NEXT_PUBLIC_NEAR_DEX_POOL_ID)." });
        return;
      }
      try {
        minOut = minOutFromQuote(await dexReturn(pool, job.base_token, baseBalance, job.principal_token));
      } catch {
        setMsg({ tone: "bad", text: "Could not get a price quote from the DEX. Try again in a moment." });
        return;
      }
    }
    const args: Record<string, unknown> = { job_id: job.job_id };
    if (minOut !== undefined) args.min_out = minOut.toString();
    const out = await tx.run(() => near.callFunctionRaw({ contractId: NEAR_CORE, method: METHODS.settleJob, args, gas: GAS_SETTLE_JOB }));
    if (!out) return;
    // settle is multi-step: give the callbacks a moment, then re-read the job
    await new Promise((r) => window.setTimeout(r, 4000));
    try {
      const fresh = (await jobsByClient(job.client, 100)).find((j) => j.job_id === job.job_id);
      if (fresh && fresh.status === "Active") {
        setMsg({ tone: "bad", text: "The sale of the base token failed (price moved?). The job is Active again — settle again." });
      } else if (fresh && fresh.status === "Settling") {
        setMsg({ tone: "mute", text: "Settlement is still finishing on chain. Refresh in a few seconds." });
      }
    } catch {
      /* the list refetch below shows the truth */
    }
    onChanged();
  }

  const settling = tx.busy;
  const canSettle = job.status === "Active" && matured && !job.locked && !settling;

  return (
    <Panel i={index} tilt accent={canSettle}>
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="bay-outline absolute -bottom-5 right-3 font-display text-[6rem] font-extrabold leading-none opacity-50">#{job.job_id}</span>
      </span>
      {/* header: id · firm · state */}
      <div className="relative flex items-center justify-between border-b border-bone/10 px-5 py-4">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-xl font-extrabold uppercase tracking-wide text-bone">Job #{job.job_id}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-steel">HeliQuant</span>
        </div>
        <StatusPill tone={stateTone} label={stateLabel} pulse={!settled} />
      </div>

      <div className="relative px-5 py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Label>{settled ? "Final principal" : "Principal escrowed"}</Label>
            <div className="mt-2">
              <Figure value={fmtUnits(settled ? finalPrincipal : principal, PRINCIPAL_DECIMALS)} unit="mUSDC" size="md" />
            </div>
          </div>
          <div className="text-right">
            <Label>{settled ? "Status" : matured ? "Maturity" : "Matures in"}</Label>
            <p className={`mt-2 font-mono text-[14px] font-bold uppercase tracking-[0.08em] tabular-nums ${settled || matured ? "text-chartreuse" : "text-bone"}`}>{settled ? "Closed" : maturityText}</p>
          </div>
        </div>

        {/* maturity bar */}
        <div className="mt-4">
          <div className="relative h-2 border border-bone/15 bg-pitch">
            <span className="absolute inset-y-0 left-0 bg-chartreuse transition-[width] duration-1000 ease-linear" style={{ width: `${(progress * 100).toFixed(2)}%`, boxShadow: "0 0 10px rgba(201,242,75,0.6)" }} />
            {!settled && !matured && <span className="hire-tip absolute -top-[3px] h-3 w-[3px] bg-bone" style={{ left: `calc(${(progress * 100).toFixed(2)}% - 1px)` }} />}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.16em] text-bone/40">
            <span>escrowed</span>
            <span>{Math.round(progress * 100)}% of term</span>
            <span>matures</span>
          </div>
        </div>

        <div className="mt-4">
          <Row label="Deposit">{fmtUnits(principalIn, PRINCIPAL_DECIMALS)} mUSDC</Row>
          <Row label="Base (wNEAR)">{fmtUnits(baseBalance, BASE_DECIMALS, 4)}</Row>
          <Row label="Perf fee">{job.perf_fee_bps / 100}%</Row>
          {job.locked ? <Row label="Vault">Locked (swap in flight)</Row> : null}
          {settled ? (
            <div className="flex items-center justify-between border-t border-bone/10 py-2">
              <Label>Realized PnL</Label>
              <span className={`font-mono text-[13px] font-bold tracking-[0.04em] ${pnlCls}`}>
                {finalPnL > ZERO ? "+" : ""}
                {fmtUnits(finalPnL < ZERO ? -finalPnL : finalPnL, PRINCIPAL_DECIMALS)}
                {finalPnL < ZERO ? " (loss)" : ""} mUSDC
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          {settled ? (
            <a
              href={nearblocksAccount(NEAR_CORE)}
              target="_blank"
              rel="noreferrer"
              className="gr-press inline-flex w-full items-center justify-center gap-2 border-2 border-bone/40 px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-bone transition-colors hover:border-chartreuse hover:text-chartreuse"
            >
              View on NearBlocks <span aria-hidden>↗</span>
            </a>
          ) : (
            <>
              {canSettle ? (
                <PrimaryButton onClick={settle}>Settle job</PrimaryButton>
              ) : (
                <GhostButton state={settling ? "pending" : "disabled"}>
                  {settling ? "Settling…" : settlingState || job.locked ? "Settlement in progress" : "🔒 Locked until maturity"}
                </GhostButton>
              )}
              {!matured ? (
                <p className="mt-2 font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.12em] text-bone/40">
                  anyone may settle once matured · vault sells base → principal (1% price guard), then splits by fee
                </p>
              ) : null}
            </>
          )}
          <TxStatus phase={tx.state.phase} hash={tx.state.hash} error={tx.state.error} label={`Settle job #${job.job_id}`} />
          {tx.state.note ? <Note>{tx.state.note}</Note> : null}
          {msg ? <Note tone={msg.tone}>{msg.text}</Note> : null}
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════ CONNECT / CONFIG GATES ═══════════════════════════════════════════
function ConnectGate() {
  const { signIn } = useNearWallet();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function connect() {
    setErr(null);
    setBusy(true);
    try {
      await signIn();
    } catch (e) {
      const c = classifyWalletError(e);
      if (c.kind === "other") setErr(c.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel className="group mx-auto max-w-xl" accent>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        {/* the vault padlock — the shackle lifts under the cursor */}
        <div className="relative grid h-20 w-20 place-items-center border-2 border-bone/25 bg-pitch">
          <span aria-hidden className="bay-live absolute right-2 top-2 !m-0" />
          <svg viewBox="0 0 40 44" className="h-11 w-11 text-chartreuse" aria-hidden>
            <path className="transition-transform duration-500 group-hover:-translate-y-2" d="M11 20 V13 a9 9 0 0 1 18 0 V20" fill="none" stroke="currentColor" strokeWidth="3" />
            <rect x="6" y="20" width="28" height="22" fill="none" stroke="currentColor" strokeWidth="3" />
            <circle cx="20" cy="30" r="3" fill="currentColor" />
            <line x1="20" y1="32" x2="20" y2="37" stroke="currentColor" strokeWidth="2.5" />
          </svg>
        </div>
        <h2 className="mt-6 font-display text-3xl font-extrabold uppercase tracking-wide text-bone">
          Connect to <span className="fl-shine">hire the firm</span>
        </h2>
        <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-bone/60">
          Connect a NEAR <span className="text-bone">testnet</span> account to get test USDC and escrow a trading job. A wallet set to mainnet will refuse this app.
        </p>
        <div className="mt-7 w-full max-w-[300px]">
          <PrimaryButton onClick={connect} state={busy ? "pending" : "idle"}>
            {busy ? "Opening wallet…" : "Connect NEAR wallet"}
          </PrimaryButton>
        </div>
        {err ? <p className="hire-pop mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-signal2">{err}</p> : null}
      </div>
    </Panel>
  );
}

function ConfigGate({ missing }: { missing: string[] }) {
  return (
    <Panel className="mx-auto max-w-xl">
      <div className="px-6 py-10">
        <StatusPill tone="bad" label="not configured" />
        <p className="mt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-steel">
          This build has no NEAR deployment configured. Missing: {missing.join(", ")}. Values come from contracts/deployments/near_testnet.json.
        </p>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════ HOW A JOB RUNS ═══════════════════════════════════════════
const FLOW: { t: string; d: string; icon: React.ReactNode }[] = [
  {
    t: "Fund",
    d: "Mint test mUSDC from the public faucet — one click, no real value.",
    icon: (
      <>
        <ellipse cx="19" cy="11" rx="10" ry="4" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M9 11 v8 c0 2.2 4.5 4 10 4 s10-1.8 10-4 v-8 M9 19 v8 c0 2.2 4.5 4 10 4 s10-1.8 10-4 v-8" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </>
    ),
  },
  {
    t: "Escrow",
    d: "One ft_transfer_call moves it into the core contract — no approve step.",
    icon: (
      <>
        <rect x="6" y="8" width="26" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="19" cy="19" r="5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </>
    ),
  },
  {
    t: "Gated loop",
    d: "Twelve desks read, the PM decides. No validated edge → ABSTAIN, capital preserved.",
    icon: (
      <>
        <circle cx="19" cy="19" r="11" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M19 8 v6 M19 24 v6 M8 19 h6 M24 19 h6" stroke="currentColor" strokeWidth="2.4" />
      </>
    ),
  },
  {
    t: "Settle",
    d: "At maturity anyone may settle on-chain. Profit pays the fee, losses are yours.",
    icon: <path d="M8 20 L15 27 L30 10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />,
  },
];

function JobRail() {
  return (
    <div data-fx="rise" className="hire-flow relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <span aria-hidden className="hire-rail absolute left-[12%] right-[12%] top-[38px] hidden h-[2px] lg:block" />
      {FLOW.map((s, i) => (
        <div key={s.t} className="hire-node group relative" style={v({ "--i": i })}>
          <div className="relative z-[1] mx-auto grid h-[76px] w-[76px] place-items-center border-2 border-bone/30 bg-pitch text-bone transition-[border-color,color,transform,box-shadow] duration-300 group-hover:-translate-y-1 group-hover:border-chartreuse group-hover:text-chartreuse group-hover:shadow-[0_0_28px_-6px_rgba(201,242,75,0.7)] lg:mx-0 lg:ml-[calc(50%-38px)]">
            <svg viewBox="0 0 38 38" className="h-9 w-9" aria-hidden>
              {s.icon}
            </svg>
            <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center bg-chartreuse font-display text-xs font-extrabold text-pitch">{i + 1}</span>
          </div>
          <div className="mt-4 text-center">
            <p className="font-display text-lg font-extrabold uppercase tracking-wide text-bone transition-colors group-hover:text-chartreuse">{s.t}</p>
            <p className="mx-auto mt-1 max-w-[240px] text-[12px] leading-relaxed text-bone/55">{s.d}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════ PAGE ═══════════════════════════════════════════
const noopSubscribe = () => () => {};

export default function AppPage() {
  const { signedAccountId, loading } = useNearWallet();
  const missing = missingEnv();

  // gate the wallet-dependent body behind a mounted flag (server snapshot false → no hydration drift)
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // bump on faucet/hire success → dashboard refetches
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <BayShell
      ornament="vault"
      eyebrow="THE PRODUCT · FUEL THE MACHINE · NEAR TESTNET"
      title={["Hire the", "engine"]}
      lead={
        <>
          Deposit test USDC into the on-chain escrow. The firm runs its gated decision loop for the term you set, then settles deterministically —{" "}
          <span className="text-bone">profit splits by performance fee, losses are yours.</span> No counterparty, full audit trail.
        </>
      }
      aside={
        <div className="mt-6 flex flex-wrap gap-3">
          {["escrowed", "gated", "settled on-chain"].map((t, i) => (
            <span key={t} className="hire-badge border border-bone/25 bg-carbon px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/80" style={v({ "--i": i })}>
              <span className="text-chartreuse">✓</span> {t}
            </span>
          ))}
        </div>
      }
      footer="HELIQUANT · HIRE THE FIRM · NEAR TESTNET · escrowed · gated · settled on-chain · losses are the client's"
    >
      <StatStrip className="mb-14">
        <Stat i={0} k="performance fee" v={`${FEE_PCT}%`} tone="good" sub="on positive PnL only" />
        <Stat i={1} k="transactions to hire" v="1" sub="ft_transfer_call · no approve" />
        <Stat i={2} k="terms on offer" v={`${DURATION_PRESETS.length}`} sub={DURATION_PRESETS.map((d) => d.label.split(" · ")[0]).join(" · ")} />
        <Stat i={3} k="firm decision today" v="ABSTAIN" count={false} size="md" sub="registry empty → capital preserved" />
      </StatStrip>

      <AgentMarketCta className="mb-14" />

      <section aria-label="How a job runs" className="mb-20">
        <SectionHead n="01" title="How a job runs" sub="four steps · all on NEAR testnet" />
        <JobRail />
      </section>

      <section aria-label="The live floor" className="mb-20">
        <SectionHead n="02" title="The live floor" sub="a nine-cylinder radial · nine of the twelve desks · hover a cylinder to read it" />
        <div data-fx="rise" className="relative overflow-hidden border-2 border-bone/20 bg-carbon p-5 sm:p-8">
          <span aria-hidden className="gr-carbon-dots pointer-events-none absolute inset-0 opacity-30" />
          <div className="relative">
            <RadialEngine decision="ABSTAIN" />
          </div>
        </div>
      </section>

      <section aria-label="Your desk">
        <SectionHead n="03" title="Your desk" sub="fuel · escrow · settle" />
        {!mounted || loading ? (
          <div className="py-16" aria-busy="true" />
        ) : missing.length > 0 ? (
          <ConfigGate missing={missing} />
        ) : !signedAccountId ? (
          <ConnectGate />
        ) : (
          <div className="flex flex-col gap-16">
            <div>
              <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.14em] text-steel">
                <span className="bay-live" />
                account <span className="text-bone">{signedAccountId}</span> ·{" "}
                <a href={nearblocksAccount(signedAccountId)} target="_blank" rel="noreferrer" className="transition-colors hover:text-chartreuse">
                  NearBlocks ↗
                </a>
              </p>
              {/* faucet + hire (two columns on wide screens) */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                <FaucetPanel account={signedAccountId} onMinted={bump} />
                <HirePanel account={signedAccountId} onHired={bump} />
              </div>
            </div>

            <section aria-label="Your trading jobs">
              <Dashboard account={signedAccountId} refreshKey={refreshKey} />
            </section>
          </div>
        )}
      </section>
    </BayShell>
  );
}
