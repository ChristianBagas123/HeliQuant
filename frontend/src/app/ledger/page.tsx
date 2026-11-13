/**
 * /ledger — THE LEDGER. HeliQuant's complete trade record (every resolved trade + data) on top, the
 * on-chain verifiability trail (anchors and desk outputs on NEAR testnet, from NearBlocks) below.
 * Honest split: trades are paper/testnet; DECISIONS are what get sealed on-chain.
 */

import BayShell from "@/components/garage/bay/BayShell";
import { SectionHead } from "@/components/garage/bay/parts";
import OnchainLedger from "@/components/garage/OnchainLedger";
import TradeLedger from "@/components/garage/TradeLedger";
import { nearblocksAccount } from "@/lib/contracts";
import { EXECUTOR_ACCOUNT } from "@/lib/heliquant";

export default function LedgerPage() {
  return (
    <BayShell
      ornament="ledger"
      eyebrow="THE COMPLETE RECORD · EVERY TRADE · EVERY DECISION SEALED · LIVE"
      title={["The", "ledger"]}
      lead={
        <>
          Every trade the firm has resolved — direction, entry, exit, P&amp;L, why it exited, the regime
          it opened in, and the <span className="text-chartreuse">NEAR transaction</span> that sealed its
          outcome. Open any row for the full record; tap any tx to verify it yourself on NearBlocks. Nothing hidden, nothing faked.
        </>
      }
      footer="HELIQUANT · THE LEDGER · every trade logged, every decision sealed — paper-honest, chain-verified"
    >
      {/* the trade record — each row carries its own on-chain anchor */}
      <section>
        <SectionHead n="01" title="The trade record" sub="every resolved trade · paper at live prices · Bitget Demo fills when armed" />
        <TradeLedger />
      </section>

      {/* the raw chain tape: recent transactions of the core contract (anchors, desk outputs, jobs) */}
      <section className="mt-20">
        <SectionHead
          n="02"
          title="The chain tape"
          sub="core contract · NearBlocks"
          right={
            EXECUTOR_ACCOUNT ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-steel">
                executor (OutLayer custody wallet):{" "}
                <a href={nearblocksAccount(EXECUTOR_ACCOUNT)} target="_blank" rel="noopener noreferrer" title={EXECUTOR_ACCOUNT} className="text-chartreuse hover:underline">
                  {EXECUTOR_ACCOUNT.slice(0, 8)}…{EXECUTOR_ACCOUNT.slice(-8)} ↗
                </a>
              </p>
            ) : undefined
          }
        />
        <OnchainLedger />
      </section>
    </BayShell>
  );
}
