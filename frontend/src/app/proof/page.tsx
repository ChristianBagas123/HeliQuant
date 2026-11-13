/**
 * /proof — THE PROOF. TEE-signed LLM calls of the latest firm cycles (NEAR AI Cloud), with the command to
 * verify them yourself. Data comes from the agent's GET /tee and GET /tee/{cycle_id}.
 */

import BayShell from "@/components/garage/bay/BayShell";
import ProofView from "@/components/garage/ProofView";

export default function ProofPage() {
  return (
    <BayShell
      ornament="proof"
      eyebrow="NEAR AI CLOUD · TEE-SIGNED LLM CALLS · LIVE"
      title={["The", "proof"]}
      lead={
        <>
          Every LLM call of a firm cycle runs inside a trusted execution environment on NEAR AI Cloud, and each
          answer comes back with an ed25519 signature over the model, the request hash and the response hash. The
          proofs are listed per call below and sealed with each desk record. Check them yourself.
        </>
      }
      footer="HELIQUANT · THE PROOF · signatures prove model and input, not market data"
    >
      <ProofView />
    </BayShell>
  );
}
