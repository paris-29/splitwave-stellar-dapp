import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { RPC_URL } from "./config";
import type { WalletConnection } from "./walletKit";
import { signWalletTransaction, WalletKitError } from "./walletKit";

export type ContractTxStage =
  | "idle"
  | "simulate"
  | "sign"
  | "submit"
  | "pending"
  | "success"
  | "failed";

export type BillSummary = {
  id: string;
  title: string;
  target: bigint;
  paid: bigint;
  contributors: number;
  updatedLedger: number;
};

export type ContractEvent = {
  id: string;
  txHash: string;
  ledger: number;
  closedAt: string;
  topic: string;
  billId: string;
  actor: string;
  amountXlm: string;
};

export class ContractClientError extends Error {
  code:
    | "missing_contract"
    | "bad_contract"
    | "insufficient_balance"
    | "simulation_failed"
    | "submission_failed";

  constructor(code: ContractClientError["code"], message: string) {
    super(message);
    this.name = "ContractClientError";
    this.code = code;
  }
}

const rpcServer = new rpc.Server(RPC_URL, { timeout: 25000 });

function decimalsToStroops(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,7})?$/.test(normalized)) {
    throw new ContractClientError(
      "simulation_failed",
      "Enter an XLM amount with up to 7 decimals.",
    );
  }

  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

export function stroopsToXlm(value: bigint | number | string) {
  const stroops = typeof value === "bigint" ? value : BigInt(value || 0);
  const sign = stroops < 0n ? "-" : "";
  const absolute = stroops < 0n ? -stroops : stroops;
  const whole = absolute / 10_000_000n;
  const fraction = (absolute % 10_000_000n).toString().padStart(7, "0");
  return `${sign}${whole}.${fraction}`.replace(/\.?0+$/, "");
}

export function isValidContractId(contractId: string) {
  return StrKey.isValidContract(contractId.trim());
}

export function getRpcServer() {
  return rpcServer;
}

function assertContractId(contractId: string) {
  const trimmed = contractId.trim();
  if (!trimmed) {
    throw new ContractClientError(
      "missing_contract",
      "Deploy the Splitwave contract and add VITE_SPLITWAVE_CONTRACT_ID.",
    );
  }
  if (!isValidContractId(trimmed)) {
    throw new ContractClientError("bad_contract", "Contract ID must start with C...");
  }
  return trimmed;
}

function contractArgs(
  billId: string,
  address: string,
  amountStroops: bigint,
  memo: string,
) {
  return [
    nativeToScVal(billId, { type: "string" }),
    new Address(address).toScVal(),
    nativeToScVal(amountStroops, { type: "i128" }),
    nativeToScVal(memo, { type: "string" }),
  ];
}

async function buildPreparedTransaction(
  source: string,
  contractId: string,
  method: string,
  args: Parameters<Contract["call"]> extends [string, ...infer Rest] ? Rest : never,
) {
  const account = await rpcServer.getAccount(source);
  const contract = new Contract(contractId);
  const raw = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  return rpcServer.prepareTransaction(raw);
}

async function pollContractTransaction(
  hash: string,
  onStage?: (stage: ContractTxStage) => void,
) {
  onStage?.("pending");

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const response = await rpcServer.getTransaction(hash);
    if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) return response;
    if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new ContractClientError(
        "submission_failed",
        "Contract transaction failed on Stellar testnet.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 150));
  }

  throw new ContractClientError(
    "submission_failed",
    "Transaction stayed pending longer than expected.",
  );
}

function normalizeSummary(value: unknown, fallbackId: string): BillSummary {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id ?? fallbackId),
    title: String(raw.title ?? "Daily bill"),
    target: BigInt(String(raw.target ?? 0)),
    paid: BigInt(String(raw.paid ?? 0)),
    contributors: Number(raw.contributors ?? 0),
    updatedLedger: Number(raw.updated_ledger ?? raw.updatedLedger ?? 0),
  };
}

export async function readBillSummary(
  contractId: string,
  source: string,
  billId: string,
) {
  const id = assertContractId(contractId);
  const account = await rpcServer.getAccount(source);
  const contract = new Contract(id);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call("summary", nativeToScVal(billId, { type: "string" })),
    )
    .setTimeout(60)
    .build();

  const simulated = await rpcServer.simulateTransaction(tx);
  if ("error" in simulated && simulated.error) {
    throw new ContractClientError("simulation_failed", simulated.error);
  }

  const nativeValue =
    "result" in simulated && simulated.result?.retval
      ? scValToNative(simulated.result.retval)
      : null;
  return normalizeSummary(nativeValue, billId);
}

export async function upsertBillOnContract({
  contractId,
  wallet,
  billId,
  title,
  targetXlm,
  onStage,
}: {
  contractId: string;
  wallet: WalletConnection;
  billId: string;
  title: string;
  targetXlm: string;
  onStage?: (stage: ContractTxStage) => void;
}) {
  const id = assertContractId(contractId);
  const target = decimalsToStroops(targetXlm);
  if (target <= 0n) {
    throw new ContractClientError("simulation_failed", "Goal must be greater than 0.");
  }

  onStage?.("simulate");
  const prepared = await buildPreparedTransaction(wallet.address, id, "upsert_bill", [
    new Address(wallet.address).toScVal(),
    nativeToScVal(billId, { type: "string" }),
    nativeToScVal(title, { type: "string" }),
    nativeToScVal(target, { type: "i128" }),
  ]);

  return submitPreparedContractTx(prepared, wallet, onStage);
}

export async function recordPaymentOnContract({
  contractId,
  wallet,
  balanceXlm,
  billId,
  amountXlm,
  memo,
  onStage,
}: {
  contractId: string;
  wallet: WalletConnection;
  balanceXlm: string | null;
  billId: string;
  amountXlm: string;
  memo: string;
  onStage?: (stage: ContractTxStage) => void;
}) {
  const id = assertContractId(contractId);
  const amount = decimalsToStroops(amountXlm);
  if (amount <= 0n) {
    throw new ContractClientError(
      "simulation_failed",
      "Payment amount must be greater than 0.",
    );
  }

  const balance = Number(balanceXlm ?? 0);
  if (!Number.isFinite(balance) || balance < 0.25) {
    throw new WalletKitError(
      "insufficient_balance",
      "Add testnet XLM before writing to the contract.",
    );
  }

  onStage?.("simulate");
  const prepared = await buildPreparedTransaction(
    wallet.address,
    id,
    "record_payment",
    contractArgs(billId, wallet.address, amount, memo.slice(0, 64)),
  );

  return submitPreparedContractTx(prepared, wallet, onStage);
}

async function submitPreparedContractTx(
  prepared: Transaction,
  wallet: WalletConnection,
  onStage?: (stage: ContractTxStage) => void,
) {
  onStage?.("sign");
  const signedXdr = await signWalletTransaction(wallet, prepared.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);

  onStage?.("submit");
  const submitted = await rpcServer.sendTransaction(signedTx);
  if (submitted.status === "ERROR") {
    throw new ContractClientError(
      "submission_failed",
      "Stellar RPC rejected the contract transaction.",
    );
  }

  const final = await pollContractTransaction(submitted.hash, onStage);
  onStage?.("success");

  return {
    hash: submitted.hash,
    ledger: "ledger" in final ? final.ledger : submitted.latestLedger,
  };
}

function nativeTopic(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return "";
}

export async function fetchContractEvents(contractId: string, lookback = 1600) {
  const id = assertContractId(contractId);
  const latest = await rpcServer.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - lookback);
  const response = await rpcServer.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [id] }],
    limit: 20,
  });

  return response.events
    .map((event): ContractEvent => {
      const topics = event.topic.map((topic) => nativeTopic(scValToNative(topic)));
      const amount = scValToNative(event.value);
      return {
        id: event.id,
        txHash: event.txHash,
        ledger: event.ledger,
        closedAt: event.ledgerClosedAt,
        topic: topics[0] || "contract",
        billId: topics[1] || "bill",
        actor: topics[2] || "",
        amountXlm: stroopsToXlm(BigInt(String(amount ?? 0))),
      };
    })
    .reverse();
}
