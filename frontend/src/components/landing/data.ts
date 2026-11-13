/**
 * Landing copy and figures.
 *
 * HONESTY RULE: every string and number here is copied verbatim from the
 * existing garage components (source noted per block). Nothing is retyped from memory and nothing
 * is added. If a figure changes, change it at its source and here together.
 */

/** GarageNav.tsx — LINKS (same-page anchors written as hashes for smooth scrolling). */
export const NAV_LINKS = [
  { href: "/campaign", label: "The grid" },
  { href: "#dyno", label: "Dyno" },
  { href: "#report", label: "Findings" },
  { href: "/whales", label: "Telemetry" },
  { href: "/assets", label: "Dyno bays" },
  { href: "/firms/heliquant", label: "License" },
  { href: "/setup", label: "Ignition" },
];

/** HeroEngineBay.tsx — TICKER. */
export const TICKER = [
  "12 SPECIALIST DESKS · PM SIGN-OFF ON EVERY TRADE",
  "ALLORA MACRO INFERENCE IN THE DEBATE",
  "LIVE INTEL · NANSEN · ELFA · HYPERLIQUID WHALES",
  "REAL FILLS ON BITGET DEMO",
  "REGIME CLASSIFIER 78.9% VS 76.1% BASELINE · NEAR",
  "EVERY DECISION SEALED ON NEAR · CORE.ANCHOR",
  "NO NEAR EDGE CLEARED THE GATE — THE FIRM ABSTAINS",
  "DEMO FILLS PROVE THE ORDER PATH — PAPER LEDGER IS THE PNL",
  "ANCHORED ON NEAR · LLM CALLS SIGNED IN A NEAR AI CLOUD TEE · HIRE IT ON NEAR AGENT MARKET",
  "WE PUBLISH THE TRUTH — NUMBERS, NOT HYPE",
];

/** GearEngine.tsx readout strip + ShopReport row #1: regime test accuracy vs persistence baseline (NEAR). */
export const REGIME = { accuracy: 78.9, baseline: 76.1 };

/** EngineCycle.tsx — STROKES. */
export const STROKES = [
  { key: "INTAKE", num: "01", title: "Intake", desc: "Ten desks pull live telemetry — regime, positioning, funding, whales, TVL, macro, volatility." },
  { key: "COMPRESSION", num: "02", title: "Compression", desc: "Bull argues bear. Twelve voices compress into one pressurized read." },
  { key: "COMBUSTION", num: "03", title: "Combustion", desc: "The PM is the spark plug. ENTER ignites only on a validated edge." },
  { key: "EXHAUST", num: "04", title: "Exhaust", desc: "The decision — even the restraint — is sealed on-chain on NEAR." },
];

/** EngineCycle.tsx — DESKS (the manifold). */
export const MANIFOLD = [
  "REGIME/TECHNICAL",
  "MACRO · ALLORA",
  "ON-CHAIN/RISK",
  "SMART-MONEY FLOW",
  "RESEARCH",
  "SMART-SOCIAL · ELFA",
  "OI-CONTRARIAN",
  "CARRY",
  "NEAR FUNDAMENTALS · DEFILLAMA",
  "TIMESFM VOL/RISK",
  "FLOW-INTEL",
  "WHALE TRACKER",
];

/** DynoRoom.tsx — RUNS (agents/data/onboarding_report.json, NEAR) and SCRAP. */
export type Run = { name: string; oos: number; bh: number; trades: number; win: number; bps: number };
export const RUNS: Run[] = [
  { name: "FUNDING FADE", oos: -28.52, bh: -22.72, trades: 32, win: 37.5, bps: -91.1 },
  { name: "PRICE MOMENTUM", oos: -35.04, bh: 62.62, trades: 80, win: 48.8, bps: -36.7 },
];
export const SCRAP = [
  { name: "FUNDING FADE", cause: "−28.5% OOS · below buy-and-hold" },
  { name: "PRICE MOMENTUM", cause: "−35.0% OOS · buy-and-hold +62.6%" },
  { name: "OI-CHANGE SIGNALS", cause: "not testable — no OI history" },
];
export const DYNO_COUNTERS = [
  { v: "2", l: "hypotheses tested" },
  { v: "0", l: "passed the gate" },
  { v: "2", l: "scrapped" },
];
/** ±70% fills the half-width of the dyno bar track (DynoRoom.tsx SCALE). */
export const DYNO_SCALE = 70;

/** TheGarage.tsx — PARTS. */
export const PARTS: Array<{ no: string; name: string; desc: string; live?: boolean }> = [
  { no: "HQ-001", name: "THE ORG BRAIN", desc: "12-desk firm + PM debate loop · LLM calls on NEAR AI Cloud (TEE) · Groq as fallback · runs every cycle in the cloud", live: true },
  { no: "HQ-002", name: "THE EDGE LAB", desc: "cost-aware OOS · walk-forward · outlier-robust · FDR — the dyno itself" },
  { no: "HQ-003", name: "THE EXECUTOR", desc: "OutLayer Agent Custody signs `trade` and `anchor` from a TEE-held key, under the owner's policy · orders fill on Bitget Demo · Kelly-capped tickets" },
  { no: "HQ-004", name: "THE CONTRACTS", desc: "identity · reputation · validation · jobs · vault · anchor — one core contract on NEAR" },
  { no: "HQ-005", name: "THE RECORDER", desc: "every decision sealed: Supabase public table + NEAR anchor" },
  { no: "HQ-006", name: "THE FEEDERS", desc: "optional: POST /ingest takes positioning CSVs; scripts/88 refreshes the carry & whale caches in Supabase" },
  { no: "HQ-007", name: "THE PROOF", desc: "every LLM call runs on NEAR AI Cloud (TEE) and is signed; proofs are sealed with each desk record" },
];
