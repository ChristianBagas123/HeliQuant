/**
 * /performance — THE DYNO. The firm's trade ledger on a dynamometer: quantstats-grade metrics
 * (Sharpe / Sortino / max-drawdown / profit-factor) computed from REAL resolved trades, plus the
 * compounded equity power-band. Honest by construction — annualized figures stay withheld until the
 * sample earns them. A dyno can't be marketed past; that's the point.
 */

import BayShell from "@/components/garage/bay/BayShell";
import DynoSheet from "@/components/garage/DynoSheet";

export default function PerformancePage() {
  return (
    <BayShell
      ornament="dyno"
      warn
      eyebrow="REAL LEDGER · MEASURED NOT MARKETED · LIVE"
      title={["The", "dyno"]}
      lead={
        <>
          A dynamometer measures an engine&apos;s real output under load — you can&apos;t market your way
          past the curve. So we put the firm&apos;s ledger on it: Sharpe, Sortino, drawdown, profit factor,
          computed from <span className="text-bone">real resolved trades</span>. Annualized numbers stay
          blank until the sample earns them — a 3-day window doesn&apos;t get a CAGR. The directional floor
          has no validated edge, so the curve reads ~breakeven/loss. We show it anyway.
        </>
      }
      footer="HELIQUANT · THE DYNO · rigorous metrics on the real ledger — including the losses"
    >
      <DynoSheet />
    </BayShell>
  );
}
