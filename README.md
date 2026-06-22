# Splitwave Advanced Stellar dApp

[![Build & Test](https://github.com/paris-29/splitwave-stellar-dapp/actions/workflows/build.yml/badge.svg)](https://github.com/paris-29/splitwave-stellar-dapp/actions/workflows/build.yml)

Splitwave turns daily bills into a Stellar testnet bill room. The advanced build adds inter-contract Soroban logic, contract and frontend tests, React Query event streaming, optimistic writes, CI/CD, a manual contract deployment workflow, and production architecture documentation.

Live: https://splitwave-stellar-dapp.pages.dev/

## Advanced Scope

- Inter-contract payment path via `record_payment_with_rewards`.
- 10 automated Rust tests for the Soroban contract.
- 5 automated frontend tests with Vitest.
- React Query contract-read cache in `src/hooks/useContractData.ts`.
- Dashboard skeleton states for summary metrics and live events.
- Optimistic cache updates for bill-goal and payment writes.
- Stale-while-revalidate event cache with background refetch.
- CI/CD workflow at `.github/workflows/build.yml` running `cargo test`, `npm test`, and `npm run build`.
- Manual contract deploy workflow at `.github/workflows/contract-deploy.yml`.
- Production architecture notes in `docs/architecture.md`.
- Submission checklist in `docs/submission/level4-submission.md`.

## Yellow Belt Foundation

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

## Build And Test

```bash
npm test
npm run build
cd contracts/splitwave_bills && cargo test
```

## Smart Contract

The contract stores a bill summary and per-wallet payment records. The advanced test module covers successful bill writes, payment recording, summary reads, contribution reads, invalid target/amount errors, repeated payments, two-wallet contributions, and inter-contract reward calls.

```bash
contracts/splitwave_bills
├── Cargo.toml
└── src/lib.rs
```

Methods:

- `upsert_bill(owner, id, title, target)` writes a bill goal and emits a `bill` event.
- `record_payment(bill_id, from, amount, memo)` records a payment amount and emits a `pay` event.
- `record_payment_with_rewards(bill_id, from, amount, memo, rewards_contract)` records a payment, calls an external `award` contract function, and emits an `xpay` event.
- `summary(bill_id)` reads current bill state.
- `contribution(bill_id, from)` reads one wallet's contribution.

Run contract tests:

```bash
cd contracts/splitwave_bills
cargo test
```

## Frontend Caching

Contract reads are wrapped with `@tanstack/react-query` hooks. Bill summaries and events use stable cache keys, visible skeletons while initial reads load, background refetching, and cached data remains visible while events revalidate.

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
VITE_SPLITWAVE_REWARDS_CONTRACT_ID=
```

Restart `npm run dev` after changing env vars. The contract ID can also be pasted into the Contract screen.

For GitHub Actions deployment, add a funded testnet secret key as the `STELLAR_SOURCE_ACCOUNT` repository secret and run the `Deploy Soroban Contract` workflow.

## Submission Fields

- Public repo: `https://github.com/paris-29/splitwave-stellar-dapp`
- CI workflow: `https://github.com/paris-29/splitwave-stellar-dapp/actions/workflows/build.yml`
- Contract deploy workflow: `https://github.com/paris-29/splitwave-stellar-dapp/actions/workflows/contract-deploy.yml`
- Contract address: `CAOLLM2HMYVVFNKBFJBQNZ27I6OVANUJFX5JKVVFYVHUEO2KGDYVEBBW`
- Contract deployment tx: `d0dcd222d991455156809a77892108d8c7bee7835e02effc1da2c6b13969c725`
- Contract call tx: `60e78c05947b02a8fb80839a94a5e2123009a5a0af0ac761970714956a50185b`
- Payment event call tx: `1643c4d44c7f7e2af981e4cf5970abcaf0c365260557a773bf6a77e781f10af9`
- Wallet options screenshot: `docs/screenshots/wallet-options-yellow-belt.png`.
- Mobile responsive screenshot: `docs/screenshots/mobile-responsive-level4.png`.
- Test output screenshot: `docs/screenshots/test-output-level4.png`.
- Demo video artifact: `docs/demo/level4-demo.mp4`.
- Live demo: `https://splitwave-stellar-dapp.pages.dev/`
- Architecture: `docs/architecture.md`
- Submission checklist: `docs/submission/level4-submission.md`

## Notes

The app does not handle private keys. Wallets sign XDR from the browser wallet layer; the frontend submits signed Soroban transactions through Stellar RPC and polls for final status.
