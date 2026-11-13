#!/usr/bin/env bash
# Build semua wasm ke $HQ_WASM_DIR (bawaan ~/hq-wasm). Jalankan di WSL Ubuntu dari folder contracts.
#   core.wasm        build produksi (dipakai deploy dan tes)
#   core-hooks.wasm  core + fitur test-hooks (hanya tes sandbox, jangan di-deploy)
#   core-v2.wasm     core + fitur test-layout-v2 (hanya tes upgrade, jangan di-deploy)
#   musdc.wasm, allora.wasm, mock-dex.wasm (core-hooks, core-v2 dan mock-dex hanya kalau folder tes ada)
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/cargo-target/heliquant}"
OUT="${HQ_WASM_DIR:-$HOME/hq-wasm}"
mkdir -p "$OUT"

build() { # crate_dir wasm_name out_name [features]
  local dir="$1" name="$2" out="$3" feat="${4:-}"
  (cd "$dir" && if [ -n "$feat" ]; then
      cargo near build non-reproducible-wasm --features "$feat"
    else
      cargo near build non-reproducible-wasm
    fi) >/dev/null
  cp "$CARGO_TARGET_DIR/near/$name/$name.wasm" "$OUT/$out.wasm"
  printf '%-16s %8d bytes  sha256 %s\n' "$out.wasm" "$(stat -c %s "$OUT/$out.wasm")" "$(sha256sum "$OUT/$out.wasm" | cut -d' ' -f1)"
}

# Wasm khusus tes sandbox hanya dibuild kalau folder tes ada (tidak ikut repo publik)
if [ -d tests ]; then
  build core heliquant_core core-hooks test-hooks
  build core heliquant_core core-v2 test-layout-v2
fi
# core produksi dibuild setelah build berfitur agar target/ tidak tertinggal build fitur
build core heliquant_core core
build musdc heliquant_musdc musdc
build allora heliquant_allora allora
if [ -d mock-dex ]; then
  build mock-dex heliquant_mock_dex mock-dex
fi
