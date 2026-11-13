# contracts

HeliQuant contracts on NEAR (Rust, `near-sdk` 5.30.1, Rust 1.99.1 pinned by `rust-toolchain.toml`).

| Crate | Role | Deployed? |
|---|---|---|
| `core` | Identity (soulbound NEP-171), reputation, validation credentials, job escrow, vault, anchor | Yes (`core.<parent account>`) |
| `musdc` | Mock USDC (NEP-141, 6 decimals) with a public faucet | Yes, testnet only |
| `allora` | Receives Allora predictions from a trusted relayer | Yes |

## Commands

All run in WSL Ubuntu from the `contracts` folder.

```bash
./scripts/build-wasm.sh
```

`build-wasm.sh` writes `core.wasm`, `musdc.wasm` and `allora.wasm` to `~/hq-wasm` (or `$HQ_WASM_DIR`). The deploy script
reads them from there. The `test-hooks` and `test-layout-v2` features of `core` exist only for test builds and must
never be deployed.

## Deploy to testnet

```bash
./scripts/deploy-testnet.sh --dry      # show the plan
./scripts/deploy-testnet.sh            # run every step (safe to re-run)
```

Reads `NEAR_PARENT_ACCOUNT` and the owner key from the root `.env`. Steps: preflight, accounts, deploy, register
tokens, Rhea pool, agents (firm + 12 desks), limited keys, allora, write files, smoke test. It writes
`deployments/near_testnet.json` and `agents/data/agent_registry.json`, and filters private keys from all output.
The logic lives in `scripts/deploy_testnet.py`; the `.sh` file is only a launcher.

## Rules

- The `core` storage prefixes use fixed `#[repr(u8)]` discriminants. Never reuse one for another layout.
- Any state layout change must go through `migrate`. Never run `new` on an account that already has state.
- Panic messages are short English text because they show in the public UI. The list is in `core/src/util.rs` (`msg`).
- One credential costs 157 bytes of storage and one job 423 bytes (measured in the sandbox).
