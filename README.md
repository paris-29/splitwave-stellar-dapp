# Splitwave

Splitwave is a Stellar testnet split-bill dApp for Level 1 White Belt. It connects a Freighter wallet, shows the connected account's XLM balance, funds the testnet account with Friendbot, calculates group split amounts, and sends a real XLM payment on Stellar testnet.

## What it does

- Connect and disconnect Freighter.
- Enforce Stellar `TESTNET` for funding and payments.
- Fetch and display the connected wallet's native XLM balance.
- Add local groups and friends for a bill split.
- Copy local split request messages.
- Build, sign, and submit an XLM payment through Freighter.
- Show success/failure feedback and the transaction hash.

## How the Web3 flow works

The app never sees a secret key. Freighter owns the account keys. Splitwave asks Freighter for the public wallet address, loads that account from Horizon, builds a testnet payment transaction, sends the unsigned transaction XDR to Freighter, and submits the signed XDR back to Stellar Horizon.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL from Vite, install the Freighter browser extension, switch Freighter to `TESTNET`, connect, and use `Fund testnet` if the account has no testnet XLM.

## Build

```bash
npm run build
```

## Publish and deploy

The repo includes a GitHub Pages workflow. After GitHub auth is fixed, publish it with:

```bash
gh repo create splitwave-stellar-dapp --public --source=. --remote=origin --push
```

In the GitHub repo settings, set Pages to deploy from GitHub Actions. Every push to `main` will build and deploy the app.

## Screenshots

Add final screenshots after running the app with Freighter:

- `docs/screenshots/wallet-connected.png` - wallet connected state.
- `docs/screenshots/balance-displayed.png` - XLM balance displayed.
- `docs/screenshots/transaction-success.png` - successful testnet transaction.
- `docs/screenshots/transaction-result.png` - transaction hash/result shown in the UI.

## Notes

Friend and group requests are local UI records for this beginner project. A production request inbox would need a backend, wallet-to-wallet messaging, or a contract/indexer-backed notification flow.
