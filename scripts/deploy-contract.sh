#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_NAME="${1:-splitwave-yellow}"
NETWORK="${STELLAR_NETWORK:-testnet}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required. Install it from https://developers.stellar.org/docs/tools/cli" >&2
  exit 1
fi

stellar keys generate --global "$ACCOUNT_NAME" --network "$NETWORK" --fund >/dev/null 2>&1 || true

pushd contracts/splitwave_bills >/dev/null
stellar contract build
CONTRACT_ID="$(
  stellar contract deploy \
    --wasm target/wasm32v1-none/release/splitwave_bills.wasm \
    --source "$ACCOUNT_NAME" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE"
)"
popd >/dev/null

cat <<DEPLOYMENT
VITE_SPLITWAVE_CONTRACT_ID=$CONTRACT_ID
VITE_STELLAR_RPC_URL=$RPC_URL

Contract: https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID
DEPLOYMENT
