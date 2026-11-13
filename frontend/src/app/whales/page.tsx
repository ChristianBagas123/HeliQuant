/**
 * /whales — "THE TIMING TOWER" (Night Garage §6.7)
 *
 * Two live reads, per traded asset:
 *   01 · the Hyperliquid top-PnL whale grid — the SMART MONEY the firm acts on (<HlWhaleTower/>).
 *   02 · Bitget aggregate retail long/short + OI — the CROWD, read contrarian (<BitgetCrowd/>).
 * Both poll the engine. (NEAR pool flow is read by the On-chain/Risk desk from GeckoTerminal; the firm trades the Bitget
 * basket, so this page stays on perp positioning.)
 */

import BayShell from "@/components/garage/bay/BayShell";
import BitgetCrowd from "@/components/garage/BitgetCrowd";
import HlWhaleTower from "@/components/garage/HlWhaleTower";

export default function WhalesPage() {
  return (
    <BayShell
      ornament="radar"
      eyebrow="TELEMETRY · LIVE · SMART MONEY vs THE CROWD · PER TRADED ASSET"
      title={["The timing", "tower"]}
      lead={
        <>
          Read the other drivers on the track. The firm watches the <span className="text-bone">Hyperliquid top-PnL whales</span> per
          traded asset — the smart money — and sets them against the <span className="text-bitget">Bitget retail crowd</span>. Follow
          conviction; fade the herd. Watch their lines; don&apos;t copy them blind.
        </>
      }
      aside={
        <div className="fl-card mt-6 inline-block border-2 border-bone/30 bg-carbon px-4 py-2.5">
          <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-steel">
            <span className="text-chartreuse">01 · smart money</span> — Hyperliquid top-PnL whales per traded asset (live).
            <br />
            <span className="text-bitget">02 · the crowd</span> — Bitget aggregate retail long/short + OI (live, read contrarian).
          </p>
        </div>
      }
      footer="HELIQUANT · THE TIMING TOWER · Hyperliquid smart money up top · the Bitget crowd below — both live"
    >
      <HlWhaleTower />
      <div aria-hidden className="gr-hazard bay-hazard my-16 h-[10px] opacity-70" />
      <BitgetCrowd />
    </BayShell>
  );
}
