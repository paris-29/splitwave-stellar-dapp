# Level 4 Submission Checklist

## Core Links

- Public repo: `https://github.com/paris-29/splitwave-stellar-dapp`
- Live demo: `https://splitwave-stellar-dapp.pages.dev/`
- CI workflow: `https://github.com/paris-29/splitwave-stellar-dapp/actions/workflows/build.yml`
- Contract deploy workflow: `https://github.com/paris-29/splitwave-stellar-dapp/actions/workflows/contract-deploy.yml`

## Contract Evidence

- Contract address: `CAOLLM2HMYVVFNKBFJBQNZ27I6OVANUJFX5JKVVFYVHUEO2KGDYVEBBW`
- Contract deployment tx: `d0dcd222d991455156809a77892108d8c7bee7835e02effc1da2c6b13969c725`
- Contract interaction tx: `60e78c05947b02a8fb80839a94a5e2123009a5a0af0ac761970714956a50185b`
- Payment event tx: `1643c4d44c7f7e2af981e4cf5970abcaf0c365260557a773bf6a77e781f10af9`

## Local Verification

```bash
cd contracts/splitwave_bills && cargo test
npm test
npm run build
```

Current local results:

- Contract tests: 10 passed
- Frontend tests: 5 passed
- Production build: passed

## Requirement Coverage

- Advanced smart contracts: `record_payment_with_rewards` supports inter-contract rewards/audit calls.
- Inter-contract communication: proven by the test-only `RewardAudit` contract in `contracts/splitwave_bills/src/lib.rs`.
- Event streaming: `fetchContractEvents` plus React Query stale-while-revalidate polling.
- CI/CD: `build.yml`, `pages.yml`, and `contract-deploy.yml`.
- Deployment workflow: `scripts/deploy-contract.sh` plus manual GitHub Action.
- Mobile responsive frontend: responsive CSS breakpoints under `860px` and `540px`.
- Error/loading states: wallet, network, contract, amount, balance, and skeleton states.
- Contract tests: 10 Rust tests.
- Frontend tests: 5 Vitest tests.
- Production architecture: `docs/architecture.md`.
- Documentation: `README.md`, `docs/architecture.md`, and this submission checklist.

## Screenshot Checklist

- Mobile responsive UI: `docs/screenshots/mobile-responsive-level4.png`
- Test output with 3+ passing tests: `docs/screenshots/test-output-level4.png`
- CI/CD pipeline running: capture the `Build & Test` workflow after pushing these commits.

## Demo Video

Record a 1-2 minute walkthrough showing:

- Connect wallet on testnet.
- Contract summary and live events loading.
- Record a payment.
- Show the Contract screen with optional rewards contract support.
- Show GitHub Actions and test output.

Demo video link: `TBD`
