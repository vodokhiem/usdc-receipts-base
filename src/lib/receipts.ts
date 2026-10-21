/**
 * Pure functions: no I/O, fully unit-tested.
 * Money stays a bigint until it is rendered; floats never touch it.
 */
import { getAddress, type Address, type Hex } from "viem";
import { USDC_DECIMALS } from "./chain";

export type Direction = "in" | "out" | "self";

export interface Receipt {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  /** Unix seconds. */
  blockTimestamp: bigint;
  from: Address;
  to: Address;
  /** Raw token units (6 decimals for USDC). */
  amountRaw: bigint;
  watchedAddress: Address;
  direction: Direction;
}

/** The subset of a viem Transfer log the parser needs. */
export interface TransferLogLike {
  transactionHash: Hex | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  blockTimestamp?: bigint | null;
  removed?: boolean;
  args: { from?: Address; to?: Address; value?: bigint };
}

/** Format raw units as a decimal string with exactly `decimals` fraction digits. */
export function formatUnitsFixed(raw: bigint, decimals = USDC_DECIMALS): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Human display: thousands separators, trailing zeros trimmed to at least 2 digits. */
export function formatUsdc(raw: bigint): string {
  const [whole, frac] = formatUnitsFixed(raw).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.replace(/0+$/, "");
  return `${grouped}.${trimmed.length < 2 ? trimmed.padEnd(2, "0") : trimmed}`;
}

export function directionFor(watched: Address, from: Address, to: Address): Direction {
  const w = watched.toLowerCase();
  const isFrom = from.toLowerCase() === w;
  const isTo = to.toLowerCase() === w;
  if (isFrom && isTo) return "self";
  if (isFrom) return "out";
  if (isTo) return "in";
  throw new Error(`log does not involve watched address ${watched}`);
}

/**
 * Convert a Transfer log into a receipt for `watched`.
 * Returns null for pending/removed logs, which must never be stored.
 * `fallbackTimestamp` is used when the RPC does not include blockTimestamp in logs.
 */
export function parseTransferLog(
  log: TransferLogLike,
  watched: Address,
  fallbackTimestamp?: bigint,
): Receipt | null {
  if (log.removed) return null;
  if (log.transactionHash == null || log.logIndex == null || log.blockNumber == null) return null;
  const { from, to, value } = log.args;
  if (from === undefined || to === undefined || value === undefined) return null;
  const ts = log.blockTimestamp ?? fallbackTimestamp;
  if (ts == null) throw new Error(`no timestamp for log ${log.transactionHash}#${log.logIndex}`);
  const watchedChecksum = getAddress(watched);
  return {
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    blockTimestamp: ts,
    from: getAddress(from),
    to: getAddress(to),
    amountRaw: value,
    watchedAddress: watchedChecksum,
    direction: directionFor(watchedChecksum, from, to),
  };
}

export interface ScanWindow {
  fromBlock: bigint;
  toBlock: bigint;
}

/**
 * Decide which blocks to scan this run, given the highest block we are willing to store (`head`).
 * - first run: look back `lookback` blocks
 * - later runs: resume from the cursor minus `overlap` so a shallow reorg is re-read
 * Returns null when there is nothing new to scan.
 */
export function scanWindow(opts: { head: bigint; cursor: bigint | null; overlap: number; lookback: number }): ScanWindow | null {
  if (opts.head < 0n) return null;
  let from: bigint;
  if (opts.cursor == null) {
    from = opts.head - BigInt(opts.lookback);
  } else {
    from = opts.cursor + 1n - BigInt(opts.overlap);
  }
  if (from < 0n) from = 0n;
  if (from > opts.head) return null;
  return { fromBlock: from, toBlock: opts.head };
}

/** Split [from, to] (inclusive) into inclusive chunks of at most `size` blocks. */
export function chunkRange(from: bigint, to: bigint, size: number): ScanWindow[] {
  if (size <= 0) throw new Error("chunk size must be positive");
  if (to < from) return [];
  const out: ScanWindow[] = [];
  const step = BigInt(size);
  for (let start = from; start <= to; start += step) {
    const end = start + step - 1n < to ? start + step - 1n : to;
    out.push({ fromBlock: start, toBlock: end });
  }
  return out;
}

export function isRateLimitOrServerError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate limit|limit reached|timeout|timed out|502|503|504|ECONNRESET/i.test(msg);
}
