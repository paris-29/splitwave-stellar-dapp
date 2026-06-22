import { describe, expect, it } from "vitest";
import { isValidContractId, stroopsToXlm } from "./contractClient";

describe("contract client helpers", () => {
  it("formats whole stroop amounts as XLM", () => {
    expect(stroopsToXlm(52_0000000n)).toBe("52");
  });

  it("formats fractional stroop amounts without trailing zeroes", () => {
    expect(stroopsToXlm(6_5000000n)).toBe("6.5");
  });

  it("validates the deployed Splitwave contract id shape", () => {
    expect(
      isValidContractId("CAOLLM2HMYVVFNKBFJBQNZ27I6OVANUJFX5JKVVFYVHUEO2KGDYVEBBW"),
    ).toBe(true);
    expect(isValidContractId("GBAD")).toBe(false);
  });
});
