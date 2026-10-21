/**
 * Pull USDC Transfer logs for every watched address into the receipts table.
 *
 * Per address and per run:
 *   1. head   = block number of HEAD_TAG (safe by default) minus CONFIRMATIONS
 *   2. window = scanWindow(head, cursor, overlap, lookback)
 *   3. for each <=2000-block chunk, in one transaction:
 *        - two eth_getLogs calls (from=addr, to=addr), with backoff
 *        - upsert the logs found, keyed by (tx_hash, log_index, watched_address)
 *        - delete rows in that block range that the chain no longer reports
 *   4. advance the cursor only after every chunk succeeded
 *
 * Re-reading `overlap` blocks behind the cursor on every run, and deleting what is no longer
 * there, is what makes a reorg inside the overlap self-correcting. A reorg deeper than the
 * overlap (impossible below `safe` unless L1 reorgs, impossible below `finalized`) is not handled.
 *
 * A per-address advisory lock stops two overlapping cron runs from racing on the same cursor.
 */
import { and, asc, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { Db } from "@/db";
import { ingestRuns, receipts, watchedAddresses } from "@/db/schema";
import { USDC_ADDRESS, headBlockNumber, transferEvent, type BaseClient } from "./chain";
import { ingestConfig, type HeadTag } from "./env";
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
  getHeadBlockNumber(tag: HeadTag): Promise<bigint>;
  getTransferLogs(q: { fromBlock: bigint; toBlock: bigint; from?: Address; to?: Address }): Promise<TransferLogLike[]>;
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
}

export function viemChainReader(client: BaseClient): ChainReader {
  return {
    getHeadBlockNumber: (tag) => headBlockNumber(client, tag),
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
  headTag?: HeadTag;
  confirmations?: number;
  reorgOverlap?: number;
  lookbackBlocks?: number;
  chunkBlocks?: number;
  timeBudgetMs?: number;
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
  rowsWritten: number;
  rowsDeleted: number;
  skipped?: "locked" | "time-budget";
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

/** postgres-js returns the rows array itself; PGlite returns { rows }. */
async function rawRows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const res: unknown = await db.execute(query);
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

/** Stable 32-bit lock key per address (Postgres advisory locks take integers). */
function lockKey(address: string): number {
  let h = 0;
  for (const ch of address.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
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
  const result: IngestResult = { address, fromBlock: null, toBlock: null, logsFound: 0, rowsWritten: 0, rowsDeleted: 0 };

  const [row] = await db.select().from(watchedAddresses).where(eq(watchedAddresses.address, address));
  if (!row) throw new Error(`address ${address} is not watched`);

  // Session-level advisory lock: released explicitly below, or when the connection drops.
  const [{ locked }] = await rawRows<{ locked: boolean }>(db, sql`select pg_try_advisory_lock(${lockKey(address)}) as locked`);
  if (!locked) {
    result.skipped = "locked";
    return result;
  }

  try {
    const head = (await chain.getHeadBlockNumber(cfg.headTag)) - BigInt(cfg.confirmations);
    const window = scanWindow({ head, cursor: row.cursorBlock, overlap: cfg.reorgOverlap, lookback: cfg.lookbackBlocks });
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
        const { written, deleted } = await reconcileChunk(db, address, chunk, parsed);
        result.logsFound += parsed.length;
        result.rowsWritten += written;
        result.rowsDeleted += deleted;
        log(`${address} blocks ${chunk.fromBlock}-${chunk.toBlock}: ${parsed.length} transfers, ${deleted} removed`);
      }

      await db.update(watchedAddresses).set({ cursorBlock: window.toBlock }).where(eq(watchedAddresses.address, address));
      await db
        .update(ingestRuns)
        .set({ logsFound: result.logsFound, rowsWritten: result.rowsWritten, rowsDeleted: result.rowsDeleted, finishedAt: new Date() })
        .where(eq(ingestRuns.id, run.id));
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      await db
        .update(ingestRuns)
        .set({ logsFound: result.logsFound, rowsWritten: result.rowsWritten, rowsDeleted: result.rowsDeleted, error: result.error, finishedAt: new Date() })
        .where(eq(ingestRuns.id, run.id));
    }
    return result;
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${lockKey(address)})`);
  }
}

/**
 * Ingest every watched address, least-recently-scanned first, until the time budget is spent.
 * Addresses that did not get a turn are reported as skipped and picked up next run.
 */
export async function ingestAll(db: Db, chain: ChainReader, opts: IngestOptions = {}): Promise<IngestResult[]> {
  const budget = opts.timeBudgetMs ?? ingestConfig().timeBudgetMs;
  const started = Date.now();
  const rows = await db
    .select({ address: watchedAddresses.address })
    .from(watchedAddresses)
    .orderBy(asc(sql`coalesce(${watchedAddresses.cursorBlock}, 0)`), asc(watchedAddresses.createdAt));
  const out: IngestResult[] = [];
  for (const { address } of rows) {
    if (Date.now() - started > budget) {
      out.push({ address: address as Address, fromBlock: null, toBlock: null, logsFound: 0, rowsWritten: 0, rowsDeleted: 0, skipped: "time-budget" });
      continue;
    }
    out.push(await ingestAddress(db, chain, address as Address, opts));
  }
  return out;
}

/**
 * Inside one transaction: upsert what the chain reports for this block range, then delete any
 * row for this address in the same range that the chain did not report. That second step is
 * what removes a transfer dropped by a reorg (or re-keyed to a different logIndex).
 */
async function reconcileChunk(
  db: Db,
  address: Address,
  chunk: { fromBlock: bigint; toBlock: bigint },
  rows: Receipt[],
): Promise<{ written: number; deleted: number }> {
  return db.transaction(async (tx) => {
    let written = 0;
    if (rows.length > 0) {
      const inserted = await tx
        .insert(receipts)
        .values(
          rows.map((r) => ({
            txHash: r.txHash,
            logIndex: r.logIndex,
            watchedAddress: r.watchedAddress,
            blockNumber: r.blockNumber,
            blockTimestamp: r.blockTimestamp,
            fromAddress: r.from,
            toAddress: r.to,
            amountRaw: r.amountRaw.toString(),
            direction: r.direction,
          })),
        )
        .onConflictDoUpdate({
          target: [receipts.txHash, receipts.logIndex, receipts.watchedAddress],
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
      written = inserted.length;
    }
    const keep = rows.map((r) => `${r.txHash}#${r.logIndex}`);
    const inRange = and(
      eq(receipts.watchedAddress, address),
      gte(receipts.blockNumber, chunk.fromBlock),
      lte(receipts.blockNumber, chunk.toBlock),
    );
    const gone = await tx
      .delete(receipts)
      .where(keep.length > 0 ? and(inRange, notInArray(sql`${receipts.txHash} || '#' || ${receipts.logIndex}`, keep)) : inRange)
      .returning({ txHash: receipts.txHash });
    return { written, deleted: gone.length };
  });
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
