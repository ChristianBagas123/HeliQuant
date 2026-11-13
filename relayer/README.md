# relayer

> Off-chain Allora Network → NEAR on-chain prediction bridge for **HeliQuant**.

## What it does

Allora publishes its predictions on its own chain. They are not queryable from a NEAR contract. The relayer copies one topic into the `allora` contract on NEAR testnet:

1. **Pulls** the latest BTC/USD 8h price prediction (Allora topic 14) straight from the Allora chain through its public LCD (`https://allora-api.mainnet.allora.network`, `emissions/v10/latest_network_inferences/14`), via `agents/firm/allora_lcd.py`. It takes `combined_value` (the network's combined inference) and uses the time of `inference_block_height` as the timestamp. No API key and no cost.
2. **Skips** the run if the contract already holds an inference with the same or a newer timestamp.
3. **Submits** `submit_inference` from the relayer account (`relayer.heliquant.testnet`). Its access key is limited by the protocol to that one method on the `allora` contract.
4. **Verifies** by reading `get_latest_inference(14)` back and comparing value and timestamp.

There is no signature scheme in the relayer. The contract only accepts calls from accounts registered with `set_trusted_relayer`, and the relayer key cannot call anything else.

The Macro desk of the agent reads Allora directly through `agents/firm/allora_client.py`, not through this contract. The contract is a public record of what the relayer published.

## Behaviour worth knowing

- The contract rejects data older than its freshness window (1800 s) and data that is not newer than what it holds. If Allora's timestamp is older than the window, the relayer sends the current time instead and prints a warning. The on-chain timestamp then shows when the relayer submitted, not when Allora computed the value.
- `confidence_bps` is fixed at 7500. The LCD does not return a confidence value.
- Why not the Allora API: `api.allora.network/v2` answers 502, and its replacement (`api.developer.allora.network`) charges per inference call. The contract does not check Allora signatures, so the LCD value is enough.
- Overrides: `ALLORA_LCD_URL` (default mainnet LCD) and `ALLORA_EMISSIONS_NS` (default `emissions/v10`). Allora changes the namespace on chain upgrades; `emissions/v9` already answers 501.
- Exit code is `0` on success or a deliberate skip, `1` on failure (so a cron run is marked failed).
- Private keys are never printed. Output is passed through `near_client.redact`.

## Run once

```bash
# From the repo root. Needs these in .env (or the process environment):
#   NEAR_RELAYER_PRIVATE_KEY  limited key of relayer.heliquant.testnet
#   NEAR_NETWORK=testnet, NEAR_RPC_URL
#   ALLORA_CONTRACT_ID        optional, defaults to contracts/deployments/near_testnet.json
pip install -r relayer/requirements.txt
python relayer/allora_relayer.py
```

## Production

Runs as a Railway cron service every 30 minutes (`*/30 * * * *`), the same as the contract's freshness window. The service builds `relayer/Dockerfile` (cron schedule and restart policy `NEVER` are set on the service, not in a config file). Its build context needs only `relayer/`, `agents/firm/near_client.py`, `agents/firm/allora_lcd.py`, `agents/firm/__init__.py` and `contracts/deployments/near_testnet.json`. Env is filled by `agents/scripts/railway_set_env.py relayer`. See `agents/DEPLOY.md`.

## Files

- `allora_relayer.py` — the relayer.
- `requirements.txt` — dependencies of the relayer only.

## License

MIT
