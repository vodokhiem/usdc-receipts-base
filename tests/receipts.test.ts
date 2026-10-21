import { describe, expect, it } from "vitest";
import {
  chunkRange,
  directionFor,
  formatUnitsFixed,
  formatUsdc,
  isRateLimitOrServerError,
  parseTransferLog,
  scanWindow,
} from "@/lib/receipts";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;
const TX = "0xb74a2c22cc5562306bad4c5da3a95aea5aa62651357d5b4120310f4740d77cb4" as const;

describe("formatUnitsFixed / formatUsdc", () => {
  it("keeps six decimals and never goes through a float", () => {
    expect(formatUnitsFixed(0n)).toBe("0.000000");
    expect(formatUnitsFixed(1n)).toBe("0.000001");
    expect(formatUnitsFixed(61_997_624n)).toBe("61.997624");
    expect(formatUnitsFixed(123_456_789_012_345_678_901n)).toBe("123456789012345.678901");
    expect(formatUnitsFixed(-2_500_000n)).toBe("-2.500000");
  });
  it("groups thousands and trims zeros to at least two digits", () => {
    expect(formatUsdc(1_000_000n)).toBe("1.00");
    expect(formatUsdc(1_234_567_890_000n)).toBe("1,234,567.89");
    expect(formatUsdc(61_997_624n)).toBe("61.997624");
  });
});

describe("directionFor", () => {
  it("is case-insensitive and distinguishes in/out/self", () => {
    expect(directionFor(A, A, B)).toBe("out");
    expect(directionFor(A, B, A)).toBe("in");
    expect(directionFor(A, A, A)).toBe("self");
    expect(directionFor(A.toUpperCase().replace("0X", "0x") as typeof A, B, A)).toBe("in");
    expect(() => directionFor(A, B, B)).toThrow();
  });
});

describe("parseTransferLog", () => {
  const log = {
    transactionHash: TX,
    logIndex: 2,
    blockNumber: 52_878_192n,
    blockTimestamp: 1_792_610_243n,
    args: { from: B, to: A, value: 61_997_624n },
  };
  it("builds a receipt with the log's own timestamp", () => {
    const r = parseTransferLog(log, A)!;
    expect(r.direction).toBe("in");
    expect(r.amountRaw).toBe(61_997_624n);
    expect(r.blockTimestamp).toBe(1_792_610_243n);
    expect(r.watchedAddress).toBe(A);
  });
  it("falls back to a provided timestamp when the RPC omits blockTimestamp", () => {
    const r = parseTransferLog({ ...log, blockTimestamp: undefined }, A, 5n)!;
    expect(r.blockTimestamp).toBe(5n);
    expect(() => parseTransferLog({ ...log, blockTimestamp: undefined }, A)).toThrow(/no timestamp/);
  });
  it("drops pending or removed logs", () => {
    expect(parseTransferLog({ ...log, removed: true }, A)).toBeNull();
    expect(parseTransferLog({ ...log, blockNumber: null }, A)).toBeNull();
    expect(parseTransferLog({ ...log, logIndex: null }, A)).toBeNull();
  });
});

describe("scanWindow", () => {
  const base = { overlap: 32, lookback: 1_000 };
  it("first run looks back from the given head", () => {
    expect(scanWindow({ ...base, head: 9_988n, cursor: null })).toEqual({ fromBlock: 8_988n, toBlock: 9_988n });
  });
  it("later runs resume behind the cursor by the overlap", () => {
    expect(scanWindow({ ...base, head: 9_988n, cursor: 9_988n })).toEqual({ fromBlock: 9_957n, toBlock: 9_988n });
    expect(scanWindow({ ...base, head: 10_088n, cursor: 9_988n })).toEqual({ fromBlock: 9_957n, toBlock: 10_088n });
  });
  it("clamps at genesis and rejects a negative head", () => {
    expect(scanWindow({ ...base, head: -5n, cursor: null })).toBeNull();
    expect(scanWindow({ ...base, head: 488n, cursor: null })).toEqual({ fromBlock: 0n, toBlock: 488n });
  });
  it("returns null when the cursor is already at the head and there is no overlap", () => {
    expect(scanWindow({ ...base, overlap: 0, head: 9_988n, cursor: 9_988n })).toBeNull();
  });
});

describe("chunkRange", () => {
  it("splits an inclusive range into inclusive chunks", () => {
    expect(chunkRange(0n, 4_999n, 2_000)).toEqual([
      { fromBlock: 0n, toBlock: 1_999n },
      { fromBlock: 2_000n, toBlock: 3_999n },
      { fromBlock: 4_000n, toBlock: 4_999n },
    ]);
    expect(chunkRange(10n, 10n, 2_000)).toEqual([{ fromBlock: 10n, toBlock: 10n }]);
    expect(chunkRange(10n, 9n, 2_000)).toEqual([]);
    expect(() => chunkRange(0n, 1n, 0)).toThrow();
  });
});

describe("isRateLimitOrServerError", () => {
  it("recognises the public-RPC failure modes", () => {
    expect(isRateLimitOrServerError(new Error("request limit reached"))).toBe(true);
    expect(isRateLimitOrServerError(new Error("HTTP 429"))).toBe(true);
    expect(isRateLimitOrServerError(new Error("The request timed out."))).toBe(true);
    expect(isRateLimitOrServerError(new Error("invalid argument 0"))).toBe(false);
  });
});
