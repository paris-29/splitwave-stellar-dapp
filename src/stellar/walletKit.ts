import {
  getAddress as freighterGetAddress,
  getNetworkDetails as freighterGetNetworkDetails,
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  signTransaction as freighterSignTransaction,
} from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

const KIT_PACKAGE = "@creit.tech/stellar-wallets-kit";
const FREIGHTER_DETECTION_TIMEOUT_MS = 6500;
const WALLET_APPROVAL_TIMEOUT_MS = 120000;

export type WalletId = "freighter" | "lobstr" | "hana" | "xbull";
export type WalletErrorCode =
  | "wallet_not_found"
  | "rejected"
  | "insufficient_balance"
  | "network"
  | "unknown";

export type WalletOption = {
  id: WalletId;
  name: string;
  accent: string;
  installed: boolean | null;
  description: string;
};

export type WalletConnection = {
  id: WalletId;
  name: string;
  address: string;
};

type FreighterResult<T> = { ok: true; value: T } | { ok: false; message: string };

type ExternalKit = {
  kit: {
    setWallet?: (id: string) => void;
    getAddress?: () => Promise<{ address?: string; publicKey?: string; error?: { message: string } }>;
    signTransaction?: (
      xdr: string,
      options: { networkPassphrase: string; address: string },
    ) => Promise<{ signedTxXdr?: string; error?: { message: string } }>;
  };
};

let externalKitPromise: Promise<ExternalKit | null> | null = null;

export const WALLET_OPTIONS: WalletOption[] = [
  {
    id: "freighter",
    name: "Freighter",
    accent: "#b6ff3b",
    installed: null,
    description: "Extension signer",
  },
  {
    id: "lobstr",
    name: "LOBSTR",
    accent: "#00f5d4",
    installed: null,
    description: "Mobile wallet",
  },
  {
    id: "hana",
    name: "Hana",
    accent: "#ff2e93",
    installed: null,
    description: "Browser wallet",
  },
  {
    id: "xbull",
    name: "xBull",
    accent: "#ffd166",
    installed: null,
    description: "Power wallet",
  },
];

export class WalletKitError extends Error {
  code: WalletErrorCode;

  constructor(code: WalletErrorCode, message: string) {
    super(message);
    this.name = "WalletKitError";
    this.code = code;
  }
}

function classifyWalletMessage(message: string): WalletErrorCode {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("not installed") ||
    normalized.includes("not found") ||
    normalized.includes("missing")
  ) {
    return "wallet_not_found";
  }
  if (
    normalized.includes("reject") ||
    normalized.includes("declin") ||
    normalized.includes("cancel")
  ) {
    return "rejected";
  }
  if (normalized.includes("insufficient") || normalized.includes("underfunded")) {
    return "insufficient_balance";
  }
  if (normalized.includes("network")) return "network";
  return "unknown";
}

export function toWalletKitError(error: unknown, fallback: string) {
  if (error instanceof WalletKitError) return error;
  const message = error instanceof Error ? error.message : fallback;
  return new WalletKitError(classifyWalletMessage(message), message || fallback);
}

async function withTimeout<T>(
  action: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });

    return await Promise.race([action(), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function safeFreighterCall<T>(
  action: () => Promise<T>,
  fallbackMessage: string,
  timeoutMs = FREIGHTER_DETECTION_TIMEOUT_MS,
): Promise<FreighterResult<T>> {
  try {
    return {
      ok: true,
      value: await withTimeout(
        action,
        timeoutMs,
        "Wallet request timed out. Unlock the wallet and try again.",
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    return { ok: false, message: message || fallbackMessage };
  }
}

async function loadExternalKit() {
  if (!externalKitPromise) {
    externalKitPromise = (async () => {
      try {
        const kitModuleName = KIT_PACKAGE;
        const mod = await import(/* @vite-ignore */ kitModuleName);
        const KitConstructor = mod.StellarWalletsKit;
        if (!KitConstructor) return null;

        const modules =
          typeof mod.allowAllModules === "function" ? mod.allowAllModules() : [];
        const network = mod.WalletNetwork?.TESTNET ?? "TESTNET";

        return {
          kit: new KitConstructor({
            network,
            selectedWalletId: mod.FREIGHTER_ID ?? "freighter",
            modules,
          }),
        } satisfies ExternalKit;
      } catch {
        return null;
      }
    })();
  }

  return externalKitPromise;
}

export async function getWalletOptions(): Promise<WalletOption[]> {
  const [freighter, external] = await Promise.all([
    safeFreighterCall(
      () => freighterIsConnected(),
      "Could not detect Freighter.",
      FREIGHTER_DETECTION_TIMEOUT_MS,
    ),
    loadExternalKit(),
  ]);

  const freighterInstalled =
    freighter.ok && !freighter.value.error && freighter.value.isConnected;

  return WALLET_OPTIONS.map((wallet) => ({
    ...wallet,
    installed:
      wallet.id === "freighter"
        ? freighterInstalled
        : external
          ? true
          : null,
  }));
}

export async function getWalletNetwork() {
  const result = await safeFreighterCall(
    () => freighterGetNetworkDetails(),
    "Could not read wallet network.",
  );

  if (!result.ok) throw new WalletKitError("network", result.message);
  if (result.value.error) {
    throw new WalletKitError("network", result.value.error.message);
  }

  return result.value.network || "UNKNOWN";
}

export async function connectWallet(wallet: WalletOption): Promise<WalletConnection> {
  if (wallet.id !== "freighter") {
    const external = await loadExternalKit();
    if (!external?.kit.getAddress) {
      throw new WalletKitError(
        "wallet_not_found",
        `${wallet.name} requires StellarWalletsKit. Install ${KIT_PACKAGE} and refresh this app.`,
      );
    }

    external.kit.setWallet?.(wallet.id);
    const response = await external.kit.getAddress();
    if (response.error) {
      throw new WalletKitError(
        classifyWalletMessage(response.error.message),
        response.error.message,
      );
    }

    const address = response.address || response.publicKey || "";
    if (!address) {
      throw new WalletKitError("rejected", `${wallet.name} did not return an address.`);
    }

    return { id: wallet.id, name: wallet.name, address };
  }

  const installed = await safeFreighterCall(
    () => freighterIsConnected(),
    "Could not check whether Freighter is installed.",
  );
  if (!installed.ok) throw new WalletKitError("wallet_not_found", installed.message);
  if (installed.value.error || !installed.value.isConnected) {
    throw new WalletKitError(
      "wallet_not_found",
      "Freighter is not installed or is disabled.",
    );
  }

  const access = await safeFreighterCall(
    () => freighterRequestAccess(),
    "Freighter did not approve access.",
    WALLET_APPROVAL_TIMEOUT_MS,
  );
  if (!access.ok) {
    throw new WalletKitError(classifyWalletMessage(access.message), access.message);
  }
  if (access.value.error) {
    throw new WalletKitError(
      classifyWalletMessage(access.value.error.message),
      access.value.error.message,
    );
  }

  return {
    id: "freighter",
    name: "Freighter",
    address: access.value.address,
  };
}

export async function restoreFreighterAddress() {
  const address = await safeFreighterCall(
    () => freighterGetAddress(),
    "Could not read the active Freighter address.",
  );

  if (!address.ok || address.value.error) return "";
  return address.value.address || "";
}

export async function signWalletTransaction(
  connection: WalletConnection,
  xdr: string,
) {
  if (connection.id !== "freighter") {
    const external = await loadExternalKit();
    if (!external?.kit.signTransaction) {
      throw new WalletKitError(
        "wallet_not_found",
        `${connection.name} signing requires StellarWalletsKit.`,
      );
    }

    external.kit.setWallet?.(connection.id);
    const result = await external.kit.signTransaction(xdr, {
      networkPassphrase: Networks.TESTNET,
      address: connection.address,
    });
    if (result.error) {
      throw new WalletKitError(
        classifyWalletMessage(result.error.message),
        result.error.message,
      );
    }
    if (!result.signedTxXdr) {
      throw new WalletKitError("rejected", `${connection.name} did not sign.`);
    }
    return result.signedTxXdr;
  }

  const result = await safeFreighterCall(
    () =>
      freighterSignTransaction(xdr, {
        networkPassphrase: Networks.TESTNET,
        address: connection.address,
      }),
    "Freighter could not sign the transaction.",
    WALLET_APPROVAL_TIMEOUT_MS,
  );

  if (!result.ok) {
    throw new WalletKitError(classifyWalletMessage(result.message), result.message);
  }
  if (result.value.error) {
    throw new WalletKitError(
      classifyWalletMessage(result.value.error.message),
      result.value.error.message,
    );
  }

  return result.value.signedTxXdr;
}
