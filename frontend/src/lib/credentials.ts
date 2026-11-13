/**
 * The credentials a HeliQuant engine understands — shared by /onboarding (the form that writes them to YOUR
 * engine's SQLite) and /profile (the keyring that shows which names are on file). Key names match the env-var
 * names the engine stores (agents/firm/creds_store.py); values never pass through here.
 */

export type Cred = {
  key: string;
  label: string;
  why: string;
  group: "guards" | "fuel";
  secret: boolean;
  placeholder: string;
  defaultValue?: string;
};

export const CREDS: Cred[] = [
  { key: "ASSETS", label: "Assets", why: "what the floor analyzes, comma-separated, one rotated per cycle", group: "guards", secret: false, placeholder: "BTC,ETH,SOL,HYPE,SUI,XRP,NEAR", defaultValue: "BTC,ETH,SOL,HYPE,SUI,XRP,NEAR" },
  { key: "INTERVAL_MIN", label: "Cycle interval (min)", why: "minutes between org cycles — 30+ keeps a free Groq tier comfortable", group: "guards", secret: false, placeholder: "30", defaultValue: "30" },
  { key: "REFRESH_DATA", label: "Self-refresh data (0/1)", why: "1 = the engine re-fetches fresh market data each cycle", group: "guards", secret: false, placeholder: "1", defaultValue: "1" },
  // ── LLM provider + executor mode ──
  { key: "HQ_PROVIDER", label: "LLM provider", why: "nearai = NEAR AI Cloud, every answer TEE-signed (needs the NEAR AI key below; without it the engine falls back to your Groq pool) · groq = Groq only, unsigned", group: "guards", secret: false, placeholder: "nearai", defaultValue: "nearai" },
  { key: "NEARAI_API_KEY", label: "NEAR AI Cloud API key", why: "NEAR AI Cloud: inference inside a TEE, each answer signed", group: "fuel", secret: true, placeholder: "optional" },
  { key: "EXECUTOR_MODE", label: "Executor mode", why: "key (restricted function-call key) or custody (OutLayer Agent Custody wallet)", group: "guards", secret: false, placeholder: "key", defaultValue: "key" },
  { key: "OUTLAYER_API_KEY", label: "OutLayer wallet API key", why: "OutLayer Agent Custody wallet (wk_...). Only for EXECUTOR_MODE=custody", group: "fuel", secret: true, placeholder: "optional" },
  { key: "OUTLAYER_WALLET_ACCOUNT", label: "OutLayer wallet account", why: "the wallet's implicit NEAR account (64 hex). Only for EXECUTOR_MODE=custody", group: "guards", secret: false, placeholder: "optional" },
  { key: "AGENT_MARKET_TOKEN", label: "Agent Market token", why: "your agent token on NEAR Agent Market (aat_...), lets the engine take hired jobs", group: "fuel", secret: true, placeholder: "optional" },
  // ── Bitget (execution) ──
  { key: "BITGET_API_KEY", label: "Bitget API key", why: "Bitget Demo API key (UTA account, API v3 with paptrading). Long + short on USDT-FUTURES, no real funds", group: "fuel", secret: true, placeholder: "optional" },
  { key: "BITGET_API_SECRET", label: "Bitget API secret", why: "pairs with the Bitget key", group: "fuel", secret: true, placeholder: "optional" },
  { key: "BITGET_PASSPHRASE", label: "Bitget passphrase", why: "the passphrase you set on the Bitget API key", group: "fuel", secret: true, placeholder: "optional" },
  { key: "BITGET_DEMO", label: "Bitget demo (0/1)", why: "1 = demo (no real funds, safe). 0 = mainnet — eyes open", group: "fuel", secret: false, placeholder: "1", defaultValue: "1" },
  { key: "BITGET_EXECUTE", label: "Bitget execute (0/1)", why: "1 = place real Bitget orders. 0 = paper", group: "fuel", secret: false, placeholder: "0", defaultValue: "0" },
  // ── optional power-ups ──
  { key: "NEAR_EXECUTOR_PRIVATE_KEY", label: "NEAR executor key (function-call key)", why: "only for EXECUTOR_MODE=key. Anchors decisions on-chain: a restricted testnet key only, never a full-access key", group: "fuel", secret: true, placeholder: "optional — testnet only" },
  { key: "NANSEN_API_KEY", label: "Nansen API key", why: "Smart-Money desk depth — funds' real ETH netflow", group: "fuel", secret: true, placeholder: "optional" },
  { key: "ELFA_API_KEY", label: "Elfa API key", why: "Smart-Social desk — narrative / mindshare from smart accounts", group: "fuel", secret: true, placeholder: "optional" },
  { key: "NEARBLOCKS_API_KEY", label: "NearBlocks API key", why: "On-chain ledger — NearBlocks API v3 reads (optional, free tier works)", group: "fuel", secret: true, placeholder: "optional" },
];

export const GROUPS: Array<{ id: Cred["group"]; title: string; sub: string }> = [
  { id: "guards", title: "GUARDS", sub: "how it runs" },
  { id: "fuel", title: "FUEL LINES", sub: "LLM, executor, execution + optional power-ups" },
];

/** the Groq rotation pool is entered as ten slots and stored under one name */
export const GROQ_KEY = "GROQ_API_KEY";
