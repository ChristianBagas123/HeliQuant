/**
 * /learning — THE TUNING BAY. HeliQuant's self-learning made watchable: every loss re-maps the
 * engine (faded conditions = dialed-back throttles), the gate refuses counter-trend repeats, and
 * the learning is regime-aware. Distinct metaphor from THE GRID (race lanes) — a tuning console.
 */

import BayShell from "@/components/garage/bay/BayShell";
import LearningBay from "@/components/garage/LearningBay";

export default function LearningPage() {
  return (
    <BayShell
      ornament="tuning"
      warn
      eyebrow="SELF-LEARNING · EVERY LOSS RE-MAPS THE ENGINE · LIVE"
      title={["The tuning", "bay"]}
      lead={
        <>
          Losses aren&apos;t wasted — they&apos;re the training signal. Each closed trade re-maps the
          engine: a condition proven to lose <span className="text-bone">in this regime</span> gets its
          throttle dialed back, the gate refuses to repeat it, and the firm runs sharper next pass.
          Watch it learn, live.
        </>
      }
      footer="HELIQUANT · THE TUNING BAY · the firm learns from every loss — and never fakes an edge"
    >
      <LearningBay />
    </BayShell>
  );
}
