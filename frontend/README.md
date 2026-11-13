# frontend

> Next.js dApp for **HeliQuant**, an autonomous trading firm on **NEAR** testnet.

## Live demo

🌐 **Deployed**: https://heliquant-near.vercel.app (Vercel)

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing — the firm as an engine, the desks, the live decision log, honest status |
| `/app` | The floor — live 3D decision floor: desks → debate → PM, with an inspect panel |
| `/campaign` | The grid — the owner's live campaign: open positions as lanes from stop to target |
| `/trade` | Your floor — the same grid read from YOUR connected engine (gated until you connect one) |
| `/carry` | The edge — delta-neutral funding-carry monitor, live dials from Bitget funding |
| `/learning` | Tuning bay — desk reliability weights, candidate edges, throttles |
| `/agents` | The crew — the 13 registered agents (NEP-171) with on-chain reputation |
| `/ledger` | Trade ledger + the live on-chain tape of `core` (via the agent's `/onchain`) |
| `/proof` | TEE proof — every desk call signed inside NEAR AI Cloud, verifiable |
| `/performance` | The dyno — Sharpe / Sortino / drawdown on the real ledger |
| `/whales` | Telemetry — Hyperliquid top-PnL whales and the Bitget crowd |
| `/assets` | Dyno bays — per-asset pattern gauge, carry read and edge-lab verdict |
| `/hire` | Hire flow: faucet (mUSDC), hire the firm (`ft_transfer_call`), jobs, settle, claim payout |
| `/firms/heliquant` | License — the firm's on-chain identity, contracts and service history |
| `/profile` | Your pit — engine health, wallet, and the credential names on your engine |
| `/onboarding` | Register — connect your own engine, sign once with the wallet of its `HQ_OWNER_ACCOUNT` (NEP-413), and send your keys straight to it (no custody) |

## Quickstart

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # production build
pnpm start        # serve production build
```

## Configuration

Copy `.env.example` to `.env.local` and fill it. The NEAR values come from
`contracts/deployments/near_testnet.json`; nothing here is a secret (all are public `NEXT_PUBLIC_*`).

```bash
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_NEAR_RPC_URL=<testnet RPC URL>
NEXT_PUBLIC_NEAR_CORE_CONTRACT=core.<parent>.testnet
NEXT_PUBLIC_NEAR_TOKEN_CONTRACT=musdc.<parent>.testnet
NEXT_PUBLIC_NEAR_BASE_TOKEN=wrap.testnet
NEXT_PUBLIC_NEAR_FIRM_TOKEN_ID=1
NEXT_PUBLIC_NEAR_DEX_CONTRACT=ref-finance-101.testnet
NEXT_PUBLIC_NEAR_DEX_POOL_ID=<pool id>
NEXT_PUBLIC_NEAR_ALLORA_CONTRACT=allora.<parent>.testnet
NEXT_PUBLIC_NEAR_EXECUTOR_ACCOUNT=<executor account>
NEXT_PUBLIC_SUPABASE_URL=...          NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_AGENT_URL=https://<your agent>.up.railway.app
NEXT_PUBLIC_AGENT_MARKET_URL=<Agent Market listing URL>
NEXT_PUBLIC_FINDINGS_URL=<link to Findings/FINDINGS.md>
NEXT_PUBLIC_SITE_URL=https://<your site>.vercel.app
```

There are no built-in fallback values: with a missing variable the feature that needs it stays off.

The brand images (`public/brand/`) are not part of this repository; without them the logo slots render empty.

## Stack

- **Next.js 16** (App Router, Server Components)
- **Tailwind v4** (utility-first styling)
- **near-connect-hooks 1.1.6** (NEAR wallet connection and transactions)
- **Supabase** (fallback read of the decision table when the agent is unreachable)

## Notable design

- Server components for SEO + static rendering of landing content; client islands only where a wallet is involved.
- `src/lib/contracts.ts` — env, types, contract methods and NearBlocks links.
- `src/lib/near.ts` — read-only RPC views (`viewCall`, `jobsByClient`, `dexReturn`, …) with `optimistic` finality.
- `src/lib/hire-logic.ts` — pure logic (gas, `min_out`, `job_rejected` parsing, wallet error classes).
- Hire results are read from contract events (`job_created`, `job_rejected`); if no event is found, the job count before
  and after is compared.
- Settle takes `min_out` from the Rhea pool's `get_return` (1% tolerance); if the quote fails, the button does not send.

## License

MIT
