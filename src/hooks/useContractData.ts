import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchContractEvents,
  readBillSummary,
  type BillSummary,
  type ContractEvent,
} from "../stellar/contractClient";

const normalize = (value: string) => value.trim();

export const contractDataKeys = {
  summary: (contractId: string, sourceAddress: string, billId: string) =>
    [
      "contract",
      "summary",
      normalize(contractId),
      normalize(sourceAddress),
      normalize(billId),
    ] as const,
  events: (contractId: string) => ["contract", "events", normalize(contractId)] as const,
};

export function useBillSummaryQuery({
  contractId,
  sourceAddress,
  billId,
  enabled,
}: {
  contractId: string;
  sourceAddress: string;
  billId: string;
  enabled: boolean;
}) {
  const normalizedContractId = normalize(contractId);
  const normalizedSource = normalize(sourceAddress);
  const normalizedBillId = normalize(billId);

  return useQuery<BillSummary>({
    queryKey: contractDataKeys.summary(
      normalizedContractId,
      normalizedSource,
      normalizedBillId,
    ),
    queryFn: () =>
      readBillSummary(normalizedContractId, normalizedSource, normalizedBillId),
    enabled:
      enabled &&
      Boolean(normalizedContractId && normalizedSource && normalizedBillId),
    staleTime: 8_000,
    gcTime: 10 * 60_000,
    refetchInterval: enabled ? 15_000 : false,
    refetchOnWindowFocus: true,
  });
}

export function useContractEventsQuery({
  contractId,
  enabled,
}: {
  contractId: string;
  enabled: boolean;
}) {
  const normalizedContractId = normalize(contractId);

  return useQuery<ContractEvent[]>({
    queryKey: contractDataKeys.events(normalizedContractId),
    queryFn: () => fetchContractEvents(normalizedContractId),
    enabled: enabled && Boolean(normalizedContractId),
    staleTime: 12_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: enabled ? 7_500 : false,
    refetchOnWindowFocus: true,
  });
}
