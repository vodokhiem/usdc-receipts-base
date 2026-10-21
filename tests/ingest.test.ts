import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openPglite, type Db } from "@/db";
import { ingestRuns, receipts, watchedAddresses } from "@/db/schema";
import { ingestAddress, ingestAll, type ChainReader } from "@/lib/ingest";
import type { TransferLogLike } from "@/lib/receipts";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

function log(n: number, block: bigint, from: `0x${string}`, to: `0x${string}`, value: bigint): TransferLogLike {
  return { transactionHash: hash(n), logIndex: n % 7, blockNumber: block, blockTimestamp: block * 2n, args: { from, to, value } };
}

/** Fake chain: a fixed set of logs, served for whatever range is asked. */
function fakeChain(head: bigint, logs: TransferLogLike[], hooks: { failFirst?: number; calls?: { fromBlock: bigint; toBlock: bigint }[] } = {}): ChainReader {
  let failures = hooks.failFirst ?? 0;
  return {
    getHeadBlockNumber: async (tag) => (tag === "latest" ? head : head - 12n),
    getTransferLogs: async ({ fromBlock, toBlock, from, to }) => {
      hooks.calls?.push({ fromBlock, toBlock });
      if (failures > 0) {
        failures -= 1;
        throw new Error("request limit reached");
      }
      return logs.filter((l) => {
        const b = l.blockNumber!;
        if (b < fromBlock || b > toBlock) return false;
        return from ? l.args.from === from : l.args.to === to;
      });
    },
    getBlockTimestamp: async (n) => n * 2n,
  };
}

let db: Db;
beforeEach(async () => {
  db = await openPglite();
  await db.insert(watchedAddresses).values({ address: A });
});

const opts = { headTag: "safe" as const, confirmations: 0, reorgOverlap: 32, lookbackBlocks: 1_000, chunkBlocks: 100, backoffMs: 0 };

describe("ingestAddress", () => {
  it("stores incoming, outgoing and self transfers once each, and advances the cursor", async () => {
    const logs = [log(1, 9_500n, B, A, 5_000_000n), log(2, 9_600n, A, B, 1_000_000n), log(3, 9_700n, A, A, 7n)];
    const r = await ingestAddress(db, fakeChain(10_000n, logs), A, opts);
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ fromBlock: 8_988n, toBlock: 9_988n, logsFound: 3, rowsWritten: 3, rowsDeleted: 0 });
    const rows = await db.select().from(receipts).orderBy(receipts.blockNumber);
    expect(rows.map((x) => x.direction)).toEqual(["in", "out", "self"]);
    expect(rows[0].amountRaw).toBe("5000000");
    const [w] = await db.select().from(watchedAddresses).where(eq(watchedAddresses.address, A));
    expect(w.cursorBlock).toBe(9_988n);
  });

  it("is idempotent: a second run over the same blocks creates no duplicates", async () => {
    const logs = [log(1, 9_500n, B, A, 5_000_000n)];
    await ingestAddress(db, fakeChain(10_000n, logs), A, opts);
    const again = await ingestAddress(db, fakeChain(10_000n, logs), A, opts);
    // overlap window re-reads 9_957..9_988: the log at 9_500 is outside it, nothing new
    expect(again.logsFound).toBe(0);
    const third = await ingestAddress(db, fakeChain(10_000n, logs), A, { ...opts, reorgOverlap: 600 });
    expect(third.logsFound).toBe(1);
    expect((await db.select().from(receipts)).length).toBe(1);
  });

  it("re-reads the overlap and corrects a row whose block changed after a reorg", async () => {
    await ingestAddress(db, fakeChain(10_000n, [log(1, 9_980n, B, A, 1n)]), A, opts);
    // same (tx, logIndex) now lands one block later
    await ingestAddress(db, fakeChain(10_050n, [log(1, 9_981n, B, A, 1n)]), A, opts);
    const rows = await db.select().from(receipts);
    expect(rows).toHaveLength(1);
    expect(rows[0].blockNumber).toBe(9_981n);
  });

  it("deletes a row that the chain no longer reports inside the overlap (reorg dropped the tx)", async () => {
    await ingestAddress(db, fakeChain(10_000n, [log(1, 9_980n, B, A, 1n), log(2, 9_200n, B, A, 2n)]), A, opts);
    expect((await db.select().from(receipts)).length).toBe(2);
    // next run: tx 1 (inside the 32-block overlap) is gone from the chain; tx 2 (outside) is untouched
    const r = await ingestAddress(db, fakeChain(10_050n, [log(2, 9_200n, B, A, 2n)]), A, opts);
    expect(r.rowsDeleted).toBe(1);
    const rows = await db.select().from(receipts);
    expect(rows.map((x) => x.txHash)).toEqual([hash(2)]);
  });

  it("deletes the old row when a reorg re-keys the transfer to a different logIndex", async () => {
    const before = log(1, 9_980n, B, A, 1n);
    await ingestAddress(db, fakeChain(10_000n, [before]), A, opts);
    const after = { ...before, logIndex: before.logIndex! + 1 };
    await ingestAddress(db, fakeChain(10_050n, [after]), A, opts);
    const rows = await db.select().from(receipts);
    expect(rows).toHaveLength(1);
    expect(rows[0].logIndex).toBe(after.logIndex);
  });

  it("stops at the safe head, not the latest block", async () => {
    const r = await ingestAddress(db, fakeChain(10_000n, []), A, opts);
    expect(r.toBlock).toBe(9_988n);
    const latest = await ingestAddress(db, fakeChain(10_000n, []), A, { ...opts, headTag: "latest" });
    expect(latest.toBlock).toBe(10_000n);
  });

  it("splits the window into chunks and asks for from= and to= separately", async () => {
    const calls: { fromBlock: bigint; toBlock: bigint }[] = [];
    await ingestAddress(db, fakeChain(10_000n, [], { calls }), A, opts);
    // 1001 blocks / 100 per chunk = 11 chunks, two queries each
    expect(calls).toHaveLength(22);
    expect(calls[0]).toEqual({ fromBlock: 8_988n, toBlock: 9_087n });
    expect(calls[calls.length - 1]).toEqual({ fromBlock: 9_988n, toBlock: 9_988n });
  });

  it("retries rate-limited calls with backoff", async () => {
    const r = await ingestAddress(db, fakeChain(10_000n, [log(1, 9_500n, B, A, 1n)], { failFirst: 2 }), A, opts);
    expect(r.error).toBeUndefined();
    expect(r.logsFound).toBe(1);
  });

  it("records the failure and leaves the cursor untouched when the RPC keeps failing", async () => {
    const r = await ingestAddress(db, fakeChain(10_000n, [], { failFirst: 99 }), A, { ...opts, maxAttempts: 2 });
    expect(r.error).toMatch(/limit reached/);
    const [w] = await db.select().from(watchedAddresses).where(eq(watchedAddresses.address, A));
    expect(w.cursorBlock).toBeNull();
    const [run] = await db.select().from(ingestRuns);
    expect(run.error).toMatch(/limit reached/);
  });

  it("ingestAll stops starting new addresses once the time budget is spent", async () => {
    await db.insert(watchedAddresses).values({ address: B });
    const results = await ingestAll(db, fakeChain(10_000n, []), { ...opts, timeBudgetMs: -1 });
    expect(results.every((r) => r.skipped === "time-budget")).toBe(true);
    const normal = await ingestAll(db, fakeChain(10_000n, []), { ...opts, timeBudgetMs: 10_000 });
    expect(normal.every((r) => !r.skipped)).toBe(true);
  });

  it("uses getBlock for the timestamp when the log has none, once per block", async () => {
    let fetches = 0;
    const chain = fakeChain(10_000n, [
      { ...log(1, 9_500n, B, A, 1n), blockTimestamp: undefined },
      { ...log(2, 9_500n, B, A, 2n), blockTimestamp: undefined },
    ]);
    chain.getBlockTimestamp = async (n) => { fetches += 1; return n * 3n; };
    await ingestAddress(db, chain, A, opts);
    expect(fetches).toBe(1);
    const rows = await db.select().from(receipts);
    expect(rows.every((x) => x.blockTimestamp === 28_500n)).toBe(true);
  });
});
