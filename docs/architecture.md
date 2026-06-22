# Splitwave Production Architecture

## Smart Contracts

`contracts/splitwave_bills` is the primary deployable Soroban contract. It stores bill summaries, per-wallet payment records, and emits contract events for bill changes and payments.

Advanced path:

- `record_payment` records a normal payment and emits `pay`.
- `record_payment_with_rewards` records the payment, invokes an external rewards/audit contract at a supplied contract address, and emits `xpay`.
- The test suite registers a test-only `RewardAudit` contract to prove inter-contract invocation and external state updates.

The deployable contract is still a single artifact, so production deployment remains simple while the cross-contract integration point can target a separately deployed rewards contract later.

## Frontend

The frontend is a Vite + React dApp with Freighter support and optional wallet-kit detection. Contract reads are isolated in `src/hooks/useContractData.ts` and use React Query cache keys for bill summaries and contract events.

Runtime behavior:

- Bill summary reads are cached by contract ID, source address, and bill ID.
- Event reads keep previous data visible while refetching.
- Payment and bill writes perform optimistic cache updates, then refetch chain state.
- Loading skeletons cover initial contract reads.
- Wallet, network, contract ID, invalid amount, rejected request, and insufficient-balance errors surface as user-visible status states.

## CI/CD

`.github/workflows/build.yml` runs:

- `cd contracts/splitwave_bills && cargo test`
- `npm ci`
- `npm test`
- `npm run build`

`.github/workflows/pages.yml` deploys the Vite build to GitHub Pages.

`.github/workflows/contract-deploy.yml` is a manual deployment workflow for the Soroban contract. It expects a funded testnet secret key in the `STELLAR_SOURCE_ACCOUNT` repository secret and uploads the deployment output as a workflow artifact.

## Deployment

Local testnet deployment:

```bash
./scripts/deploy-contract.sh splitwave-yellow
```

CI testnet deployment:

1. Add a funded testnet secret key as `STELLAR_SOURCE_ACCOUNT` in repository secrets.
2. Run the `Deploy Soroban Contract` workflow.
3. Copy the emitted `VITE_SPLITWAVE_CONTRACT_ID` into the frontend deployment environment.

Optional inter-contract rewards path:

```bash
VITE_SPLITWAVE_REWARDS_CONTRACT_ID=C...
```

When that env var, or the Contract screen field, is set to a valid contract ID, payment writes call `record_payment_with_rewards`.
