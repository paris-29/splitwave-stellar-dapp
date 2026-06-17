import { useEffect, useMemo, useState } from "react";
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
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
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
import coverArt from "./assets/splitwave-cover.svg";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx";
const STORAGE_KEY = "splitwave:lastWallet";

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

const initialFriends: Friend[] = [
  { id: "f-maya", name: "Maya", wallet: "" },
  { id: "f-zo", name: "Zo", wallet: "" },
  { id: "f-kai", name: "Kai", wallet: "" },
];

const initialGroups: SplitGroup[] = [
  { id: "g-roomies", name: "Roomies", friendIds: ["f-maya", "f-zo"] },
  { id: "g-weekend", name: "Weekend", friendIds: ["f-maya", "f-kai"] },
];

const horizon = new Horizon.Server(HORIZON_URL);

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

function App() {
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
  const [isWalletBusy, setIsWalletBusy] = useState(false);
  const [isTxBusy, setIsTxBusy] = useState(false);
  const [friends, setFriends] = useState<Friend[]>(initialFriends);
  const [groups, setGroups] = useState<SplitGroup[]>(initialGroups);
  const [activeGroupId, setActiveGroupId] = useState(initialGroups[0].id);
  const [newGroupName, setNewGroupName] = useState("");
  const [newFriendName, setNewFriendName] = useState("");
  const [newFriendWallet, setNewFriendWallet] = useState("");
  const [billTitle, setBillTitle] = useState("Afterparty dinner");
  const [billTotal, setBillTotal] = useState("48");
  const [payer, setPayer] = useState("friend");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [copiedRequestId, setCopiedRequestId] = useState("");

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? groups[0],
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
  const connected = Boolean(publicKey);
  const onTestnet = networkName === "TESTNET";

  async function refreshNetworkAndBalance(address = publicKey) {
    if (!address) return;
    try {
      const details = await getNetworkDetails();
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
      const installed = await isConnected();
      if (!installed.isConnected) {
        setWalletNotice({
          type: "idle",
          message: "Install Freighter to connect a Stellar wallet.",
        });
        return;
      }

      const addressResult = await getAddress();
      const remembered = localStorage.getItem(STORAGE_KEY);
      const address = addressResult.address || remembered || "";

      if (address) {
        setPublicKey(address);
        await refreshNetworkAndBalance(address);
      }
    } catch {
      setWalletNotice({
        type: "idle",
        message: "Wallet disconnected",
      });
    } finally {
      setIsWalletBusy(false);
    }
  }

  async function connectWallet() {
    setIsWalletBusy(true);
    setWalletNotice({ type: "loading", message: "Waiting for Freighter..." });
    try {
      const installed = await isConnected();
      if (installed.error) throw new Error(installed.error.message);
      if (!installed.isConnected) {
        throw new Error("Freighter extension is not installed.");
      }

      const access = await requestAccess();
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
    const message = `${friend.name} owes ${splitShareText} XLM for ${billTitle} in ${activeGroup.name}.`;
    await navigator.clipboard.writeText(message);
    setCopiedRequestId(friend.id);
    window.setTimeout(() => setCopiedRequestId(""), 1600);
  }

  async function sendPayment() {
    const destination = recipientAddress.trim();
    const amount = formatXlm(Number(sendAmount || splitShareText));

    setTransactionNotice({
      type: "loading",
      message: "Building Stellar testnet transaction...",
    });
    setIsTxBusy(true);

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

      const signed = await signTransaction(tx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
        address: publicKey,
      });
      if (signed.error) throw new Error(signed.error.message);

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
      await refreshNetworkAndBalance(publicKey);
    } catch (error) {
      setTransactionNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setIsTxBusy(false);
    }
  }

  useEffect(() => {
    void restoreWallet();
  }, []);

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <button className="rail-button active" aria-label="Split studio">
          <CircleDollarSign size={19} />
        </button>
        <button className="rail-button" aria-label="Groups">
          <Users size={19} />
        </button>
        <button className="rail-button" aria-label="Wallet">
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

        <section className="dashboard-grid">
          <div className="visual-panel">
            <img src={coverArt} alt="" />
            <div className="visual-copy">
              <p className="eyebrow">Group</p>
              <h2>{activeGroup?.name}</h2>
              <p>{participantCount} people splitting {formatXlm(Number(billTotal) || 0)} XLM</p>
            </div>
          </div>

          <section className="panel wallet-panel" aria-label="Wallet">
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
              <span>{formatBalance(balance)}</span>
              <strong>XLM</strong>
            </div>

            <StatusNotice notice={walletNotice} />

            <div className="wallet-actions">
              <button
                className="icon-text secondary"
                onClick={fundWallet}
                disabled={!connected || isWalletBusy || !onTestnet}
              >
                {isWalletBusy ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
                Fund testnet
              </button>
              {!connected && (
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

          <section className="panel split-panel" aria-label="Split calculator">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Split</p>
                <h2>{billTitle}</h2>
              </div>
              <span className="share-chip">{splitShareText} XLM each</span>
            </div>

            <div className="form-grid">
              <label>
                <span>Bill name</span>
                <input
                  value={billTitle}
                  onChange={(event) => setBillTitle(event.target.value)}
                  maxLength={40}
                />
              </label>
              <label>
                <span>Total XLM</span>
                <input
                  value={billTotal}
                  onChange={(event) => setBillTotal(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                <span>Paid by</span>
                <select value={payer} onChange={(event) => setPayer(event.target.value)}>
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
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={group.id === activeGroupId ? "group-tab active" : "group-tab"}
                  onClick={() => setActiveGroupId(group.id)}
                >
                  {group.name}
                </button>
              ))}
            </div>

            <div className="inline-form">
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder="New group"
                maxLength={22}
              />
              <button className="icon-only" onClick={addGroup} aria-label="Add group" title="Add group">
                <Plus size={18} />
              </button>
            </div>
          </section>

          <section className="panel friends-panel" aria-label="Friends">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Friends</p>
                <h2>{activeGroup?.name}</h2>
              </div>
              <span className="count-badge">{groupFriends.length}</span>
            </div>

            <div className="friend-list">
              {groupFriends.map((friend) => (
                <article className="friend-card" key={friend.id}>
                  <div className="avatar" aria-hidden="true">
                    {friend.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="friend-main">
                    <strong>{friend.name}</strong>
                    <input
                      value={friend.wallet}
                      onChange={(event) => updateFriendWallet(friend.id, event.target.value)}
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
              ))}
            </div>

            <div className="friend-add">
              <input
                value={newFriendName}
                onChange={(event) => setNewFriendName(event.target.value)}
                placeholder="Friend name"
                maxLength={24}
              />
              <input
                value={newFriendWallet}
                onChange={(event) => setNewFriendWallet(event.target.value)}
                placeholder="Optional G... wallet"
              />
              <button className="icon-only" onClick={addFriend} aria-label="Add friend" title="Add friend">
                <Plus size={18} />
              </button>
            </div>
          </section>

          <section className="panel send-panel" aria-label="Send XLM">
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

          <section className="panel requests-panel" aria-label="Split requests">
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
                  <article className="request-card" key={friend.id}>
                    <div>
                      <strong>{friend.name}</strong>
                      <span>{splitShareText} XLM</span>
                    </div>
                    <button className="icon-text ghost compact" onClick={() => copyRequest(friend)}>
                      {copiedRequestId === friend.id ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                      {copiedRequestId === friend.id ? "Copied" : "Copy"}
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
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
