/**
 * The V8's inspectable parts and the HeliQuant desk each one stands for.
 *
 * `desk` is the exact desk name the firm's /desks and /agents endpoints use, so the inspect panel
 * can join live data onto a part. `how` is the desk's job, copied from what the firm's code does
 * (firm/organization.py, firm/flow_intel.py, firm/hl_whales.py). `anatomy` lines describe the
 * engine part itself; they are engine dressing, not firm metrics.
 */

export type PartId =
  | "block"
  | "heads"
  | "intake"
  | "pistons"
  | "crank"
  | "flywheel"
  | "timing"
  | "alternator"
  | "filter"
  | "exhaust"
  | "sump";

export type PartInfo = {
  id: PartId;
  /** engine part name */
  name: string;
  /** desk label shown on the part */
  label: string;
  /** desk name as the firm's API spells it (null = not a desk) */
  desk: string | null;
  /** one line under the label */
  role: string;
  how: string;
  anatomy: string[];
  /** words that mark a PM decision as mentioning this desk */
  mentions: RegExp | null;
};

export const PARTS: PartInfo[] = [
  {
    id: "block",
    name: "Engine block",
    label: "HELIQUANT · THE FIRM",
    desk: null,
    role: "the frame every desk bolts onto",
    how: "The firm itself: twelve voices bolted to one block, one PM, one decision per cycle, every call anchored on NEAR. It holds neutral unless a validated edge says go.",
    anatomy: ["Cast 90° V-block, two banks of four bores", "Deep-skirt crankcase with main bearing caps", "Titanium-finish fasteners along the deck"],
    mentions: null,
  },
  {
    id: "crank",
    name: "Crankshaft",
    label: "PM",
    desk: null,
    role: "synthesizes the desks · ENTER or ABSTAIN",
    how: "Reads every desk's output, weighs the dissent, and outputs ENTER or ABSTAIN. A hard rug-pull veto forces ABSTAIN; it defaults to HOLD unless a validated edge says go. The restraint is the product.",
    anatomy: ["Counterweights on every web", "Polished main and rod journals", "Forged crank, four throws for eight cylinders"],
    mentions: null,
  },
  {
    id: "timing",
    name: "Cam timing",
    label: "REGIME",
    desk: "Regime/Technical",
    role: "XGBoost regime · 78.9% test vs 76.1% persistence",
    how: "An XGBoost classifier (78.9% on NEAR's test set vs 76.1% for persistence) labels the market regime from ADX, EMA slope and volatility, then sets a dynamic risk/reward. It allocates capital to the regime — it does not predict price.",
    anatomy: ["Chrome cam sprockets turn at half crank speed", "Crank sprocket drives the chain", "Roller chain over a centre idler"],
    mentions: /regime|ADX|trending|ranging/i,
  },
  {
    id: "pistons",
    name: "Pistons & rods",
    label: "OI-CONTRARIAN",
    desk: "OI-Contrarian",
    role: "fades OI extremes · no NEAR edge yet",
    how: "Fades open-interest extremes. No asset has earned this edge on NEAR, so it is context only. Only when this desk reports edge_validated AND actionable may the PM ENTER — the one exception to default-HOLD.",
    anatomy: ["Eight forged pistons with ring lands", "Kinematics solved live from the crank angle", "Titanium-finish I-beam connecting rods"],
    mentions: /OI-Contrarian|open.interest|\bOI\b/i,
  },
  {
    id: "heads",
    name: "Heads & valvetrain",
    label: "FLOW-INTEL",
    desk: "flow-intel",
    role: "self-learning flow signals",
    how: "A self-learning read of flow signals. Each signal must validate out-of-sample before it counts; when none of them predicts, the desk honestly abstains. Ranked and weighted alongside the other desks.",
    anatomy: ["Carbon-fibre cam covers", "Coil-on-plug ignition, one coil per cylinder", "Polished aluminium cylinder heads"],
    mentions: /flow-intel|flow signal/i,
  },
  {
    id: "intake",
    name: "Intake",
    label: "SMART-SOCIAL",
    desk: "Smart-Social",
    role: "Elfa narrative / mindshare",
    how: "Elfa mindshare — narratives and trend pulled from SMART social accounts (Twitter/X + Telegram), not retail noise. Flags when the asset's ticker is already in-trend.",
    anatomy: ["Eight anodised velocity stacks", "Carbon plenum in the V-valley, runners to each port", "Throttle body with an anodised ring"],
    mentions: /Elfa|social|mindshare|narrative/i,
  },
  {
    id: "filter",
    name: "Oil filter",
    label: "SMART-MONEY",
    desk: "Smart-Money Flow",
    role: "flow engine + Nansen netflow",
    how: "The Dynamic Smart-Money Flow Engine reads net DEX flow per asset and folds in Nansen funds' real ETH netflow as a macro risk-on / risk-off signal.",
    anatomy: ["Spin-on canister with a knurled grip", "Billet mounting plate"],
    mentions: /smart.money|netflow|Nansen/i,
  },
  {
    id: "exhaust",
    name: "Exhaust headers",
    label: "ON-CHAIN",
    desk: "On-chain/Risk",
    role: "whales + security check · logged on NEAR",
    how: "Tracks the smart-money whale watchlist (Rhea wNEAR pool trades from GeckoTerminal) and runs an internal on-chain token-security check on wrap.near. A failed check vetoes the trade; every decision is sealed on NEAR.",
    anatomy: ["Four-into-one headers per bank", "Collector runs the length of the block", "Heat-tinted titanium finish"],
    mentions: /on-chain|security|rug/i,
  },
  {
    id: "alternator",
    name: "Alternator",
    label: "MACRO",
    desk: "Macro (Allora)",
    role: "Allora 8h BTC/ETH forecast",
    how: "Pulls Allora's decentralized-AI 8h price prediction for BTC (topic 14) and ETH (topic 9) as the macro backdrop; falls back to a BTC-regime proxy if Allora is unavailable.",
    anatomy: ["Multi-groove chrome pulley", "Finned alternator body", "Cooling fan behind the pulley"],
    mentions: /Allora|macro/i,
  },
  {
    id: "sump",
    name: "Oil pan",
    label: "RESEARCH",
    desk: "Research",
    role: "Fear & Greed + global macro",
    how: "External macro context via free public APIs — the Fear & Greed index plus global market cap and BTC dominance — for a clean risk-on / risk-off read.",
    anatomy: ["Baffled sump with cooling fins", "Gold drain plug", "Gasket flange bolted to the crankcase"],
    mentions: /Fear|Greed|dominance|research/i,
  },
  {
    id: "flywheel",
    name: "Flywheel",
    label: "WHALE",
    desk: "whale",
    role: "top Hyperliquid traders' live positions",
    how: "A per-asset whale tracker: the top Hyperliquid traders' live positions in this asset — net long or short and their PnL. Empty when the asset is not listed on Hyperliquid.",
    anatomy: ["Machined steel flywheel, 48-tooth ring gear", "Spins with the crank, stores its momentum"],
    mentions: /whale|Hyperliquid/i,
  },
];

export const PART = Object.fromEntries(PARTS.map((p) => [p.id, p])) as Record<PartId, PartInfo>;
