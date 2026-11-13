/**
 * /agents — THE CREW. HeliQuant's firm + 12 desks as on-chain identities (NEP-171 tokens in the core contract),
 * each with a verifiable tokenId + accruing on-chain reputation, read live from the core contract.
 */

import AgentRoster from "@/components/garage/AgentRoster";
import AgentMarketCta from "@/components/garage/AgentMarketCta";
import BayShell from "@/components/garage/bay/BayShell";

export default function AgentsPage() {
  return (
    <BayShell
      ornament="crew"
      eyebrow="NEP-171 IDENTITIES · ON NEAR · 13 REGISTERED AGENTS"
      title={["The", "crew"]}
      lead={
        <>
          All <span className="text-bone">twelve desks</span> plus the firm hold an on-chain identity on
          NEAR — <span className="text-bone">thirteen registered agents</span>, each with a tokenId and an
          on-chain reputation that accrues from its real track record as outcomes resolve. The Regime desk is
          the ML itself (XGBoost). Verify any of them on NearBlocks.
        </>
      }
      aside={<AgentMarketCta className="mt-8" />}
      footer="HELIQUANT · THE CREW · 13 on-chain agents (firm + 12 desks) on NEAR — identity + reputation, verifiable"
    >
      <AgentRoster />
    </BayShell>
  );
}
