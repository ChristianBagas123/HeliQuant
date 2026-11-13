/**
 * AgentMarketCta — "Hire the firm per job on NEAR Agent Market". Renders nothing until
 * NEXT_PUBLIC_AGENT_MARKET_URL is set (the listing must be Live for visitors to open it).
 */

import { AGENT_MARKET_URL } from "@/lib/heliquant";

export default function AgentMarketCta({ className = "" }: { className?: string }) {
  if (!AGENT_MARKET_URL) return null;
  return (
    <section aria-label="Hire on NEAR Agent Market" className={`fl-card border-2 border-chartreuse/60 bg-carbon p-5 sm:p-6 ${className}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-steel">
        <span className="text-chartreuse">▮</span> NEAR AGENT MARKET · PER-JOB HIRE
      </p>
      <h2 className="mt-2 font-display text-2xl font-extrabold uppercase leading-tight text-bone sm:text-3xl">
        Hire the firm per job on NEAR Agent Market
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bone/70">
        Price $0. One asset per job: the deliverable holds the ENTER/ABSTAIN decision, its NEAR anchor and the
        TEE proofs of the LLM calls. Write the brief as{" "}
        <code className="font-mono text-chartreuse">Analyze NEAR</code>.
      </p>
      <a
        href={AGENT_MARKET_URL}
        target="_blank"
        rel="noreferrer"
        className="fl-cta gr-press mt-4 inline-block border-2 border-pitch bg-chartreuse px-5 py-2.5 font-display text-base font-bold uppercase tracking-wide text-pitch"
      >
        Open on Agent Market ↗
      </a>
    </section>
  );
}
