/**
 * Pull USDC Transfer logs for every watched address into the receipts table.
 *
 * Per address and per run:
 *   1. window  = scanWindow(head, cursor, confirmations, overlap, lookback)
 *   2. for each <=2000-block chunk: two eth_getLogs calls (from=addr, to=addr), with backoff
 *   3. upsert rows keyed by (tx_hash, log_index, watched_address)  -> re-running is a no-op
 *   4. advance the cursor only after every chunk succeeded
 *
 * Only blocks at least `confirmations` deep are read, and each run re-reads `overlap` blocks
 * behind the cursor, so a shallow reorg between runs is corrected on the next pass.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { Db } from "@/db";
import { ingestRuns, receipts, watchedAddresses } from "@/db/schema";
import { USDC_ADDRESS, transferEvent, type BaseClient } from "./chain";
import { ingestConfig } from "./env";
import {
  chunkRange,
  isRateLimitOrServerError,
  parseTransferLog,
  scanWindow,
  type Receipt,
  type TransferLogLike,
} from "./receipts";

/** The slice of the chain the ingester touches; narrow so tests can fake it. */
export interface ChainReader {
  getBlockNumber(): Promise<bigint>;
  getTransferLogs(q: { fromBlock: bigint; toBlock: bigint; from?: Address; to?: Address }): Promise<TransferLogLike[]>;
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
}

export function viemChainReader(client: BaseClient): ChainReader {
  return {
    getBlockNumber: () => client.getBlockNumber(),
    getTransferLogs: ({ fromBlock, toBlock, from, to }) =>
      client.getLogs({
        address: USDC_ADDRESS,
        event: transferEvent,
        args: from ? { from } : { to },
        fromBlock,
        toBlock,
      }),
    getBlockTimestamp: async (n) => (await client.getBlock({ blockNumber: n })).timestamp,
  };
}

export interface IngestOptions {
  confirmations?: number;
  reorgOverlap?: number;
  lookbackBlocks?: number;
  chunkBlocks?: number;
  /** Backoff base delay in ms; tests set 0. */
  backoffMs?: number;
  maxAttempts?: number;
  log?: (msg: string) => void;
}

export interface IngestResult {
  address: Address;
  fromBlock: bigint | null;
  toBlock: bigint | null;
  logsFound: number;
  rowsUpserted: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withBackoff<T>(fn: () => Promise<T>, baseMs: number, maxAttempts: number): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRateLimitOrServerError(err)) throw err;
      await sleep(baseMs * 2 ** (attempt - 1));
    }
  }
}

export async function ingestAddress(
  db: Db,
  chain: ChainReader,
  address: Address,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const cfg = { ...ingestConfig(), ...stripUndefined(opts) };
  const backoffMs = opts.backoffMs ?? 500;
  const maxAttempts = opts.maxAttempts ?? 5;
  const log = opts.log ?? (() => {});

  const [row] = await db.select().from(watchedAddresses).where(eq(watchedAddresses.address, address));
  if (!row) throw new Error(`address ${address} is not watched`);

  const head = await chain.getBlockNumber();
  const window = scanWindow({
    head,
    cursor: row.cursorBlock,
    confirmations: cfg.confirmations,
    overlap: cfg.reorgOverlap,
    lookback: cfg.lookbackBlocks,
  });
  const result: IngestResult = { address, fromBlock: null, toBlock: null, logsFound: 0, rowsUpserted: 0 };
  if (!window) return result;
  result.fromBlock = window.fromBlock;
  result.toBlock = window.toBlock;

  const [run] = await db
    .insert(ingestRuns)
    .values({ watchedAddress: address, fromBlock: window.fromBlock, toBlock: window.toBlock })
    .returning({ id: ingestRuns.id });

  try {
    const timestampCache = new Map<bigint, bigint>();
    for (const chunk of chunkRange(window.fromBlock, window.toBlock, cfg.chunkBlocks)) {
      const [outgoing, incoming] = await Promise.all([
        withBackoff(() => chain.getTransferLogs({ ...chunk, from: address }), backoffMs, maxAttempts),
        withBackoff(() => chain.getTransferLogs({ ...chunk, to: address }), backoffMs, maxAttempts),
      ]);
      // A self-transfer appears in both queries; parse once per (tx, logIndex).
      const seen = new Set<string>();
      const parsed: Receipt[] = [];
      for (const l of [...outgoing, ...incoming]) {
        const key = `${l.transactionHash}#${l.logIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let fallback: bigint | undefined;
        if (l.blockTimestamp == null && l.blockNumber != null) {
          fallback = timestampCache.get(l.blockNumber);
          if (fallback === undefined) {
            fallback = await withBackoff(() => chain.getBlockTimestamp(l.blockNumber!), backoffMs, maxAttempts);
            timestampCache.set(l.blockNumber, fallback);
          }
        }
        const r = parseTransferLog(l, address, fallback);
        if (r) parsed.push(r);
      }
      result.logsFound += parsed.length;
      result.rowsUpserted += await upsertReceipts(db, parsed);
      log(`${address} blocks ${chunk.fromBlock}-${chunk.toBlock}: ${parsed.length} transfers`);
    }

    await db
      .update(watchedAddresses)
      .set({ cursorBlock: window.toBlock })
      .where(eq(watchedAddresses.address, address));
    await db
      .update(ingestRuns)
      .set({ logsFound: result.logsFound, rowsUpserted: result.rowsUpserted, finishedAt: new Date() })
      .where(eq(ingestRuns.id, run.id));
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await db
      .update(ingestRuns)
      .set({ logsFound: result.logsFound, rowsUpserted: result.rowsUpserted, error: result.error, finishedAt: new Date() })
      .where(and(eq(ingestRuns.id, run.id)));
  }
  return result;
}

export async function ingestAll(db: Db, chain: ChainReader, opts: IngestOptions = {}): Promise<IngestResult[]> {
  const rows = await db.select({ address: watchedAddresses.address }).from(watchedAddresses);
  const out: IngestResult[] = [];
  for (const { address } of rows) {
    out.push(await ingestAddress(db, chain, address as Address, opts));
  }
  return out;
}

async function upsertReceipts(db: Db, rows: Receipt[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => ({
    txHash: r.txHash,
    logIndex: r.logIndex,
    watchedAddress: r.watchedAddress,
    blockNumber: r.blockNumber,
    blockTimestamp: r.blockTimestamp,
    fromAddress: r.from,
    toAddress: r.to,
    amountRaw: r.amountRaw.toString(),
    direction: r.direction,
  }));
  const inserted = await db
    .insert(receipts)
    .values(values)
    .onConflictDoUpdate({
      target: [receipts.txHash, receipts.logIndex, receipts.watchedAddress],
      // After a reorg the same (tx, logIndex) can land in a different block.
      set: {
        blockNumber: sql`excluded.block_number`,
        blockTimestamp: sql`excluded.block_timestamp`,
        amountRaw: sql`excluded.amount_raw`,
        fromAddress: sql`excluded.from_address`,
        toAddress: sql`excluded.to_address`,
        direction: sql`excluded.direction`,
      },
    })
    .returning({ txHash: receipts.txHash });
  return inserted.length;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
