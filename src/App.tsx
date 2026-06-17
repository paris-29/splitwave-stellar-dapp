import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  Clipboard,
  Copy,
  Loader2,
  LogOut,
  Plus,
  RefreshCcw,
  Send,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  getAddress as freighterGetAddress,
  getNetworkDetails as freighterGetNetworkDetails,
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  signTransaction as freighterSignTransaction,
} from "@stellar/freighter-api";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import gsap from "gsap";
import coverArt from "./assets/splitwave-cover.svg";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx";
const FREIGHTER_INSTALL_URL =
  "https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk";
const STORAGE_KEY = "splitwave:lastWallet";
const HISTORY_STORAGE_KEY = "splitwave:paymentHistory";
const FREIGHTER_DETECTION_TIMEOUT_MS = 6500;
const FREIGHTER_APPROVAL_TIMEOUT_MS = 120000;

type Friend = {
  id: string;
  name: string;
  wallet: string;
};

type SplitGroup = {
  id: string;
  name: string;
  friendIds: string[];
};

type NoticeType = "idle" | "loading" | "success" | "error" | "warning";

type Notice = {
  type: NoticeType;
  message: string;
  hash?: string;
};

type ScreenTarget = "split" | "payment" | "history" | "wallet";
type TxStage = "idle" | "prepare" | "sign" | "submit" | "sync" | "complete" | "error";

type PaymentHistoryEntry = {
  id: string;
  status: "success" | "error";
  amount: string;
  recipient: string;
  recipientName: string;
  groupName: string;
  billName: string;
  message: string;
  hash?: string;
  createdAt: string;
};

type FreighterResult<T> = { ok: true; value: T } | { ok: false; message: string };

const horizon = new Horizon.Server(HORIZON_URL);
const SCREEN_TARGETS: ScreenTarget[] = ["split", "payment", "history", "wallet"];

function shortKey(key: string) {
  if (!key) return "";
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

function isValidPublicKey(value: string) {
  return StrKey.isValidEd25519PublicKey(value.trim());
}

function formatXlm(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(7).replace(/\.?0+$/, "");
}

function formatBalance(balance: string | null) {
  if (!balance) return "0.0000000";
  const value = Number(balance);
  if (!Number.isFinite(value)) return balance;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isScreenTarget(value: string): value is ScreenTarget {
  return SCREEN_TARGETS.includes(value as ScreenTarget);
}

function readInitialScreen(): ScreenTarget {
  const hash = window.location.hash.replace("#", "");
  return isScreenTarget(hash) ? hash : "split";
}

function isPaymentHistoryEntry(value: unknown): value is PaymentHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PaymentHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    (entry.status === "success" || entry.status === "error") &&
    typeof entry.amount === "string" &&
    typeof entry.recipient === "string" &&
    typeof entry.recipientName === "string" &&
    typeof entry.groupName === "string" &&
    typeof entry.billName === "string" &&
    typeof entry.message === "string" &&
    typeof entry.createdAt === "string"
  );
}

function readPaymentHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isPaymentHistoryEntry) : [];
  } catch {
    return [];
  }
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      response?: {
        data?: {
          title?: string;
          detail?: string;
          extras?: {
            result_codes?: unknown;
          };
        };
      };
      message?: string;
    };
    const data = candidate.response?.data;
    if (data?.extras?.result_codes) {
      return `${data.title ?? "Transaction failed"}: ${JSON.stringify(
        data.extras.result_codes,
      )}`;
    }
    if (data?.detail) return data.detail;
    if (candidate.message) return candidate.message;
  }
  return "Something went wrong.";
}

function freighterErrorMessage(error: unknown) {
  const message = errorMessage(error);
  if (message.includes("reading 'switch'") || message.includes('reading "switch"')) {
    return "Freighter could not answer this request. Make sure the extension is enabled, refresh this page, and try again.";
  }
  if (message.toLowerCase().includes("user declined")) {
    return "Freighter request was rejected.";
  }
  return message;
}

async function safeFreighterCall<T>(
  action: () => Promise<T>,
  fallbackMessage: string,
  options: {
    timeoutMs?: number;
    timeoutMessage?: string;
  } = {},
): Promise<FreighterResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const actionPromise = action();
    if (!options.timeoutMs) {
      return { ok: true, value: await actionPromise };
    }

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            options.timeoutMessage ??
              "Freighter is taking longer than expected. Open or unlock the extension, then try again.",
          ),
        );
      }, options.timeoutMs);
    });

    return { ok: true, value: await Promise.race([actionPromise, timeout]) };
  } catch (error) {
    const message = freighterErrorMessage(error);
    return {
      ok: false,
      message: message === "Something went wrong." ? fallbackMessage : message,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function App() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLElement | null>(null);
  const balanceValueRef = useRef<HTMLSpanElement | null>(null);
  const previousBalanceRef = useRef<string | null>(null);
  const txStageResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [networkName, setNetworkName] = useState("TESTNET");
  const [balance, setBalance] = useState<string | null>(null);
  const [walletNotice, setWalletNotice] = useState<Notice>({
    type: "idle",
    message: "Wallet disconnected",
  });
  const [transactionNotice, setTransactionNotice] = useState<Notice>({
    type: "idle",
    message: "No transaction yet",
  });
  const [freighterInstalled, setFreighterInstalled] = useState<boolean | null>(
    null,
  );
  const [isWalletBusy, setIsWalletBusy] = useState(false);
  const [isTxBusy, setIsTxBusy] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newFriendName, setNewFriendName] = useState("");
  const [newFriendWallet, setNewFriendWallet] = useState("");
  const [billTitle, setBillTitle] = useState("");
  const [billTotal, setBillTotal] = useState("");
  const [payer, setPayer] = useState("friend");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [copiedRequestId, setCopiedRequestId] = useState("");
  const [activeScreen, setActiveScreen] = useState<ScreenTarget>(readInitialScreen);
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryEntry[]>(
    readPaymentHistory,
  );

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId),
    [activeGroupId, groups],
  );

  const groupFriends = useMemo(() => {
    if (!activeGroup) return [];
    const members = new Set(activeGroup.friendIds);
    return friends.filter((friend) => members.has(friend.id));
  }, [activeGroup, friends]);

  const billAmount = Number(billTotal);
  const participantCount = groupFriends.length + 1;
  const splitShare = Number.isFinite(billAmount) && billAmount > 0
    ? billAmount / participantCount
    : 0;
  const splitShareText = formatXlm(splitShare);
  const activeGroupName = activeGroup?.name ?? "Create a group";
  const billName = billTitle.trim() || "New split";
  const connected = Boolean(publicKey);
  const onTestnet = networkName === "TESTNET";
  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function railButtonClass(target: ScreenTarget) {
    return activeScreen === target ? "rail-button active" : "rail-button";
  }

  function openScreen(target: ScreenTarget) {
    setActiveScreen(target);
    window.history.replaceState(null, "", `#${target}`);
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  async function refreshNetworkAndBalance(address = publicKey) {
    if (!address) return;
    try {
      const detailsResult = await safeFreighterCall(
        () => freighterGetNetworkDetails(),
        "Could not read the selected Freighter network.",
        {
          timeoutMs: FREIGHTER_DETECTION_TIMEOUT_MS,
          timeoutMessage:
            "Freighter did not return network details. Unlock the extension, refresh, and try again.",
        },
      );
      if (!detailsResult.ok) {
        setWalletNotice({ type: "warning", message: detailsResult.message });
        return;
      }

      const details = detailsResult.value;
      if (details.error) throw new Error(details.error.message);
      setNetworkName(details.network || "UNKNOWN");

      if (details.network !== "TESTNET") {
        setWalletNotice({
          type: "warning",
          message: "Switch Freighter to TESTNET before funding or sending.",
        });
        setBalance(null);
        return;
      }

      const account = await horizon.loadAccount(address);
      const nativeBalance = account.balances.find(
        (entry) => entry.asset_type === "native",
      );
      setBalance(nativeBalance?.balance ?? "0");
      setWalletNotice({
        type: "success",
        message: "Wallet connected on Stellar testnet.",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.toLowerCase().includes("not found")) {
        setBalance("0");
        setWalletNotice({
          type: "warning",
          message: "Wallet connected, but this testnet account is not funded.",
        });
        return;
      }
      setWalletNotice({ type: "error", message });
    }
  }

  async function restoreWallet() {
    setIsWalletBusy(true);
    try {
      const installedResult = await safeFreighterCall(
        () => freighterIsConnected(),
        "Could not check whether Freighter is installed.",
        {
          timeoutMs: FREIGHTER_DETECTION_TIMEOUT_MS,
          timeoutMessage:
            "Freighter did not answer the install check. Unlock the extension or refresh this page.",
        },
      );
      if (!installedResult.ok) {
        setFreighterInstalled(null);
        setWalletNotice({
          type: "warning",
          message: installedResult.message,
        });
        return;
      }

      const installed = installedResult.value;
      if (installed.error || !installed.isConnected) {
        setFreighterInstalled(false);
        setWalletNotice({
          type: "warning",
          message: "Install Freighter to connect a Stellar wallet.",
        });
        return;
      }
      setFreighterInstalled(true);

      const addressRequest = await safeFreighterCall(
        () => freighterGetAddress(),
        "Could not read your Freighter address.",
        {
          timeoutMs: FREIGHTER_DETECTION_TIMEOUT_MS,
          timeoutMessage:
            "Freighter did not return an address. Open the extension and try connecting again.",
        },
      );
      if (!addressRequest.ok) {
        setWalletNotice({ type: "warning", message: addressRequest.message });
        return;
      }

      const addressResult = addressRequest.value;
      const remembered = localStorage.getItem(STORAGE_KEY);
      const address = addressResult.address || remembered || "";

      if (address) {
        setPublicKey(address);
        await refreshNetworkAndBalance(address);
      }
    } catch {
      setFreighterInstalled(false);
      setWalletNotice({
        type: "warning",
        message: "Install Freighter to connect a Stellar wallet.",
      });
    } finally {
      setIsWalletBusy(false);
    }
  }

  async function connectWallet() {
    setIsWalletBusy(true);
    setWalletNotice({ type: "loading", message: "Waiting for Freighter..." });
    try {
      const installedResult = await safeFreighterCall(
        () => freighterIsConnected(),
        "Could not check whether Freighter is installed.",
        {
          timeoutMs: FREIGHTER_DETECTION_TIMEOUT_MS,
          timeoutMessage:
            "Freighter did not answer the install check. Unlock the extension or refresh this page.",
        },
      );
      if (!installedResult.ok) {
        setFreighterInstalled(null);
        setWalletNotice({
          type: "warning",
          message: installedResult.message,
        });
        return;
      }

      const installed = installedResult.value;
      if (installed.error || !installed.isConnected) {
        setFreighterInstalled(false);
        setWalletNotice({
          type: "warning",
          message: "Freighter is not installed. Install it, then refresh this page.",
        });
        return;
      }
      setFreighterInstalled(true);

      const accessResult = await safeFreighterCall(
        () => freighterRequestAccess(),
        "Could not request access from Freighter.",
        {
          timeoutMs: FREIGHTER_APPROVAL_TIMEOUT_MS,
          timeoutMessage:
            "Freighter did not approve access in time. Open or unlock the extension and approve the request.",
        },
      );
      if (!accessResult.ok) {
        setWalletNotice({ type: "warning", message: accessResult.message });
        return;
      }

      const access = accessResult.value;
      if (access.error) throw new Error(access.error.message);

      setPublicKey(access.address);
      localStorage.setItem(STORAGE_KEY, access.address);
      await refreshNetworkAndBalance(access.address);
    } catch (error) {
      setWalletNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setIsWalletBusy(false);
    }
  }

  function disconnectWallet() {
    setPublicKey("");
    setBalance(null);
    setRecipientAddress("");
    setSelectedRecipientId("");
    localStorage.removeItem(STORAGE_KEY);
    setWalletNotice({ type: "idle", message: "Wallet disconnected" });
    setTransactionNotice({ type: "idle", message: "No transaction yet" });
  }

  async function fundWallet() {
    if (!publicKey) return;
    setIsWalletBusy(true);
    setWalletNotice({ type: "loading", message: "Requesting testnet XLM..." });
    try {
      await horizon.friendbot(publicKey).call();
      await refreshNetworkAndBalance(publicKey);
      setWalletNotice({
        type: "success",
        message: "Testnet account funded with Friendbot.",
      });
    } catch (error) {
      setWalletNotice({
        type: "warning",
        message: `${errorMessage(error)} Refreshing balance now.`,
      });
      await refreshNetworkAndBalance(publicKey);
    } finally {
      setIsWalletBusy(false);
    }
  }

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    const group: SplitGroup = {
      id: createId("g"),
      name,
      friendIds: [],
    };
    setGroups((current) => [...current, group]);
    setActiveGroupId(group.id);
    setNewGroupName("");
  }

  function addFriend() {
    const name = newFriendName.trim();
    const wallet = newFriendWallet.trim();
    if (!name) return;
    if (!activeGroup) {
      setTransactionNotice({
        type: "warning",
        message: "Create a group before adding friends.",
      });
      return;
    }
    if (wallet && !isValidPublicKey(wallet)) {
      setTransactionNotice({
        type: "error",
        message: "Friend wallet must be a valid Stellar public key.",
      });
      return;
    }

    const friend: Friend = {
      id: createId("f"),
      name,
      wallet,
    };
    setFriends((current) => [...current, friend]);
    setGroups((current) =>
      current.map((group) =>
        group.id === activeGroupId
          ? { ...group, friendIds: [...group.friendIds, friend.id] }
          : group,
      ),
    );
    setNewFriendName("");
    setNewFriendWallet("");
  }

  function removeFriend(friendId: string) {
    setGroups((current) =>
      current.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              friendIds: group.friendIds.filter((id) => id !== friendId),
            }
          : group,
      ),
    );
    if (selectedRecipientId === friendId) {
      setSelectedRecipientId("");
      setRecipientAddress("");
    }
  }

  function updateFriendWallet(friendId: string, wallet: string) {
    setFriends((current) =>
      current.map((friend) =>
        friend.id === friendId ? { ...friend, wallet } : friend,
      ),
    );
    if (selectedRecipientId === friendId) setRecipientAddress(wallet);
  }

  function selectRecipient(friendId: string) {
    setSelectedRecipientId(friendId);
    const friend = friends.find((item) => item.id === friendId);
    setRecipientAddress(friend?.wallet ?? "");
  }

  async function copyRequest(friend: Friend) {
    const message = `${friend.name} owes ${splitShareText} XLM for ${billName} in ${activeGroupName}.`;
    await navigator.clipboard.writeText(message);
    setCopiedRequestId(friend.id);
    window.setTimeout(() => setCopiedRequestId(""), 1600);
  }

  function pushPaymentHistory(
    entry: Omit<PaymentHistoryEntry, "id" | "createdAt">,
  ) {
    setPaymentHistory((current) => [
      {
        ...entry,
        id: createId("tx"),
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 24));
  }

  function finishTxStage(stage: Extract<TxStage, "complete" | "error">) {
    if (txStageResetRef.current) clearTimeout(txStageResetRef.current);
    setTxStage(stage);
    txStageResetRef.current = setTimeout(() => {
      setTxStage("idle");
      txStageResetRef.current = null;
    }, 1800);
  }

  function clearPaymentHistory() {
    setPaymentHistory([]);
  }

  async function sendPayment() {
    const destination = recipientAddress.trim();
    const amount = formatXlm(Number(sendAmount || splitShareText));
    const selectedRecipient = friends.find(
      (friend) => friend.id === selectedRecipientId,
    );
    const recipientName = selectedRecipient?.name ?? "Manual address";

    setTransactionNotice({
      type: "loading",
      message: "Building Stellar testnet transaction...",
    });
    setIsTxBusy(true);
    if (txStageResetRef.current) {
      clearTimeout(txStageResetRef.current);
      txStageResetRef.current = null;
    }
    setTxStage("prepare");
    openScreen("payment");

    try {
      if (!publicKey) throw new Error("Connect Freighter first.");
      if (!onTestnet) throw new Error("Switch Freighter to TESTNET first.");
      if (!isValidPublicKey(destination)) {
        throw new Error("Recipient must be a valid Stellar public key.");
      }
      if (destination === publicKey) {
        throw new Error("Choose a recipient that is not your own wallet.");
      }
      if (Number(amount) <= 0) {
        throw new Error("Enter an XLM amount greater than 0.");
      }

      const account = await horizon.loadAccount(publicKey);
      setTxStage("sign");
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount,
          }),
        )
        .addMemo(Memo.text("splitwave-settle"))
        .setTimeout(30)
        .build();

      const signedResult = await safeFreighterCall(
        () =>
          freighterSignTransaction(tx.toXDR(), {
            networkPassphrase: Networks.TESTNET,
            address: publicKey,
          }),
        "Could not sign the transaction with Freighter.",
        {
          timeoutMs: FREIGHTER_APPROVAL_TIMEOUT_MS,
          timeoutMessage:
            "Freighter did not return a signature in time. Check the extension popup, unlock it if needed, then try again.",
        },
      );
      if (!signedResult.ok) throw new Error(signedResult.message);

      const signed = signedResult.value;
      if (signed.error) throw new Error(signed.error.message);

      setTxStage("submit");
      const signedTx = TransactionBuilder.fromXDR(
        signed.signedTxXdr,
        Networks.TESTNET,
      );
      const result = await horizon.submitTransaction(signedTx);

      setTransactionNotice({
        type: "success",
        message: `Sent ${amount} XLM on Stellar testnet.`,
        hash: result.hash,
      });
      pushPaymentHistory({
        status: "success",
        amount,
        recipient: destination,
        recipientName,
        groupName: activeGroupName,
        billName,
        message: `Sent ${amount} XLM on Stellar testnet.`,
        hash: result.hash,
      });
      setTxStage("sync");
      await refreshNetworkAndBalance(publicKey);
      finishTxStage("complete");
    } catch (error) {
      const message = errorMessage(error);
      setTransactionNotice({ type: "error", message });
      pushPaymentHistory({
        status: "error",
        amount,
        recipient: destination || "No recipient",
        recipientName,
        groupName: activeGroupName,
        billName,
        message,
      });
      finishTxStage("error");
    } finally {
      setIsTxBusy(false);
    }
  }

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) {
      setWalletNotice({
        type: "idle",
        message: "Reconnect Freighter to refresh your wallet.",
      });
    }
  }, []);

  useEffect(() => {
    function syncScreenFromHash() {
      setActiveScreen(readInitialScreen());
    }

    window.addEventListener("hashchange", syncScreenFromHash);
    return () => window.removeEventListener("hashchange", syncScreenFromHash);
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(paymentHistory));
  }, [paymentHistory]);

  useEffect(() => {
    return () => {
      if (txStageResetRef.current) clearTimeout(txStageResetRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!shellRef.current || prefersReducedMotion()) return;

    const context = gsap.context(() => {
      const intro = gsap.timeline({
        defaults: { duration: 0.58, ease: "power3.out" },
      });

      const panels = shellRef.current?.querySelectorAll(".panel");
      const railTargets = shellRef.current?.querySelectorAll(
        ".side-rail .brand-mark, .side-rail .rail-button",
      );
      const visualPanel = shellRef.current?.querySelector(".visual-panel");
      const visualImage = shellRef.current?.querySelector(".visual-panel img");
      const glowTargets = shellRef.current?.querySelectorAll(
        ".share-chip, .network-pill",
      );

      intro.from(".topbar > *", { y: -18, stagger: 0.08 });

      if (visualPanel) {
        intro.from(visualPanel, { y: 28, scale: 0.985 }, "-=0.18");
      }

      if (panels?.length) {
        intro.from(panels, { y: 26, stagger: 0.065 }, "-=0.34");
      }

      if (railTargets?.length) {
        intro.from(railTargets, { x: -16, stagger: 0.055 }, "-=0.62");
      }

      if (visualImage) {
        gsap.to(visualImage, {
          y: -12,
          scale: 1.035,
          duration: 5.5,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }

      gsap.to(".brand-mark svg", {
        rotate: 360,
        transformOrigin: "50% 50%",
        duration: 10,
        repeat: -1,
        ease: "none",
      });

      if (glowTargets?.length) {
        gsap.to(glowTargets, {
          boxShadow: "0 0 18px rgba(182, 255, 59, 0.34)",
          duration: 1.8,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }
    }, shellRef);

    return () => context.revert();
  }, []);

  useEffect(() => {
    if (!screenRef.current || prefersReducedMotion()) return;

    gsap.fromTo(
      screenRef.current.querySelectorAll(".screen-animate"),
      { y: 18, scale: 0.992 },
      {
        y: 0,
        scale: 1,
        duration: 0.42,
        stagger: 0.045,
        overwrite: "auto",
        ease: "power3.out",
      },
    );
  }, [activeScreen]);

  useEffect(() => {
    if (!balanceValueRef.current || prefersReducedMotion()) {
      previousBalanceRef.current = balance;
      return;
    }

    if (previousBalanceRef.current !== balance && balance !== null) {
      gsap.fromTo(
        balanceValueRef.current,
        { scale: 1.045, color: "#00f5d4" },
        {
          scale: 1,
          color: "#f4f3ff",
          duration: 0.55,
          ease: "elastic.out(1, 0.55)",
        },
      );
    }

    previousBalanceRef.current = balance;
  }, [balance]);

  useEffect(() => {
    if (!shellRef.current || prefersReducedMotion()) return;

    const targets = shellRef.current.querySelectorAll(
      ".share-chip, .request-card, .visual-copy",
    );
    if (!targets.length) return;

    gsap.fromTo(
      targets,
      { scale: 0.985 },
      { scale: 1, duration: 0.36, stagger: 0.035, ease: "back.out(2)" },
    );
  }, [splitShareText, participantCount, activeGroupId]);

  useEffect(() => {
    if (!shellRef.current || prefersReducedMotion()) return;

    const sendPanel = shellRef.current.querySelector(".send-panel");
    if (!sendPanel) return;

    if (transactionNotice.type === "success") {
      gsap
        .timeline()
        .to(sendPanel, {
          borderColor: "rgba(182, 255, 59, 0.76)",
          boxShadow: "0 0 0 1px rgba(182, 255, 59, 0.22), 0 20px 70px rgba(182, 255, 59, 0.14)",
          duration: 0.2,
          ease: "power2.out",
        })
        .to(sendPanel, {
          boxShadow: "0 20px 56px rgba(0, 0, 0, 0.22)",
          duration: 1,
          ease: "power2.out",
        });
    }

    if (transactionNotice.type === "error") {
      gsap.fromTo(
        sendPanel,
        { x: -8 },
        { x: 0, duration: 0.48, ease: "elastic.out(1, 0.35)" },
      );
    }
  }, [transactionNotice.type]);

  useEffect(() => {
    if (!copiedRequestId || !shellRef.current || prefersReducedMotion()) return;

    const request = shellRef.current.querySelector(
      `[data-request-id="${copiedRequestId}"]`,
    );
    if (!request) return;

    gsap.fromTo(
      request,
      { scale: 0.98, borderColor: "rgba(0, 245, 212, 0.72)" },
      {
        scale: 1,
        borderColor: "rgba(236, 233, 255, 0.1)",
        duration: 0.42,
        ease: "back.out(2.4)",
      },
    );
  }, [copiedRequestId]);

  return (
    <div className="app-shell" ref={shellRef}>
      <aside className="side-rail">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <button
          className={railButtonClass("split")}
          type="button"
          onClick={() => openScreen("split")}
          aria-label="Go to split calculator"
          aria-pressed={activeScreen === "split"}
          title="Split calculator"
        >
          <CircleDollarSign size={19} />
        </button>
        <button
          className={railButtonClass("payment")}
          type="button"
          onClick={() => openScreen("payment")}
          aria-label="Go to payment"
          aria-pressed={activeScreen === "payment"}
          title="Payment"
        >
          <Send size={19} />
        </button>
        <button
          className={railButtonClass("history")}
          type="button"
          onClick={() => openScreen("history")}
          aria-label="Go to history"
          aria-pressed={activeScreen === "history"}
          title="History"
        >
          <Clipboard size={19} />
        </button>
        <button
          className={railButtonClass("wallet")}
          type="button"
          onClick={() => openScreen("wallet")}
          aria-label="Go to wallet"
          aria-pressed={activeScreen === "wallet"}
          title="Wallet"
        >
          <Wallet size={19} />
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Stellar White Belt</p>
            <h1>Splitwave</h1>
          </div>
          <div className="topbar-actions">
            <span className={onTestnet ? "network-pill" : "network-pill danger"}>
              {networkName || "UNKNOWN"}
            </span>
            {connected ? (
              <button className="icon-text ghost" onClick={disconnectWallet}>
                <LogOut size={17} />
                Disconnect
              </button>
            ) : freighterInstalled === false ? (
              <a
                className="icon-text primary"
                href={FREIGHTER_INSTALL_URL}
                target="_blank"
                rel="noreferrer"
              >
                <Wallet size={17} />
                Install Freighter
              </a>
            ) : (
              <button
                className="icon-text primary"
                onClick={connectWallet}
                disabled={isWalletBusy}
              >
                {isWalletBusy ? <Loader2 className="spin" size={17} /> : <Wallet size={17} />}
                Connect
              </button>
            )}
          </div>
        </header>

        <section className="metrics-strip" aria-label="Split summary">
          <article className="metric-tile">
            <Wallet size={18} />
            <div>
              <span>Balance</span>
              <strong>{formatBalance(balance)} XLM</strong>
            </div>
          </article>
          <article className="metric-tile">
            <Clipboard size={18} />
            <div>
              <span>Groups</span>
              <strong>{groups.length}</strong>
            </div>
          </article>
          <article className="metric-tile">
            <Users size={18} />
            <div>
              <span>Friends</span>
              <strong>{groupFriends.length}</strong>
            </div>
          </article>
          <article className="metric-tile accent">
            <CircleDollarSign size={18} />
            <div>
              <span>Each</span>
              <strong>{splitShareText} XLM</strong>
            </div>
          </article>
        </section>

        <section
          className={`screen-view ${activeScreen}-screen`}
          aria-label={`${activeScreen} screen`}
          ref={screenRef}
        >
          {activeScreen === "split" && (
            <div className="dashboard-grid split-screen-grid">
              <div className="visual-panel screen-animate">
                <img src={coverArt} alt="" />
                <div className="visual-copy">
                  <p className="eyebrow">Group</p>
                  <h2>{activeGroupName}</h2>
                  <p>
                    {participantCount} people splitting{" "}
                    {formatXlm(Number(billTotal) || 0)} XLM
                  </p>
                </div>
              </div>

              <section className="panel split-panel screen-animate" aria-label="Split calculator">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Split</p>
                    <h2>{billName}</h2>
                  </div>
                  <span className="share-chip">{splitShareText} XLM each</span>
                </div>

                <div className="form-grid">
                  <label>
                    <span>Bill name</span>
                    <input
                      value={billTitle}
                      onChange={(event) => setBillTitle(event.target.value)}
                      placeholder="Bill name"
                      maxLength={40}
                    />
                  </label>
                  <label>
                    <span>Total XLM</span>
                    <input
                      value={billTotal}
                      onChange={(event) => setBillTotal(event.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    <span>Paid by</span>
                    <select
                      value={payer}
                      onChange={(event) => setPayer(event.target.value)}
                    >
                      <option value="friend">A friend paid</option>
                      <option value="me">I paid</option>
                    </select>
                  </label>
                  <label>
                    <span>People</span>
                    <input value={participantCount} readOnly />
                  </label>
                </div>

                <div className="group-tabs" aria-label="Groups">
                  {groups.length === 0 ? (
                    <div className="empty-state compact">Create your first group.</div>
                  ) : (
                    groups.map((group) => (
                      <button
                        key={group.id}
                        className={
                          group.id === activeGroupId ? "group-tab active" : "group-tab"
                        }
                        onClick={() => setActiveGroupId(group.id)}
                      >
                        {group.name}
                      </button>
                    ))
                  )}
                </div>

                <div className="inline-form">
                  <input
                    value={newGroupName}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    placeholder="New group"
                    maxLength={22}
                  />
                  <button
                    className="icon-only"
                    onClick={addGroup}
                    aria-label="Add group"
                    title="Add group"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </section>

              <section className="panel friends-panel screen-animate" aria-label="Friends">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Friends</p>
                    <h2>{activeGroupName}</h2>
                  </div>
                  <span className="count-badge">{groupFriends.length}</span>
                </div>

                <div className="friend-list">
                  {!activeGroup ? (
                    <div className="empty-state">Create a group before adding friends.</div>
                  ) : groupFriends.length === 0 ? (
                    <div className="empty-state">No friends added yet.</div>
                  ) : (
                    groupFriends.map((friend) => (
                      <article className="friend-card" key={friend.id}>
                        <div className="avatar" aria-hidden="true">
                          {friend.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="friend-main">
                          <strong>{friend.name}</strong>
                          <input
                            value={friend.wallet}
                            onChange={(event) =>
                              updateFriendWallet(friend.id, event.target.value)
                            }
                            placeholder="G... testnet wallet"
                          />
                        </div>
                        <button
                          className="icon-only subtle"
                          onClick={() => removeFriend(friend.id)}
                          aria-label={`Remove ${friend.name}`}
                          title={`Remove ${friend.name}`}
                        >
                          <X size={16} />
                        </button>
                      </article>
                    ))
                  )}
                </div>

                <div className="friend-add">
                  <input
                    value={newFriendName}
                    onChange={(event) => setNewFriendName(event.target.value)}
                    placeholder="Friend name"
                    maxLength={24}
                    disabled={!activeGroup}
                  />
                  <input
                    value={newFriendWallet}
                    onChange={(event) => setNewFriendWallet(event.target.value)}
                    placeholder="Optional G... wallet"
                    disabled={!activeGroup}
                  />
                  <button
                    className="icon-only"
                    onClick={addFriend}
                    aria-label="Add friend"
                    title={activeGroup ? "Add friend" : "Create a group first"}
                    disabled={!activeGroup}
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </section>

              <section className="panel requests-panel screen-animate" aria-label="Split requests">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Requests</p>
                    <h2>{payer === "me" ? "Collect" : "Settle"}</h2>
                  </div>
                  <Clipboard size={20} />
                </div>

                <div className="request-list">
                  {groupFriends.length === 0 ? (
                    <div className="empty-state">No friends in this group.</div>
                  ) : (
                    groupFriends.map((friend) => (
                      <article
                        className="request-card"
                        data-request-id={friend.id}
                        key={friend.id}
                      >
                        <div>
                          <strong>{friend.name}</strong>
                          <span>{splitShareText} XLM</span>
                        </div>
                        <button
                          className="icon-text ghost compact"
                          onClick={() => copyRequest(friend)}
                        >
                          {copiedRequestId === friend.id ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <Copy size={16} />
                          )}
                          {copiedRequestId === friend.id ? "Copied" : "Copy"}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}

          {activeScreen === "payment" && (
            <div className="payment-grid">
              <section className="panel send-panel screen-animate" aria-label="Send XLM">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Testnet Payment</p>
                    <h2>Send XLM</h2>
                  </div>
                  <Send size={20} />
                </div>

                <div className="form-stack">
                  <label>
                    <span>Recipient</span>
                    <select
                      value={selectedRecipientId}
                      onChange={(event) => selectRecipient(event.target.value)}
                    >
                      <option value="">Manual address</option>
                      {groupFriends.map((friend) => (
                        <option value={friend.id} key={friend.id}>
                          {friend.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Wallet address</span>
                    <input
                      value={recipientAddress}
                      onChange={(event) => {
                        setRecipientAddress(event.target.value);
                        setSelectedRecipientId("");
                      }}
                      placeholder="G..."
                    />
                  </label>
                  <label>
                    <span>Amount</span>
                    <div className="amount-line">
                      <input
                        value={sendAmount}
                        onChange={(event) => setSendAmount(event.target.value)}
                        placeholder={splitShareText}
                        inputMode="decimal"
                      />
                      <button
                        className="icon-text ghost compact"
                        onClick={() => setSendAmount(splitShareText)}
                        type="button"
                      >
                        <CircleDollarSign size={16} />
                        Split
                      </button>
                    </div>
                  </label>
                </div>

                <button
                  className="send-button"
                  onClick={sendPayment}
                  disabled={isTxBusy || !connected || !onTestnet}
                >
                  {isTxBusy ? <Loader2 className="spin" size={19} /> : <Send size={19} />}
                  Sign and send
                </button>

                <StatusNotice notice={transactionNotice} />
                {transactionNotice.hash && (
                  <a
                    className="hash-link"
                    href={`${EXPLORER_BASE}/${transactionNotice.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortKey(transactionNotice.hash)}
                  </a>
                )}
              </section>

              <PaymentPreloader stage={txStage} notice={transactionNotice} />

              <section className="panel payment-context screen-animate" aria-label="Payment details">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Queue</p>
                    <h2>{billName}</h2>
                  </div>
                  <span className="share-chip">{splitShareText} XLM</span>
                </div>

                <div className="detail-grid">
                  <div>
                    <span>Group</span>
                    <strong>{activeGroupName}</strong>
                  </div>
                  <div>
                    <span>Recipient</span>
                    <strong>
                      {selectedRecipientId
                        ? groupFriends.find((friend) => friend.id === selectedRecipientId)?.name
                        : "Manual"}
                    </strong>
                  </div>
                  <div>
                    <span>Address</span>
                    <strong>{recipientAddress ? shortKey(recipientAddress) : "G..."}</strong>
                  </div>
                  <div>
                    <span>Network</span>
                    <strong>{networkName || "UNKNOWN"}</strong>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeScreen === "history" && (
            <PaymentHistoryPanel history={paymentHistory} onClear={clearPaymentHistory} />
          )}

          {activeScreen === "wallet" && (
            <div className="wallet-grid">
              <section className="panel wallet-panel screen-animate" aria-label="Wallet">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Wallet</p>
                    <h2>{connected ? shortKey(publicKey) : "Freighter"}</h2>
                  </div>
                  <button
                    className="icon-only"
                    onClick={() => refreshNetworkAndBalance()}
                    disabled={!connected || isWalletBusy}
                    aria-label="Refresh wallet balance"
                    title="Refresh wallet balance"
                  >
                    <RefreshCcw size={18} />
                  </button>
                </div>

                <div className="balance-display">
                  <span ref={balanceValueRef}>{formatBalance(balance)}</span>
                  <strong>XLM</strong>
                </div>

                <StatusNotice notice={walletNotice} />

                <div className="wallet-actions">
                  {freighterInstalled === false ? (
                    <a
                      className="icon-text primary"
                      href={FREIGHTER_INSTALL_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Wallet size={17} />
                      Install Freighter
                    </a>
                  ) : (
                    <button
                      className="icon-text secondary"
                      onClick={fundWallet}
                      disabled={!connected || isWalletBusy || !onTestnet}
                    >
                      {isWalletBusy ? (
                        <Loader2 className="spin" size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}
                      Fund testnet
                    </button>
                  )}
                  {!connected && freighterInstalled !== false && (
                    <button
                      className="icon-text primary"
                      onClick={connectWallet}
                      disabled={isWalletBusy}
                    >
                      <Wallet size={17} />
                      Connect wallet
                    </button>
                  )}
                </div>
              </section>

              <section className="panel wallet-profile screen-animate" aria-label="Account details">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Account</p>
                    <h2>{connected ? "Connected" : "Disconnected"}</h2>
                  </div>
                  <Wallet size={20} />
                </div>

                <div className="detail-grid">
                  <div>
                    <span>Public key</span>
                    <strong>{connected ? shortKey(publicKey) : "None"}</strong>
                  </div>
                  <div>
                    <span>Network</span>
                    <strong>{networkName || "UNKNOWN"}</strong>
                  </div>
                  <div>
                    <span>Balance</span>
                    <strong>{formatBalance(balance)} XLM</strong>
                  </div>
                  <div>
                    <span>History</span>
                    <strong>{paymentHistory.length}</strong>
                  </div>
                </div>
              </section>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const PAYMENT_STEPS: Array<{
  stage: Extract<TxStage, "prepare" | "sign" | "submit" | "sync">;
  label: string;
}> = [
  { stage: "prepare", label: "Build" },
  { stage: "sign", label: "Sign" },
  { stage: "submit", label: "Submit" },
  { stage: "sync", label: "Sync" },
];

function paymentStageTitle(stage: TxStage) {
  if (stage === "prepare") return "Building transaction";
  if (stage === "sign") return "Waiting for Freighter";
  if (stage === "submit") return "Submitting to Horizon";
  if (stage === "sync") return "Refreshing balance";
  if (stage === "complete") return "Payment complete";
  if (stage === "error") return "Payment stopped";
  return "Ready to send";
}

function PaymentPreloader({
  stage,
  notice,
}: {
  stage: TxStage;
  notice: Notice;
}) {
  const activeIndex = PAYMENT_STEPS.findIndex((step) => step.stage === stage);
  const isFinal = stage === "complete" || stage === "error";

  function stageClass(index: number) {
    if (stage === "complete") return "done";
    if (stage === "error" && index === Math.max(activeIndex, 0)) return "error";
    if (index < activeIndex) return "done";
    if (index === activeIndex) return "active";
    return "";
  }

  return (
    <section
      className={`panel preloader-panel screen-animate ${stage}`}
      aria-label="Payment status"
    >
      <div className="payment-orbit" aria-hidden="true">
        <span className="orbit-ring" />
        <span className="orbit-ring outer" />
        <span className="orbit-core">
          {stage === "complete" ? <CheckCircle2 size={28} /> : <Send size={28} />}
        </span>
        <span className="orbit-dot dot-a" />
        <span className="orbit-dot dot-b" />
        <span className="orbit-dot dot-c" />
      </div>

      <div className="preloader-copy">
        <p className="eyebrow">Payment status</p>
        <h2>{paymentStageTitle(stage)}</h2>
        <p>{notice.message}</p>
      </div>

      <div className="stage-list">
        {PAYMENT_STEPS.map((step, index) => (
          <div className={`stage-item ${stageClass(index)}`} key={step.stage}>
            <span>{index + 1}</span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </div>

      {isFinal && <span className="preloader-flash" aria-hidden="true" />}
    </section>
  );
}

function PaymentHistoryPanel({
  history,
  onClear,
}: {
  history: PaymentHistoryEntry[];
  onClear: () => void;
}) {
  return (
    <section className="panel history-panel screen-animate" aria-label="Payment history">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2>{history.length} records</h2>
        </div>
        <button
          className="icon-text ghost compact"
          onClick={onClear}
          disabled={history.length === 0}
          type="button"
        >
          <X size={16} />
          Clear
        </button>
      </div>

      <div className="history-list">
        {history.length === 0 ? (
          <div className="empty-state history-empty">No payment history yet.</div>
        ) : (
          history.map((entry) => (
            <article className={`history-card ${entry.status}`} key={entry.id}>
              <div className="history-icon" aria-hidden="true">
                {entry.status === "success" ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <AlertCircle size={18} />
                )}
              </div>
              <div className="history-main">
                <strong>
                  {entry.status === "success"
                    ? `${entry.amount} XLM`
                    : "Payment failed"}
                </strong>
                <span>
                  {entry.recipientName} - {entry.groupName} - {entry.billName}
                </span>
                <p>{entry.message}</p>
              </div>
              <div className="history-meta">
                <time dateTime={entry.createdAt}>
                  {formatHistoryDate(entry.createdAt)}
                </time>
                {entry.hash && (
                  <a
                    className="hash-link compact-link"
                    href={`${EXPLORER_BASE}/${entry.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortKey(entry.hash)}
                  </a>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function StatusNotice({ notice }: { notice: Notice }) {
  return (
    <div className={`status-line ${notice.type}`} aria-live="polite">
      {notice.type === "success" && <CheckCircle2 size={17} />}
      {notice.type === "error" && <AlertCircle size={17} />}
      {notice.type === "warning" && <AlertCircle size={17} />}
      {notice.type === "loading" && <Loader2 className="spin" size={17} />}
      {notice.type === "idle" && <span className="status-dot" />}
      <span>{notice.message}</span>
    </div>
  );
}

export default App;
