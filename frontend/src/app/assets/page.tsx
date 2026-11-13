/**
 * /assets — "THE DYNO BAYS" (Night Garage §6.8)
 *
 * Every asset is an engine on a test stand. Each bay shows what the lab actually measured:
 * the PATTERN gauge (return-autocorrelation — under 0.05 the tape is a random walk: don't
 * predict it, follow flow), the live funding-carry read, and the stamped verdict from the
 * edge lab. Current truth: the tape of every asset tested reads EFFICIENT, no hypothesis cleared the gate on
 * NEAR (2026-11-09), the registry is empty, the firm holds N.
 */

import BayShell from "@/components/garage/bay/BayShell";
import DynoBays, { type Bay } from "@/components/garage/DynoBays";

// pattern gauge scale: 0 → 0.15 |acf|; zones: <0.05 efficient · 0.05–0.10 weak · >0.10 patterned
const BAYS: Bay[] = [
  {
    no: "BAY-01",
    ticker: "NEAR",
    name: "NEAR Protocol",
    pattern: { label: "0.027", frac: 0.027 / 0.15, note: "measured — efficient" },
    carry: "not measured — no basis stress test for NEAR yet",
    verdict: {
      stamp: "NO EDGE",
      tone: "signal",
      story:
        "The home asset, tested first. Funding-fade (−28.5% OOS) and price-momentum (−35.0% OOS, buy-and-hold +62.6%) both failed the cost-aware gate; open-interest hypotheses could not be tested (no OI history). The registry stays empty and the firm abstains. Orders still fill on Bitget Demo so the path is proven.",
    },
  },
  {
    no: "BAY-02",
    ticker: "BTC",
    name: "Bitcoin",
    pattern: { label: "<0.05", frac: 0.04 / 0.15, note: "efficient" },
    carry: "live read: see /carry",
    verdict: {
      stamp: "NO EDGE",
      tone: "signal",
      story:
        "The RSI/TP strategy scan flagged BTC OVERFIT: in-sample +0.1%, out-of-sample −2.8% (16 trades). Nothing has cleared the cost-aware gate here, and we say so instead of forcing trades.",
    },
  },
  {
    no: "BAY-03",
    ticker: "ETH",
    name: "Ethereum",
    pattern: { label: "<0.05", frac: 0.042 / 0.15, note: "efficient" },
    carry: "live read: see /carry",
    verdict: {
      stamp: "NO EDGE",
      tone: "bone",
      story: "The RSI/TP strategy scan flagged ETH OVERFIT: in-sample +1.64%, out-of-sample −4.75% (17 trades). The bay stays instrumented; the engine stays off.",
    },
  },
  {
    no: "BAY-04",
    ticker: "HYPE",
    name: "Hyperliquid",
    pattern: { label: "<0.05", frac: 0.045 / 0.15, note: "efficient" },
    carry: "live read: see /carry",
    verdict: {
      stamp: "NO EDGE",
      tone: "bone",
      story:
        "HYPE failed the OI-contrarian bar: the direction was momentum, not contrarian, out-of-sample did not beat buy-and-hold, and only 7 trades (the bar is 10). Recorded in data/validated_edges_hype.json.",
    },
  },
  {
    no: "BAY-05",
    ticker: "SUI",
    name: "Sui",
    pattern: { label: "<0.05", frac: 0.04 / 0.15, note: "efficient" },
    carry: "live read: see /carry",
    verdict: {
      stamp: "PROBATION",
      tone: "chartreuse",
      story: "A funding-fade candidate (122 trades, 4 of 5 folds positive) sits in candidate_edges.json, still awaiting confirmation on new data. It is not in the registry and does not size anything.",
    },
  },
  {
    no: "BAY-06",
    ticker: "RHEA",
    name: "Rhea Finance · LiNEAR · stNEAR · AURORA",
    pattern: { label: "n/a", frac: 0, note: "no perp tape" },
    carry: "no perp venue — carry not executable",
    verdict: {
      stamp: "WATCH ONLY",
      tone: "bone",
      story:
        "The NEAR-ecosystem tokens have no Bitget perp, so they cannot be ordered. They are monitored (quotes, security check, pool flow) and can never ENTER — no executable venue, no bay time.",
    },
  },
  {
    no: "BAY-07",
    ticker: "SOL",
    name: "Solana",
    pattern: { label: "efficient", frac: 0.04 / 0.15, note: "momentum loses OOS" },
    carry: "live read: see /carry",
    verdict: {
      stamp: "NO EDGE",
      tone: "bone",
      story:
        "The RSI/TP strategy scan flagged SOL OVERFIT: in-sample +2.96%, out-of-sample −4.95% (25 trades). The bay stays instrumented; the engine stays off until a signal clears the cost line. Tracked on Bitget, traded by no one here without an edge.",
    },
  },
  {
    no: "BAY-08",
    ticker: "XRP",
    name: "XRP",
    pattern: { label: "new", frac: 0.05 / 0.15, note: "profiling — just listed" },
    carry: "live read: see /carry",
    verdict: {
      stamp: "ENROLLED",
      tone: "chartreuse",
      story:
        "The newest bay — one of four assets that fill on the REAL Bitget Demo (with BTC, ETH + NEAR). It runs the exact same gate as everything else: no validated edge yet, profiled live before any conviction. New tape earns trust the hard way.",
    },
  },
];

export default function AssetsPage() {
  return (
    <BayShell
      ornament="bays"
      eyebrow="THE TEST CELLS · PER-ASSET CHARACTER · LIVE READS"
      title={["The dyno", "bays"]}
      lead={
        <>
          Eight machines on eight stands. The pattern gauge reads return-autocorrelation — under <span className="font-mono text-bone">0.05</span> the
          tape is a random walk: <span className="text-bone">you don&apos;t predict it, you follow flow.</span> Verdicts are stamped by the edge lab, not by
          marketing.
        </>
      }
      footer="HELIQUANT · THE DYNO BAYS · measured, stamped, published — including the failures"
    >
      <DynoBays bays={BAYS} />
    </BayShell>
  );
}
