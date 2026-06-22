import { describe, expect, it } from "vitest";
import { contractDataKeys } from "./useContractData";

describe("contract data query keys", () => {
  it("normalizes bill summary cache keys", () => {
    expect(contractDataKeys.summary(" C123 ", " GABC ", " daily ")).toEqual([
      "contract",
      "summary",
      "C123",
      "GABC",
      "daily",
    ]);
  });

  it("normalizes event stream cache keys", () => {
    expect(contractDataKeys.events(" C456 ")).toEqual([
      "contract",
      "events",
      "C456",
    ]);
  });
});
