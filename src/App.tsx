import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  BellRing,
  Cable,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  ExternalLink,
  Flame,
  Gauge,
  Loader2,
  LockKeyhole,
  PartyPopper,
  Plus,
  Radio,
  ReceiptText,
  RefreshCcw,
  Send,
  Sparkles,
  TrendingUp,
  UserRound,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Horizon, StrKey } from "@stellar/stellar-sdk";
import gsap from "gsap";
import coverArt from "./assets/splitwave-cover.svg";
import {
  contractDataKeys,
  useBillSummaryQuery,
  useContractEventsQuery,
} from "./hooks/useContractData";
import {
  CONTRACT_DEPLOYMENT_TX,
  CONTRACT_ID,
  FREIGHTER_INSTALL_URL,
  HORIZON_URL,
  RPC_URL,
  TESTNET_EXPLORER,
} from "./stellar/config";
import {
  isValidContractId,
  recordPaymentOnContract,
  stroopsToXlm,
  type BillSummary,
  type ContractEvent,
  type ContractTxStage,
  upsertBillOnContract,
} from "./stellar/contractClient";
import {
  connectWallet,
  getWalletNetwork,
  getWalletOptions,
  restoreFreighterAddress,
  toWalletKitError,
  WALLET_OPTIONS,
  WalletKitError,
  type WalletConnection,
  type WalletOption,
} from "./stellar/walletKit";

const horizon = new Horizon.Server(HORIZON_URL);
const WALLET_STORAGE_KEY = "splitwave:yellowWallet";
const CONTRACT_STORAGE_KEY = "splitwave:contractId";
const ONBOARDING_KEY = "splitwave:yellowOnboarding";

type NoticeType = "idle" | "loading" | "success" | "warning" | "error";

type Notice = {
  type: NoticeType;
  message: string;
  hash?: string;
};

type Participant = {
  id: string;
  name: string;
  wallet: string;
  vibe: string;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  tone: "green" | "pink" | "teal" | "yellow" | "red";
  hash?: string;
  createdAt: string;
};

type Screen = "command" | "contract" | "live" | "wallet";

const DEFAULT_PARTICIPANTS: Participant[] = [
  { id: "p-1", name: "Ari", wallet: "", vibe: "Rent" },
  { id: "p-2", name: "Mina", wallet: "", vibe: "Utilities" },
  { id: "p-3", name: "Dev", wallet: "", vibe: "Groceries" },
];

const TX_STAGES: Array<{ id: ContractTxStage; label: string }> = [
  { id: "simulate", label: "Simulate" },
  { id: "sign", label: "Sign" },
  { id: "submit", label: "Submit" },
  { id: "pending", label: "Pending" },
  { id: "success", label: "Success" },
];

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readInitialContractId() {
  return localStorage.getItem(CONTRACT_STORAGE_KEY) || CONTRACT_ID;
}

function readOnboardingState() {
  if (new URLSearchParams(window.location.search).has("skipOnboarding")) {
    return true;
  }
  return localStorage.getItem(ONBOARDING_KEY) === "done";
}

function readInitialWalletModalState() {
  return new URLSearchParams(window.location.search).has("walletModal");
}

function shortKey(value: string) {
  if (!value) return "";
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function formatBalance(balance: string | null) {
  if (!balance) return "0.00";
  const value = Number(balance);
  if (!Number.isFinite(value)) return balance;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

function xlmToStroops(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,7})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

function emptySummary(billId: string): BillSummary {
  return {
    id: billId,
    title: "Neon apartment run",
    target: 52_0000000n,
    paid: 18_0000000n,
    contributors: 3,
    updatedLedger: 0,
  };
}

function noticeFromError(error: unknown, fallback: string): Notice {
  if (error instanceof WalletKitError) {
    if (error.code === "wallet_not_found") {
      return { type: "error", message: `Wallet not found: ${error.message}` };
    }
    if (error.code === "rejected") {
      return { type: "warning", message: `Wallet rejected: ${error.message}` };
    }
    if (error.code === "insufficient_balance") {
      return { type: "error", message: `Insufficient balance: ${error.message}` };
    }
  }

  const message = error instanceof Error ? error.message : fallback;
  return { type: "error", message: message || fallback };
}

function stageLabel(stage: ContractTxStage) {
  if (stage === "idle") return "Ready";
  if (stage === "failed") return "Failed";
  return TX_STAGES.find((item) => item.id === stage)?.label ?? "Syncing";
}

function progress(summary: BillSummary) {
  const target = Number(summary.target || 0n);
  const paid = Number(summary.paid || 0n);
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((paid / target) * 100));
}

function participantWalletValid(wallet: string) {
  return !wallet || StrKey.isValidEd25519PublicKey(wallet.trim());
}

function App() {
  const queryClient = useQueryClient();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [onboarded, setOnboarded] = useState(readOnboardingState);
  const [screen, setScreen] = useState<Screen>("command");
  const [walletOptions, setWalletOptions] =
    useState<WalletOption[]>(WALLET_OPTIONS);
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(readInitialWalletModalState);
  const [walletNotice, setWalletNotice] = useState<Notice>({
    type: "idle",
    message: "Wallet disconnected",
  });
  const [contractNotice, setContractNotice] = useState<Notice>({
    type: "idle",
    message: "Contract idle",
  });
  const [networkName, setNetworkName] = useState("TESTNET");
  const [balance, setBalance] = useState<string | null>(null);
  const [isWalletBusy, setIsWalletBusy] = useState(false);
  const [isContractBusy, setIsContractBusy] = useState(false);
  const [contractId, setContractId] = useState(readInitialContractId);
  const [billId, setBillId] = useState("daily-bills-yellow");
  const [billTitle, setBillTitle] = useState("Neon apartment run");
  const [targetXlm, setTargetXlm] = useState("52");
  const [paymentXlm, setPaymentXlm] = useState("6.5");
  const [paymentMemo, setPaymentMemo] = useState("wifi + dumplings");
  const [participants, setParticipants] = useState<Participant[]>(
    DEFAULT_PARTICIPANTS,
  );
  const [newParticipant, setNewParticipant] = useState("");
  const [txStage, setTxStage] = useState<ContractTxStage>("idle");
  const [lastSync, setLastSync] = useState("");
  const [activity, setActivity] = useState<ActivityItem[]>([
    {
      id: "seed-1",
      title: "Yellow Belt room opened",
      detail: "Bill tracker ready for a deployed Stellar smart contract.",
      tone: "yellow",
      createdAt: new Date().toISOString(),
    },
  ]);

  const connected = Boolean(wallet);
  const onTestnet = networkName === "TESTNET";
  const validContract = isValidContractId(contractId);
  const normalizedBillId = billId.trim() || "daily-bills-yellow";
  const sourceAddress = wallet?.address || "";
  const summaryQuery = useBillSummaryQuery({
    contractId,
    sourceAddress,
    billId: normalizedBillId,
    enabled: connected && onTestnet && validContract,
  });
  const eventsQuery = useContractEventsQuery({
    contractId,
    enabled: validContract,
  });
  const summary = summaryQuery.data ?? emptySummary(normalizedBillId);
  const events = eventsQuery.data ?? [];
  const summaryLoading = summaryQuery.isLoading;
  const eventsLoading = eventsQuery.isLoading;
  const contractFetching = summaryQuery.isFetching || eventsQuery.isFetching;
  const percent = progress(summary);
  const missingContract = !contractId.trim();
  const canWriteContract =
    connected && onTestnet && validContract && !isContractBusy && !isWalletBusy;

  const contractLink = validContract
    ? `${TESTNET_EXPLORER}/contract/${contractId}`
    : "";
  const deploymentLink = CONTRACT_DEPLOYMENT_TX
    ? `${TESTNET_EXPLORER}/tx/${CONTRACT_DEPLOYMENT_TX}`
    : "";

  const metricTiles = useMemo(
    () => [
      {
        label: "Synced paid",
        value: summaryLoading ? (
          <SkeletonText width="6.5rem" />
        ) : (
          `${stroopsToXlm(summary.paid)} XLM`
        ),
        icon: <CircleDollarSign size={19} />,
      },
      {
        label: "Goal",
        value: summaryLoading ? (
          <SkeletonText width="5.5rem" />
        ) : (
          `${stroopsToXlm(summary.target)} XLM`
        ),
        icon: <Gauge size={19} />,
      },
      {
        label: "People",
        value: summaryLoading ? (
          <SkeletonText width="3.5rem" />
        ) : (
          `${Math.max(summary.contributors, participants.length)}`
        ),
        icon: <UserRound size={19} />,
      },
      {
        label: "Status",
        value: stageLabel(txStage),
        icon: <Radio size={19} />,
      },
    ],
    [participants.length, summary, summaryLoading, txStage],
  );

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function pushActivity(item: Omit<ActivityItem, "id" | "createdAt">) {
    setActivity((current) => [
      {
        ...item,
        id: createId("activity"),
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 18));
  }

  async function refreshWallet(address = wallet?.address || "") {
    if (!address) return;
    try {
      const network = await getWalletNetwork();
      setNetworkName(network);
      if (network !== "TESTNET") {
        setBalance(null);
        setWalletNotice({
          type: "warning",
          message: "Switch wallet network to TESTNET.",
        });
        return;
      }

      const account = await horizon.loadAccount(address);
      const nativeBalance = account.balances.find(
        (entry) => entry.asset_type === "native",
      );
      setBalance(nativeBalance?.balance ?? "0");
      setWalletNotice({
        type: "success",
        message: `${shortKey(address)} live on testnet.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("not found")) {
        setBalance("0");
        setWalletNotice({
          type: "warning",
          message: "Wallet connected, but this testnet account needs funding.",
        });
        return;
      }
      setWalletNotice(noticeFromError(error, "Could not refresh wallet."));
    }
  }

  async function refreshWalletOptions() {
    const options = await getWalletOptions();
    setWalletOptions(options);
  }

  async function handleConnect(option: WalletOption) {
    setIsWalletBusy(true);
    setWalletNotice({ type: "loading", message: `${option.name} opening...` });
    try {
      const connection = await connectWallet(option);
      setWallet(connection);
      localStorage.setItem(WALLET_STORAGE_KEY, connection.id);
      setWalletModalOpen(false);
      pushActivity({
        title: `${connection.name} connected`,
        detail: shortKey(connection.address),
        tone: "green",
      });
      await refreshWallet(connection.address);
    } catch (error) {
      const walletError = toWalletKitError(error, `${option.name} failed.`);
      setWalletNotice(noticeFromError(walletError, "Wallet connection failed."));
      pushActivity({
        title:
          walletError.code === "wallet_not_found"
            ? "Wallet not found"
            : walletError.code === "rejected"
              ? "Request rejected"
              : "Wallet error",
        detail: walletError.message,
        tone: walletError.code === "rejected" ? "yellow" : "red",
      });
    } finally {
      setIsWalletBusy(false);
    }
  }

  function disconnectWallet() {
    setWallet(null);
    setBalance(null);
    localStorage.removeItem(WALLET_STORAGE_KEY);
    setWalletNotice({ type: "idle", message: "Wallet disconnected" });
  }

  async function fundWallet() {
    if (!wallet) return;
    setIsWalletBusy(true);
    setWalletNotice({ type: "loading", message: "Friendbot funding..." });
    try {
      await horizon.friendbot(wallet.address).call();
      await refreshWallet(wallet.address);
      pushActivity({
        title: "Testnet wallet funded",
        detail: shortKey(wallet.address),
        tone: "teal",
      });
    } catch (error) {
      setWalletNotice(noticeFromError(error, "Friendbot request failed."));
      await refreshWallet(wallet.address);
    } finally {
      setIsWalletBusy(false);
    }
  }

  async function refreshContractState() {
    if (!wallet || !validContract) return;
    try {
      const result = await summaryQuery.refetch();
      if (result.error) throw result.error;
      if (result.data?.title) setBillTitle(result.data.title);
      setLastSync(new Date().toISOString());
      setContractNotice({
        type: "success",
        message: "Contract state synchronized.",
      });
    } catch (error) {
      setContractNotice(noticeFromError(error, "Contract sync failed."));
    }
  }

  async function refreshEvents() {
    if (!validContract) return;
    try {
      const result = await eventsQuery.refetch();
      if (result.error) throw result.error;
      setLastSync(new Date().toISOString());
    } catch (error) {
      if (contractId.trim()) {
        setContractNotice(noticeFromError(error, "Event sync failed."));
      }
    }
  }

  function applyOptimisticSummary(
    update: (current: BillSummary) => BillSummary,
  ) {
    if (!wallet) return () => {};
    const key = contractDataKeys.summary(contractId, wallet.address, normalizedBillId);
    const previous = queryClient.getQueryData<BillSummary>(key);

    queryClient.setQueryData<BillSummary>(key, (current) =>
      update(current ?? summary),
    );

    return () => {
      if (previous) {
        queryClient.setQueryData(key, previous);
      } else {
        queryClient.removeQueries({ queryKey: key, exact: true });
      }
    };
  }

  function cacheSubmittedEvent({
    topic,
    amountXlm,
    hash,
    ledger,
    actor,
  }: {
    topic: string;
    amountXlm: string;
    hash: string;
    ledger: number;
    actor: string;
  }) {
    queryClient.setQueryData<ContractEvent[]>(
      contractDataKeys.events(contractId),
      (current = []) => [
        {
          id: `submitted-${hash}-${topic}`,
          txHash: hash,
          ledger,
          closedAt: new Date().toISOString(),
          topic,
          billId: normalizedBillId,
          actor,
          amountXlm,
        },
        ...current.filter((event) => event.txHash !== hash),
      ].slice(0, 20),
    );
  }

  async function saveBillToContract() {
    if (!wallet) {
      setWalletModalOpen(true);
      setWalletNotice({
        type: "warning",
        message: "Connect a wallet before contract writes.",
      });
      return;
    }

    setIsContractBusy(true);
    setTxStage("simulate");
    setScreen("contract");
    setContractNotice({
      type: "loading",
      message: "Preparing contract bill update...",
    });

    let rollbackOptimistic = () => {};

    try {
      const nextTitle = billTitle.trim() || "Daily bill";
      const optimisticTarget = xlmToStroops(targetXlm);
      if (optimisticTarget && optimisticTarget > 0n) {
        rollbackOptimistic = applyOptimisticSummary((current) => ({
          ...current,
          id: normalizedBillId,
          title: nextTitle,
          target: optimisticTarget,
          updatedLedger: current.updatedLedger,
        }));
      }

      const result = await upsertBillOnContract({
        contractId,
        wallet,
        billId: normalizedBillId,
        title: nextTitle,
        targetXlm,
        onStage: setTxStage,
      });
      cacheSubmittedEvent({
        topic: "bill",
        amountXlm: targetXlm,
        hash: result.hash,
        ledger: Number(result.ledger),
        actor: wallet.address,
      });
      setContractNotice({
        type: "success",
        message: "Bill goal written to contract.",
        hash: result.hash,
      });
      pushActivity({
        title: "Bill goal saved",
        detail: `${targetXlm} XLM target on ledger ${result.ledger}`,
        tone: "green",
        hash: result.hash,
      });
      await Promise.all([refreshWallet(wallet.address), refreshContractState(), refreshEvents()]);
    } catch (error) {
      rollbackOptimistic();
      setTxStage("failed");
      setContractNotice(noticeFromError(error, "Contract write failed."));
      pushActivity({
        title: "Contract write failed",
        detail: error instanceof Error ? error.message : "Unknown error",
        tone: "red",
      });
    } finally {
      setIsContractBusy(false);
    }
  }

  async function recordPayment() {
    if (!wallet) {
      setWalletModalOpen(true);
      setWalletNotice({
        type: "warning",
        message: "Connect a wallet before contract writes.",
      });
      return;
    }

    setIsContractBusy(true);
    setTxStage("simulate");
    setScreen("contract");
    setContractNotice({
      type: "loading",
      message: "Preparing payment event...",
    });

    let rollbackOptimistic = () => {};

    try {
      const optimisticAmount = xlmToStroops(paymentXlm);
      if (optimisticAmount && optimisticAmount > 0n) {
        rollbackOptimistic = applyOptimisticSummary((current) => ({
          ...current,
          id: normalizedBillId,
          paid: current.paid + optimisticAmount,
          contributors: current.contributors > 0 ? current.contributors : 1,
          updatedLedger: current.updatedLedger,
        }));
      }

      const result = await recordPaymentOnContract({
        contractId,
        wallet,
        balanceXlm: balance,
        billId: normalizedBillId,
        amountXlm: paymentXlm,
        memo: paymentMemo,
        onStage: setTxStage,
      });
      cacheSubmittedEvent({
        topic: "pay",
        amountXlm: paymentXlm,
        hash: result.hash,
        ledger: Number(result.ledger),
        actor: wallet.address,
      });
      setContractNotice({
        type: "success",
        message: `${paymentXlm} XLM recorded on contract.`,
        hash: result.hash,
      });
      pushActivity({
        title: "Payment event recorded",
        detail: `${paymentXlm} XLM from ${wallet.name}`,
        tone: "pink",
        hash: result.hash,
      });
      await Promise.all([refreshWallet(wallet.address), refreshContractState(), refreshEvents()]);
    } catch (error) {
      rollbackOptimistic();
      setTxStage("failed");
      setContractNotice(noticeFromError(error, "Payment write failed."));
      pushActivity({
        title:
          error instanceof WalletKitError && error.code === "insufficient_balance"
            ? "Insufficient balance"
            : "Payment event failed",
        detail: error instanceof Error ? error.message : "Unknown error",
        tone: "red",
      });
    } finally {
      setIsContractBusy(false);
    }
  }

  function addParticipant() {
    const name = newParticipant.trim();
    if (!name) return;
    setParticipants((current) => [
      ...current,
      {
        id: createId("person"),
        name,
        wallet: "",
        vibe: "Split",
      },
    ]);
    setNewParticipant("");
  }

  function updateParticipant(id: string, field: keyof Participant, value: string) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, [field]: value } : participant,
      ),
    );
  }

  function removeParticipant(id: string) {
    setParticipants((current) => current.filter((participant) => participant.id !== id));
  }

  function completeOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, "done");
    setOnboarded(true);
  }

  useEffect(() => {
    refreshWalletOptions();
  }, []);

  useEffect(() => {
    const remembered = localStorage.getItem(WALLET_STORAGE_KEY);
    if (remembered === "freighter") {
      restoreFreighterAddress().then((address) => {
        if (!address) return;
        const restored = { id: "freighter" as const, name: "Freighter", address };
        setWallet(restored);
        refreshWallet(address);
      });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(CONTRACT_STORAGE_KEY, contractId);
  }, [contractId]);

  useEffect(() => {
    const syncedAt = Math.max(summaryQuery.dataUpdatedAt, eventsQuery.dataUpdatedAt);
    if (syncedAt > 0) setLastSync(new Date(syncedAt).toISOString());
  }, [summaryQuery.dataUpdatedAt, eventsQuery.dataUpdatedAt]);

  useEffect(() => {
    if (summaryQuery.data?.title) setBillTitle(summaryQuery.data.title);
  }, [summaryQuery.data?.title]);

  useEffect(() => {
    if (summaryQuery.error) {
      setContractNotice(noticeFromError(summaryQuery.error, "Contract sync failed."));
      return;
    }
    if (eventsQuery.error && contractId.trim()) {
      setContractNotice(noticeFromError(eventsQuery.error, "Event sync failed."));
    }
  }, [contractId, eventsQuery.error, summaryQuery.error]);

  useLayoutEffect(() => {
    if (!shellRef.current || prefersReducedMotion()) return;

    const context = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: "power3.out", duration: 0.58 } })
        .from(".rail-button, .brand-sigil", { x: -20, stagger: 0.045 })
        .from(".hero-copy > *, .hero-art", { y: 28, stagger: 0.08 }, "-=0.35")
        .from(".metric-tile, .panel-band", { y: 22, stagger: 0.045 }, "-=0.38");

      gsap.to(".ticker-track", {
        xPercent: -50,
        duration: 18,
        repeat: -1,
        ease: "none",
      });
      gsap.to(".hero-art img", {
        y: -12,
        rotate: 1.5,
        duration: 4.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to(".spark-cell", {
        y: -10,
        stagger: 0.16,
        duration: 1.6,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    }, shellRef);

    return () => context.revert();
  }, []);

  useEffect(() => {
    if (!heroRef.current || prefersReducedMotion()) return;
    gsap.fromTo(
      heroRef.current.querySelector(".progress-fill"),
      { scaleX: 0 },
      {
        scaleX: summaryLoading ? 0 : percent / 100,
        duration: 0.8,
        ease: "power3.out",
      },
    );
  }, [percent, summaryLoading]);

  return (
    <div className="yellow-shell" ref={shellRef}>
      {!onboarded && <Onboarding onEnter={completeOnboarding} />}

      <aside className="side-rail" aria-label="Primary navigation">
        <button className="brand-sigil" type="button" onClick={() => setScreen("command")}>
          <Sparkles size={19} />
        </button>
        <RailButton
          active={screen === "command"}
          icon={<Flame size={19} />}
          label="Command"
          onClick={() => setScreen("command")}
        />
        <RailButton
          active={screen === "contract"}
          icon={<Cable size={19} />}
          label="Contract"
          onClick={() => setScreen("contract")}
        />
        <RailButton
          active={screen === "live"}
          icon={<BellRing size={19} />}
          label="Live"
          onClick={() => setScreen("live")}
        />
        <RailButton
          active={screen === "wallet"}
          icon={<Wallet size={19} />}
          label="Wallet"
          onClick={() => setScreen("wallet")}
        />
      </aside>

      <main className="workspace">
        <section className="hero-stage" ref={heroRef}>
          <div className="hero-copy">
            <p className="eyebrow">Yellow Belt // Stellar Journey</p>
            <h1>Splitwave</h1>
            <h2>Web3 into Daily Bills</h2>
            <div className="hero-actions">
              <button
                className="icon-text primary"
                type="button"
                onClick={() => setWalletModalOpen(true)}
                disabled={isWalletBusy}
              >
                {isWalletBusy ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
                {wallet ? shortKey(wallet.address) : "Wallets"}
              </button>
              <button className="icon-text secondary" type="button" onClick={recordPayment}>
                <Send size={18} />
                Record
              </button>
              {contractLink && (
                <a
                  className="icon-text ghost"
                  href={contractLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={18} />
                  Contract
                </a>
              )}
            </div>
          </div>

          <div className="hero-art" aria-hidden="true">
            <img src={coverArt} alt="" />
            <div className="sticker-stack">
              <span className="sticker lime">LIVE</span>
              <span className="sticker pink">{summaryLoading ? "SYNC" : `${percent}%`}</span>
              <span className="sticker cyan">TESTNET</span>
            </div>
          </div>

          <div className="progress-rack" aria-label="Bill progress">
            <div>
              {summaryLoading ? (
                <SkeletonText width="7rem" />
              ) : (
                <span>{stroopsToXlm(summary.paid)} XLM</span>
              )}
              {summaryLoading ? (
                <SkeletonText width="12rem" />
              ) : (
                <strong>{summary.title}</strong>
              )}
            </div>
            <div className="progress-track">
              <span
                className="progress-fill"
                style={{ transform: `scaleX(${summaryLoading ? 0 : percent / 100})` }}
              />
            </div>
            <p>{summaryLoading ? <SkeletonText width="5rem" /> : `${percent}% settled`}</p>
          </div>
        </section>

        <Ticker />

        <section className="metrics-strip" aria-label="Live metrics">
          {metricTiles.map((tile) => (
            <article className="metric-tile" key={tile.label}>
              {tile.icon}
              <div>
                <span>{tile.label}</span>
                <strong>{tile.value}</strong>
              </div>
            </article>
          ))}
        </section>

        {screen === "command" && (
          <section className="screen-grid command-grid">
            <BillControlPanel
              billId={billId}
              billTitle={billTitle}
              targetXlm={targetXlm}
              paymentXlm={paymentXlm}
              paymentMemo={paymentMemo}
              isBusy={isContractBusy}
              canWrite={canWriteContract}
              missingContract={missingContract}
              onBillId={setBillId}
              onBillTitle={setBillTitle}
              onTarget={setTargetXlm}
              onPayment={setPaymentXlm}
              onMemo={setPaymentMemo}
              onSave={saveBillToContract}
              onRecord={recordPayment}
            />
            <ParticipantsPanel
              participants={participants}
              newParticipant={newParticipant}
              onNewParticipant={setNewParticipant}
              onAdd={addParticipant}
              onUpdate={updateParticipant}
              onRemove={removeParticipant}
            />
            <StatusConsole
              txStage={txStage}
              notice={contractNotice}
              walletNotice={walletNotice}
              contractLink={contractLink}
              lastSync={lastSync}
            />
          </section>
        )}

        {screen === "contract" && (
          <section className="screen-grid contract-grid">
            <ContractPanel
              contractId={contractId}
              validContract={validContract}
              rpcUrl={RPC_URL}
              deploymentLink={deploymentLink}
              fetching={contractFetching}
              onContractId={setContractId}
              onRefresh={() => {
                refreshContractState();
                refreshEvents();
              }}
            />
            <StatusConsole
              txStage={txStage}
              notice={contractNotice}
              walletNotice={walletNotice}
              contractLink={contractLink}
              lastSync={lastSync}
            />
            <ActivityPanel activity={activity} />
          </section>
        )}

        {screen === "live" && (
          <section className="screen-grid live-grid">
            <LiveEventsPanel
              events={events}
              loading={eventsLoading}
              refreshing={eventsQuery.isFetching && !eventsLoading}
            />
            <ActivityPanel activity={activity} />
          </section>
        )}

        {screen === "wallet" && (
          <section className="screen-grid wallet-grid">
            <WalletPanel
              wallet={wallet}
              options={walletOptions}
              balance={balance}
              networkName={networkName}
              notice={walletNotice}
              busy={isWalletBusy}
              onOpen={() => setWalletModalOpen(true)}
              onRefresh={() => refreshWallet()}
              onFund={fundWallet}
              onDisconnect={disconnectWallet}
            />
            <ErrorMatrix />
          </section>
        )}
      </main>

      {walletModalOpen && (
        <WalletModal
          options={walletOptions}
          busy={isWalletBusy}
          onClose={() => setWalletModalOpen(false)}
          onConnect={handleConnect}
          onRefresh={refreshWalletOptions}
        />
      )}
    </div>
  );
}

function Onboarding({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="onboarding-screen">
      <div className="onboarding-grid" aria-hidden="true">
        {Array.from({ length: 42 }).map((_, index) => (
          <span className="spark-cell" key={index} />
        ))}
      </div>
      <div className="onboarding-copy">
        <p className="eyebrow">Splitwave Yellow Belt</p>
        <h1>Web3 into Daily Bills</h1>
        <button className="icon-text primary huge" type="button" onClick={onEnter}>
          <Zap size={20} />
          Enter
        </button>
      </div>
    </div>
  );
}

function RailButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "rail-button active" : "rail-button"}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function Ticker() {
  const items = [
    "MULTI-WALLET",
    "TESTNET CONTRACT",
    "LIVE EVENTS",
    "PENDING -> SUCCESS",
    "BILLS ONCHAIN",
  ];

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {[...items, ...items, ...items].map((item, index) => (
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function BillControlPanel({
  billId,
  billTitle,
  targetXlm,
  paymentXlm,
  paymentMemo,
  isBusy,
  canWrite,
  missingContract,
  onBillId,
  onBillTitle,
  onTarget,
  onPayment,
  onMemo,
  onSave,
  onRecord,
}: {
  billId: string;
  billTitle: string;
  targetXlm: string;
  paymentXlm: string;
  paymentMemo: string;
  isBusy: boolean;
  canWrite: boolean;
  missingContract: boolean;
  onBillId: (value: string) => void;
  onBillTitle: (value: string) => void;
  onTarget: (value: string) => void;
  onPayment: (value: string) => void;
  onMemo: (value: string) => void;
  onSave: () => void;
  onRecord: () => void;
}) {
  return (
    <section className="panel-band bill-control" aria-label="Bill controls">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Bill room</p>
          <h2>{billTitle || "Daily bill"}</h2>
        </div>
        <ReceiptText size={22} />
      </div>

      <div className="form-grid">
        <label>
          <span>Bill ID</span>
          <input value={billId} onChange={(event) => onBillId(event.target.value)} />
        </label>
        <label>
          <span>Title</span>
          <input value={billTitle} onChange={(event) => onBillTitle(event.target.value)} />
        </label>
        <label>
          <span>Goal XLM</span>
          <input
            value={targetXlm}
            inputMode="decimal"
            onChange={(event) => onTarget(event.target.value)}
          />
        </label>
        <label>
          <span>Payment XLM</span>
          <input
            value={paymentXlm}
            inputMode="decimal"
            onChange={(event) => onPayment(event.target.value)}
          />
        </label>
      </div>

      <label>
        <span>Memo</span>
        <input value={paymentMemo} onChange={(event) => onMemo(event.target.value)} />
      </label>

      <div className="action-row">
        <button
          className="icon-text secondary"
          type="button"
          onClick={onSave}
          disabled={!canWrite}
          title={missingContract ? "Add a contract ID first" : "Save bill"}
        >
          {isBusy ? <Loader2 className="spin" size={18} /> : <LockKeyhole size={18} />}
          Save bill
        </button>
        <button
          className="icon-text primary"
          type="button"
          onClick={onRecord}
          disabled={!canWrite}
        >
          {isBusy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          Record payment
        </button>
      </div>
    </section>
  );
}

function ParticipantsPanel({
  participants,
  newParticipant,
  onNewParticipant,
  onAdd,
  onUpdate,
  onRemove,
}: {
  participants: Participant[];
  newParticipant: string;
  onNewParticipant: (value: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, field: keyof Participant, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="panel-band participant-panel" aria-label="Participants">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Roommates</p>
          <h2>{participants.length} splitters</h2>
        </div>
        <PartyPopper size={22} />
      </div>

      <div className="participant-list">
        {participants.map((participant) => (
          <article className="person-row" key={participant.id}>
            <div className="avatar-burst">{participant.name.slice(0, 1).toUpperCase()}</div>
            <div className="person-fields">
              <input
                value={participant.name}
                onChange={(event) =>
                  onUpdate(participant.id, "name", event.target.value)
                }
              />
              <input
                className={
                  participantWalletValid(participant.wallet) ? "" : "input-error"
                }
                value={participant.wallet}
                onChange={(event) =>
                  onUpdate(participant.id, "wallet", event.target.value)
                }
                placeholder="G..."
              />
            </div>
            <input
              className="vibe-input"
              value={participant.vibe}
              onChange={(event) =>
                onUpdate(participant.id, "vibe", event.target.value)
              }
            />
            <button
              className="icon-only subtle"
              type="button"
              aria-label={`Remove ${participant.name}`}
              title={`Remove ${participant.name}`}
              onClick={() => onRemove(participant.id)}
            >
              <X size={16} />
            </button>
          </article>
        ))}
      </div>

      <div className="inline-form">
        <input
          value={newParticipant}
          onChange={(event) => onNewParticipant(event.target.value)}
          placeholder="New name"
        />
        <button className="icon-only" type="button" onClick={onAdd} aria-label="Add">
          <Plus size={18} />
        </button>
      </div>
    </section>
  );
}

function StatusConsole({
  txStage,
  notice,
  walletNotice,
  contractLink,
  lastSync,
}: {
  txStage: ContractTxStage;
  notice: Notice;
  walletNotice: Notice;
  contractLink: string;
  lastSync: string;
}) {
  const stageIndex = TX_STAGES.findIndex((stage) => stage.id === txStage);

  return (
    <section className="panel-band status-console" aria-label="Transaction status">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Transaction status</p>
          <h2>{stageLabel(txStage)}</h2>
        </div>
        <Clock3 size={22} />
      </div>

      <div className="stage-grid">
        {TX_STAGES.map((stage, index) => {
          const done = txStage === "success" || (stageIndex >= 0 && index < stageIndex);
          const active = stage.id === txStage;
          const failed = txStage === "failed" && index === Math.max(stageIndex, 0);
          return (
            <div
              className={`stage-pill ${done ? "done" : ""} ${active ? "active" : ""} ${
                failed ? "failed" : ""
              }`}
              key={stage.id}
            >
              <span>{index + 1}</span>
              <strong>{stage.label}</strong>
            </div>
          );
        })}
      </div>

      <StatusNotice notice={notice} />
      <StatusNotice notice={walletNotice} />

      <div className="console-links">
        {notice.hash && (
          <a href={`${TESTNET_EXPLORER}/tx/${notice.hash}`} target="_blank" rel="noreferrer">
            <ArrowUpRight size={16} />
            {shortKey(notice.hash)}
          </a>
        )}
        {contractLink && (
          <a href={contractLink} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Contract
          </a>
        )}
        <span>{lastSync ? formatDate(lastSync) : "No sync yet"}</span>
      </div>
    </section>
  );
}

function ContractPanel({
  contractId,
  validContract,
  rpcUrl,
  deploymentLink,
  fetching,
  onContractId,
  onRefresh,
}: {
  contractId: string;
  validContract: boolean;
  rpcUrl: string;
  deploymentLink: string;
  fetching: boolean;
  onContractId: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="panel-band contract-panel" aria-label="Contract">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Soroban</p>
          <h2>{validContract ? shortKey(contractId) : "Contract slot"}</h2>
        </div>
        <Cable size={22} />
      </div>

      <label>
        <span>Contract ID</span>
        <input
          className={contractId && !validContract ? "input-error" : ""}
          value={contractId}
          onChange={(event) => onContractId(event.target.value)}
          placeholder="C..."
        />
      </label>

      <div className="detail-grid">
        <div>
          <span>RPC</span>
          <strong>{rpcUrl.replace("https://", "")}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>TESTNET</strong>
        </div>
        <div>
          <span>Deploy TX</span>
          <strong>{deploymentLink ? "Available" : "Pending"}</strong>
        </div>
        <div>
          <span>Validity</span>
          <strong>{validContract ? "Ready" : "Needs C..."}</strong>
        </div>
      </div>

      <div className="action-row">
        <button className="icon-text secondary" type="button" onClick={onRefresh}>
          {fetching ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
          Sync
        </button>
        {deploymentLink && (
          <a className="icon-text ghost" href={deploymentLink} target="_blank" rel="noreferrer">
            <ExternalLink size={18} />
            Deploy tx
          </a>
        )}
      </div>
    </section>
  );
}

function LiveEventsPanel({
  events,
  loading,
  refreshing,
}: {
  events: ContractEvent[];
  loading: boolean;
  refreshing: boolean;
}) {
  return (
    <section className="panel-band live-panel" aria-label="Live contract events">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live events</p>
          <h2>{loading ? "Syncing" : `${events.length} signals`}</h2>
        </div>
        {refreshing ? <Loader2 className="spin" size={22} /> : <BellRing size={22} />}
      </div>

      <div className="event-stream">
        {loading ? (
          <EventSkeletons />
        ) : events.length === 0 ? (
          <div className="empty-state">Waiting for contract events.</div>
        ) : (
          events.map((event) => (
            <article className="event-row" key={event.id}>
              <div className="event-beat" />
              <div>
                <strong>
                  {event.topic} / {event.amountXlm} XLM
                </strong>
                <span>{event.billId}</span>
              </div>
              <a href={`${TESTNET_EXPLORER}/tx/${event.txHash}`} target="_blank" rel="noreferrer">
                {shortKey(event.txHash)}
              </a>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function EventSkeletons() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <article className="event-row skeleton-event" key={index}>
          <div className="event-beat skeleton-block" />
          <div>
            <SkeletonText width="10rem" />
            <SkeletonText width="7rem" />
          </div>
          <SkeletonText width="5.5rem" />
        </article>
      ))}
    </>
  );
}

function ActivityPanel({ activity }: { activity: ActivityItem[] }) {
  return (
    <section className="panel-band activity-panel" aria-label="Activity feed">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>Feed</h2>
        </div>
        <Zap size={22} />
      </div>

      <div className="activity-feed">
        {activity.map((item) => (
          <article className={`activity-item ${item.tone}`} key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            {item.hash ? (
              <a href={`${TESTNET_EXPLORER}/tx/${item.hash}`} target="_blank" rel="noreferrer">
                <ArrowUpRight size={15} />
              </a>
            ) : (
              <time>{formatDate(item.createdAt)}</time>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function WalletPanel({
  wallet,
  options,
  balance,
  networkName,
  notice,
  busy,
  onOpen,
  onRefresh,
  onFund,
  onDisconnect,
}: {
  wallet: WalletConnection | null;
  options: WalletOption[];
  balance: string | null;
  networkName: string;
  notice: Notice;
  busy: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onFund: () => void;
  onDisconnect: () => void;
}) {
  return (
    <section className="panel-band wallet-panel" aria-label="Wallet">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Wallet kit</p>
          <h2>{wallet ? wallet.name : "Multi-wallet"}</h2>
        </div>
        <Wallet size={22} />
      </div>

      <div className="wallet-display">
        <strong>{formatBalance(balance)}</strong>
        <span>XLM</span>
      </div>

      <StatusNotice notice={notice} />

      <div className="wallet-option-row">
        {options.map((option) => (
          <div className="mini-wallet" style={{ "--accent": option.accent } as React.CSSProperties} key={option.id}>
            <span>{option.name}</span>
            <strong>
              {option.installed === true
                ? "Ready"
                : option.installed === false
                  ? "Install"
                  : "Kit"}
            </strong>
          </div>
        ))}
      </div>

      <div className="detail-grid">
        <div>
          <span>Address</span>
          <strong>{wallet ? shortKey(wallet.address) : "None"}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>{networkName}</strong>
        </div>
      </div>

      <div className="action-row">
        <button className="icon-text primary" type="button" onClick={onOpen} disabled={busy}>
          {busy ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
          Wallets
        </button>
        <button className="icon-text secondary" type="button" onClick={onFund} disabled={!wallet || busy}>
          <Sparkles size={18} />
          Fund
        </button>
        <button className="icon-text ghost" type="button" onClick={onRefresh} disabled={!wallet || busy}>
          <RefreshCcw size={18} />
          Refresh
        </button>
        {wallet && (
          <button className="icon-text ghost" type="button" onClick={onDisconnect}>
            <X size={18} />
            Disconnect
          </button>
        )}
      </div>

      <a className="install-link" href={FREIGHTER_INSTALL_URL} target="_blank" rel="noreferrer">
        <ExternalLink size={15} />
        Freighter
      </a>
    </section>
  );
}

function ErrorMatrix() {
  const errors = [
    {
      title: "Wallet not found",
      detail: "Shown when a selected wallet is unavailable.",
      icon: <AlertTriangle size={18} />,
    },
    {
      title: "Rejected",
      detail: "Shown when a wallet request is declined.",
      icon: <X size={18} />,
    },
    {
      title: "Insufficient balance",
      detail: "Shown before contract writes without testnet XLM.",
      icon: <CreditCard size={18} />,
    },
  ];

  return (
    <section className="panel-band error-panel" aria-label="Handled errors">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Error handling</p>
          <h2>3 routes</h2>
        </div>
        <BadgeCheck size={22} />
      </div>

      <div className="error-grid">
        {errors.map((error) => (
          <article className="error-route" key={error.title}>
            {error.icon}
            <strong>{error.title}</strong>
            <span>{error.detail}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function WalletModal({
  options,
  busy,
  onClose,
  onConnect,
  onRefresh,
}: {
  options: WalletOption[];
  busy: boolean;
  onClose: () => void;
  onConnect: (wallet: WalletOption) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="wallet-modal" role="dialog" aria-modal="true" aria-label="Wallet options">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">StellarWalletsKit</p>
            <h2>Choose wallet</h2>
          </div>
          <button className="icon-only" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="wallet-grid-options">
          {options.map((option) => (
            <button
              className="wallet-choice"
              style={{ "--accent": option.accent } as React.CSSProperties}
              type="button"
              key={option.id}
              disabled={busy}
              onClick={() => onConnect(option)}
            >
              <span className="wallet-choice-icon">
                {option.installed === true ? <CheckCircle2 size={20} /> : <Wallet size={20} />}
              </span>
              <strong>{option.name}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>

        <div className="action-row">
          <button className="icon-text secondary" type="button" onClick={onRefresh} disabled={busy}>
            <RefreshCcw size={18} />
            Refresh
          </button>
          <a className="icon-text ghost" href={FREIGHTER_INSTALL_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={18} />
            Install Freighter
          </a>
        </div>
      </section>
    </div>
  );
}

function StatusNotice({ notice }: { notice: Notice }) {
  return (
    <div className={`status-line ${notice.type}`} aria-live="polite">
      {notice.type === "success" && <CheckCircle2 size={17} />}
      {notice.type === "error" && <AlertTriangle size={17} />}
      {notice.type === "warning" && <AlertTriangle size={17} />}
      {notice.type === "loading" && <Loader2 className="spin" size={17} />}
      {notice.type === "idle" && <span className="status-dot" />}
      <span>{notice.message}</span>
    </div>
  );
}

function SkeletonText({ width }: { width: string }) {
  return (
    <span
      className="skeleton-line"
      style={{ "--skeleton-width": width } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}

export default App;
