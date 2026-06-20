# Splitwave Yellow Belt

Splitwave turns daily bills into a Stellar testnet bill room. Level 2 adds a multi-wallet connect surface, a Soroban smart contract for bill progress, frontend contract calls, live event polling, and visible transaction stages.

Live: https://splitwave-stellar-dapp.pages.dev/

## Level 2 Scope

- Multi-wallet UI backed by `src/stellar/walletKit.ts`, with Freighter as the working signer and optional `@creit.tech/stellar-wallets-kit` dynamic loading when that package is installed.
- Error routes for wallet not found, rejected wallet requests, and insufficient testnet XLM.
- Soroban contract source at `contracts/splitwave_bills`.
- Frontend contract writes for bill goals and payment records.
- Contract reads for bill summary state.
- RPC event polling for live `bill` and `pay` events.
- Transaction status rail: simulate, sign, submit, pending, success, failed.
- Maximalist Yellow Belt UI with the onboarding line `Web3 into Daily Bills`.

## Run Locally

```bash
npm install
npm run dev
```

Open the Vite URL, connect Freighter on `TESTNET`, and use Friendbot from the wallet screen if the account has no testnet XLM.

## Build

```bash
npm run build
```

## Smart Contract

The contract stores a bill summary and per-wallet payment records.

```bash
contracts/splitwave_bills
├── Cargo.toml
└── src/lib.rs
```

Methods:

- `upsert_bill(owner, id, title, target)` writes a bill goal and emits a `bill` event.
- `record_payment(bill_id, from, amount, memo)` records a payment amount and emits a `pay` event.
- `summary(bill_id)` reads current bill state.
- `contribution(bill_id, from)` reads one wallet's contribution.

## Deploy To Testnet

Install the Stellar CLI, then run:

```bash
./scripts/deploy-contract.sh splitwave-yellow
```

Add the printed values to `.env.local`:

```bash
VITE_SPLITWAVE_CONTRACT_ID=CAOLLM2HMYVVFNKBFJBQNZ27I6OVANUJFX5JKVVFYVHUEO2KGDYVEBBW
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_SPLITWAVE_DEPLOY_TX=d0dcd222d991455156809a77892108d8c7bee7835e02effc1da2c6b13969c725
```

Restart `npm run dev` after changing env vars. The contract ID can also be pasted into the Contract screen.

## Submission Fields

- Public repo: `https://github.com/paris-29/splitwave-stellar-dapp`
- Contract address: `CAOLLM2HMYVVFNKBFJBQNZ27I6OVANUJFX5JKVVFYVHUEO2KGDYVEBBW`
- Contract deployment tx: `d0dcd222d991455156809a77892108d8c7bee7835e02effc1da2c6b13969c725`
- Contract call tx: `60e78c05947b02a8fb80839a94a5e2123009a5a0af0ac761970714956a50185b`
- Payment event call tx: `1643c4d44c7f7e2af981e4cf5970abcaf0c365260557a773bf6a77e781f10af9`
- Wallet options screenshot: `docs/screenshots/wallet-options-yellow-belt.png`.
- Live demo: optional.

## Notes

The app does not handle private keys. Wallets sign XDR from the browser wallet layer; the frontend submits signed Soroban transactions through Stellar RPC and polls for final status.
