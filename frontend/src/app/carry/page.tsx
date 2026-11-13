/**
 * /carry — the delta-neutral funding-carry monitor (long spot + short perp, market-neutral, predicts
 * nothing). Live rates are read from real Bitget funding; the desk says harvest only when carry is rich
 * and crash-robust, and waits when it isn't. It is not a validated edge in the registry.
 */

import BayShell from "@/components/garage/bay/BayShell";
import CarryDesk from "@/components/garage/CarryDesk";

export default function CarryPage() {
  return (
    <BayShell
      ornament="edge"
      eyebrow="MARKET-NEUTRAL YIELD · NON-DIRECTIONAL · LIVE"
      title={["The", "edge"]}
      lead={
        <>
          Everything else in the firm asks &quot;which way?&quot; and — honestly — finds no edge on a 1–4h tape.
          This one asks a different question: <span className="text-bone">where can we earn yield without
          predicting?</span> Delta-neutral funding-carry — long spot, short perp — is market-neutral and earns the
          funding the perp pays. It is a <span className="text-chartreuse">live yield monitor</span>, read from real
          Bitget funding — not a validated edge. It only pays when funding is fat; when it&apos;s thin, the firm
          waits.
        </>
      }
      footer="HELIQUANT · THE EDGE · a non-directional yield monitor — harvested only when it pays, never forced"
    >
      <CarryDesk />
    </BayShell>
  );
}
