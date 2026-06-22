#!/usr/bin/env bash
set -euo pipefail

SOURCE_ACCOUNT="${1:-${STELLAR_SOURCE_ACCOUNT:-splitwave-yellow}}"
NETWORK="${STELLAR_NETWORK:-testnet}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required. Install it from https://developers.stellar.org/docs/tools/cli" >&2
  exit 1
fi

if [[ "$SOURCE_ACCOUNT" != S* ]] && ! stellar keys public-key "$SOURCE_ACCOUNT" >/dev/null 2>&1; then
  stellar keys generate --fund "$SOURCE_ACCOUNT" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE"
fi

pushd contracts/splitwave_bills >/dev/null
stellar contract build --locked
CONTRACT_ID="$(
  stellar contract deploy \
    --wasm target/wasm32v1-none/release/splitwave_bills.wasm \
    --source-account "$SOURCE_ACCOUNT" \
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
