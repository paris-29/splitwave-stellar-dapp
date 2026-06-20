export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
export const TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet";
export const CONTRACT_ID = (
  import.meta.env.VITE_SPLITWAVE_CONTRACT_ID ||
  "CAOLLM2HMYVVFNKBFJBQNZ27I6OVANUJFX5JKVVFYVHUEO2KGDYVEBBW"
).trim();
export const CONTRACT_DEPLOYMENT_TX = (
  import.meta.env.VITE_SPLITWAVE_DEPLOY_TX ||
  "d0dcd222d991455156809a77892108d8c7bee7835e02effc1da2c6b13969c725"
).trim();
export const FREIGHTER_INSTALL_URL =
  "https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk";
