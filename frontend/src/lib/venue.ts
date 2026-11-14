/**
 * Trade-venue labels. Pure functions with no imports, so `node --test` can load them.
 * campaign.ts re-exports them for the components.
 */

/** The firm's traded basket (same list as agents/firm/market_worker.py BASKET). Pages that hide leftovers of
 *  older runs filter on this set. */
export const TRADED_BASKET: ReadonlySet<string> = new Set(["BTC", "ETH", "SOL", "HYPE", "SUI", "XRP", "NEAR"]);

/** Trade-venue badge content. A real Bitget Demo fill reads ⚡ BITGET DEMO (teal);
 *  anything else (null/absent = paper at live prices) reads 📄 PAPER (steel). Returns the label
 *  plus the border/text Tailwind classes — the caller adds its own sibling-chip sizing. */
export function venueBadge(venue?: string | null): { label: string; cls: string } {
  const v = venue || "";
  if (v.includes("bitget")) return { label: "⚡ BITGET DEMO", cls: "border-bitget/50 text-bitget" };
  if (v.startsWith("paper (learning")) return { label: "📄 PAPER · LEARNING", cls: "border-bone/25 text-steel" };
  return { label: "📄 PAPER", cls: "border-bone/25 text-steel" };
}

// Bitget instrument labels. Bitget Demo (API v3, `paptrading: 1`) trades the same USDT-FUTURES symbols
// as mainnet (BTCUSDT, NEARUSDT…), so the demo symbol equals the mainnet pair. DEMO_SYMBOL lists the
// assets the demo venue fills; any other asset is paper only and shows the plain pair.
const DEMO_SYMBOL: Record<string, string> = { BTC: "BTCUSDT", ETH: "ETHUSDT", XRP: "XRPUSDT", NEAR: "NEARUSDT" };
export const pairLabel = (asset: string): string => `${asset.toUpperCase()}USDT`;
export const venueLabel = (asset: string, venue?: string | null): string =>
  (venue ?? "").includes("bitget") ? (DEMO_SYMBOL[asset.toUpperCase()] ?? pairLabel(asset)) : pairLabel(asset);
