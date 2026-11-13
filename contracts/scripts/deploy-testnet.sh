#!/usr/bin/env bash
# Deploy HeliQuant ke NEAR testnet. Jalankan di WSL Ubuntu dari folder contracts.
#   ./scripts/deploy-testnet.sh [--dry] [langkah ...]
# Langkah: preflight accounts deploy register pool agents keys allora write smoke (bawaan: semuanya).
# Aman dijalankan ulang. Kunci privat disaring dari semua output. Wasm dibuild dulu kalau belum ada.
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/cargo-target/heliquant}"
export HQ_WASM_DIR="${HQ_WASM_DIR:-$HOME/hq-wasm}"
for f in core musdc allora; do
  [ -f "$HQ_WASM_DIR/$f.wasm" ] || { echo "wasm belum ada, build dulu"; ./scripts/build-wasm.sh; break; }
done
exec python3 scripts/deploy_testnet.py "$@"
