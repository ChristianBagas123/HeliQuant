# Deploy HeliQuant to Railway (always-on)

`app.py` runs the autonomous firm in a background loop and exposes live endpoints. Railway-ready
(`Procfile`, `requirements.txt`, `runtime.txt`, `railway.json`). Everything below targets **NEAR testnet**.

## What it does each cycle (default every 30 min)
1. **Self-learning** — re-validates edges on current data and applies graduate/demote on evidence
   (`60_self_learn.py --apply`), then mirrors the edge registry to Supabase `edges_hq`.
   `SELF_LEARN_APPLY=0` switches back to report-only. Registry files live on Railway's ephemeral disk,
   so a redeploy resets them to the repo copy.
2. **Org analysis** — runs the desks, a bull/bear debate and the PM on each asset → a disciplined decision (mostly ABSTAIN).
   Each desk output is sealed on `core` (`record_output`) and the decision is anchored (`anchor`).
   The decision is also written to Supabase `decisions_hq`. Desk stances wait 24h in `hq_state`
   key `desk:pending` (survives redeploys), then are scored into `desk_outcomes_hq`.
3. **(optional) Execution** — only firm-sanctioned ENTERs, and only if `EXECUTE=1` (default OFF, safe).
4. **Campaign floor** — opens and closes small positions on Bitget Demo (when `BITGET_EXECUTE=1`) or on paper.

## Endpoints (Railway gives a public URL)
| path | what |
|---|---|
| `/` | dashboard: cycles, last decision, recent firm decisions |
| `/health` | `ok` (Railway healthcheck, never depends on NEAR) |
| `/health/onchain` | NEAR RPC status, `core` free balance, per-key allowance / cost of a check / failure count |
| `/onchain`, `/agents` | `core` transactions (NearBlocks API v3) and the agent roster with on-chain reputation |
| `/logs` | raw logs, plain text (secret env values redacted) |
| `/status`, `/decisions` | JSON: loop status, recent firm decisions |
| `/run-cycle` | keep-alive and external cycle trigger (GET or HEAD) |
| `/setup-status` | onboarding status: `auth: nep413`, `owner` (`HQ_OWNER_ACCOUNT`), stored credential **names** (never values) |
| `/register/nonce`, `POST /register` | local-engine onboarding only (NEP-413, see `agents-LocalReady/SETUP.md`). Both answer 503 when `HQ_OWNER_ACCOUNT` is empty, which is always the case on Railway |

## Prerequisites
1. Contracts deployed on testnet with your own parent account — see `contracts/README.md`
   (`contracts/scripts/deploy-testnet.sh`). It writes `contracts/deployments/near_testnet.json` and
   `agents/data/agent_registry.json`, and prints the **limited** keys to put in `.env`.
2. A Supabase project (four tables) and your own API keys (Groq, Nansen, Elfa, NearBlocks). Allora needs no key:
   the Macro desk and the relayer read the Allora chain through its public LCD.
3. Bitget **Demo** API key (UTA account, futures). Real money is never used.

## Deploy steps
1. Create a Railway project and a service named `agent`. **Pick one region** (`iad` works for Bitget); the
   free plan rejects multi-region services.
2. Fill the variables from your root `.env` without printing them:
   `python agents/scripts/railway_set_env.py agent` (use `--dry-run` to list names only). It sends the
   executor key and `DESK_KEYS_JSON`, never the owner key (`NEAR_OWNER_PRIVATE_KEY`) or the database password.
   Add `BITGET_EXECUTE=1` by hand when you want demo fills.
3. From `agents/`: `railway up --service agent`. Open the URL → `/health`, `/health/onchain`.
4. Create an uptime monitor (for example UptimeRobot, HTTP, every 5 minutes) to `/run-cycle`.
5. Relayer (cron): see `relayer/README.md`.

## Honest notes
- **Keep `INTERVAL_MIN ≥ 15`** — each org cycle makes 16 LLM calls (steward, 10 desks, 4 debate calls, PM;
  `GET /tee` shows `n_calls`). Too frequent cycles hit Groq rate limits or the NEAR AI budget. 30 min (the
  default) is comfortable.
- **Keys are function-call keys.** A desk key can only call `record_output` on `core`; the executor key
  only `trade`, `recover_job`, `reconcile_job`, `anchor`. When an allowance runs low, `/health/onchain`
  marks the key `low`; the owner tops it up by deleting and re-adding the key.
- **A failed on-chain write never stops a cycle.** The recorder logs the failure and the cycle goes on;
  the failure count shows in `/health/onchain`.
- **`/logs` redacts secret env values**, but treat the URL as semi-public.
- **Cost**: an always-on service plus continuous LLM calls accrue Railway and LLM usage. Tune `INTERVAL_MIN`.

## LLM routing (NEAR AI Cloud, TEE)

With `HQ_PROVIDER=nearai` and `NEARAI_API_KEY`, every LLM call of a cycle runs inside a TEE on NEAR AI Cloud and its
answer is signed (`firm/tee.py`, bundles at `GET /tee`). Models:

| Calls | Model | Reasoning |
|---|---|---|
| Operations, 10 desks | `Qwen/Qwen3.8-27B` | off (`NEARAI_NO_THINK_LIGHT=1`) |
| Debate openings, rebuttals, PM, `pm_signoff` | `z-ai/glm-5.3-flash` (`NEARAI_DEBATE_MODEL`) | on, capped by `thinking_token_budget` |

GLM budgets and answer room (`thinking_token_budget` / `max_tokens`): openings 2000 / 3500 (`NEARAI_THINK_OPEN`),
rebuttals 1500 / 2500 (`NEARAI_THINK_REBUT`), PM 3000 / 4500 (`NEARAI_THINK_PM`), `pm_signoff` 500 / 900
(`NEARAI_THINK_SIGNOFF`). Do not use `enable_thinking: false` on GLM-5.3-flash: the reasoning only moves into the
answer. If a NEAR AI call fails or times out (`NEARAI_TIMEOUT_S`, code default 240 s; the live service uses 360 s
because a GLM PM call was measured at about 200 s) it falls back to Groq
(`HQ_FALLBACK_PROVIDER`) and the call is marked unverified in the bundle.

The 10 desks run in parallel (`NEARAI_DESK_WORKERS`, default 4; per-call wait `NEARAI_DESK_TIMEOUT_S`, default 90 s);
debate and PM stay sequential. Each proof in the bundle records `seconds` (call latency, not part of `proofs_sha256`).

Cost guard: `NEARAI_BUDGET_USD` (default 8) stops NEAR AI calls in code; also set an API key spend limit on the NEAR AI
dashboard. Measured 2026-11-10: about $0.0077 per cycle (720 cycles x 1.2 is about $6.65). A full cycle takes about
6.5-7 minutes with GLM (Agent Market SLA is 10 minutes). `scripts/railway_set_env.py agent` sends these names; it
sets `HQ_PROVIDER=nearai` for production regardless of the local `.env`, and reads the key from
`NEAR_API_KEY_AI_CREDITS` if `NEARAI_API_KEY` is empty.

## Other variables

| Name | Default | Meaning |
|---|---|---|
| `NANSEN_API_KEY`, `NANSEN_API_KEY_2` … `NANSEN_API_KEY_9` | — | Nansen keys, tried in order. A key that answers 401/402/403 (invalid or out of credits) is skipped for 6 hours, one that answers 429 for 60 seconds (`firm/nansen_client.py`) |
| `NANSEN_CACHE_MIN` | `240` | How long a Nansen answer is reused, in minutes. The cache is kept in Supabase `hq_state`, so it survives redeploys |
| `ALLORA_LCD_URL`, `ALLORA_EMISSIONS_NS` | Allora mainnet LCD, current emissions module | Where the Macro desk and the relayer read Allora inferences (`firm/allora_lcd.py`) |
| `NEARBLOCKS_API_KEY` | — | NearBlocks API v3 for `/onchain` (optional) |
| `AGENT_LOOP` | `1` | `0` stops the automatic cycle; `/run-cycle` and Agent Market jobs still work |
| `CAMPAIGN` | `1` | `0` turns the campaign floor off |
| `MARKET_WORKER` | `1` | `0` turns the Agent Market worker off (it also needs `AGENT_MARKET_TOKEN`) |
| `INGEST_TOKEN` | — | Bearer token for `POST /ingest` |
| `HQ_OWNER_ACCOUNT` | — | Local engines only (`agents-LocalReady`): the `.testnet` account allowed to register keys with a NEP-413 signature. Leave it empty on Railway |

## Executor custody (OutLayer Agent Custody, testnet)

By default (`EXECUTOR_MODE=key`) the agent holds `NEAR_EXECUTOR_PRIVATE_KEY`, a function-call key limited to
`trade`, `recover_job`, `reconcile_job` and `anchor` on `core`. With `EXECUTOR_MODE=custody` the agent holds no
executor key at all: transactions are signed inside the OutLayer TEE under a spending policy set by the owner
(`firm/executor_signer.py`). OutLayer custody is alpha, so keep the rollback below ready.

Env (agent service): `EXECUTOR_MODE=custody`, `OUTLAYER_API_KEY` (`wk_...`, secret), `OUTLAYER_WALLET_ACCOUNT`
(64-hex implicit account), optional `OUTLAYER_API_BASE` (default `https://testnet-api.outlayer.ai`). In custody mode
do not send `NEAR_EXECUTOR_PRIVATE_KEY` to Railway. Check `GET /health/onchain`: the executor row shows
`mode: custody`, balance, policy and `frozen`.

Setup (owner steps marked *):
1. Register a wallet: `POST https://testnet-api.outlayer.ai/register` with `{}`. Save `api_key`, `near_account_id`
   and `handoff_url` locally; the key is shown once.
2. * Open `handoff_url` and store the policy: call-only, `core.heliquant.testnet` whitelist, small per-transaction
   limit, at most 120 transactions per hour.
3. * Fund the implicit account with 1 NEAR testnet from `heliquant.testnet`.
4. * `core.set_executor("<implicit account>")` from `heliquant.testnet`. From then on only the custody wallet can
   call `trade` and `anchor`.

Rollback (any step failing, or OutLayer down):
1. Owner: `core.set_executor("executor.heliquant.testnet")`.
2. Set `EXECUTOR_MODE=key`, send `NEAR_EXECUTOR_PRIVATE_KEY` to Railway again (`railway_set_env.py agent`), redeploy.
3. Owner freezes the OutLayer wallet from the dashboard.

## Architecture — cloud-native

Public Bitget data, Bitget Demo orders, NearBlocks, Rhea data (GeckoTerminal) and Groq are reachable from
Railway, so the firm runs end-to-end in the cloud:

```
  CLOUD (Railway, always-on)
  ├─ app.py brain   self-learning + multi-desk org + PM + the live campaign floor
  ├─ data           keyless Bitget mainnet — price / kline / funding / OI  (REFRESH_DATA=1)
  ├─ on-chain       NEAR testnet RPC — record_output / anchor via limited keys
  └─ execution      Bitget DEMO fills (BTC / ETH / XRP / NEAR) when BITGET_EXECUTE=1; other assets paper
```

The `/ingest` connector (set `INGEST_TOKEN`) lets a local engine push supplementary data. It is optional.
