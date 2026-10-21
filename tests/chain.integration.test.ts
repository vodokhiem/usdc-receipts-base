/**
 * Talks to a real Base RPC. Skipped unless BASE_RPC_URL is set.
 * Picks a recipient from the latest USDC transfers so no address is hard-coded.
 */
import { describe, expect, it } from "vitest";
import { openPglite } from "@/db";
import { receipts, watchedAddresses } from "@/db/schema";
import { headBlockNumber, publicClient, transferEvent, USDC_ADDRESS, usdcBalance } from "@/lib/chain";
import { ingestAddress, viemChainReader } from "@/lib/ingest";

const enabled = Boolean(process.env.BASE_RPC_URL);

describe.skipIf(!enabled)("Base mainnet (live)", () => {
  it("ingests recent USDC transfers for a live address and matches balanceOf type", async () => {
    const client = publicClient();
    const head = await client.getBlockNumber();
    const recent = await client.getLogs({ address: USDC_ADDRESS, event: transferEvent, fromBlock: head - 30n, toBlock: head - 20n });
    expect(recent.length).toBeGreaterThan(0);
    const target = recent[0].args.to!;

    const db = await openPglite();
    await db.insert(watchedAddresses).values({ address: target });
    const r = await ingestAddress(db, viemChainReader(client), target, {
      headTag: "latest", confirmations: 12, reorgOverlap: 0, lookbackBlocks: 300, chunkBlocks: 100, backoffMs: 500,
    });
    expect(r.error).toBeUndefined();
    const rows = await db.select().from(receipts);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((x) => x.txHash === recent[0].transactionHash)).toBe(true);
    expect(typeof (await usdcBalance(client, target))).toBe("bigint");
    const [latest, safe, finalized] = await Promise.all([
      headBlockNumber(client, "latest"), headBlockNumber(client, "safe"), headBlockNumber(client, "finalized"),
    ]);
    expect(safe).toBeLessThanOrEqual(latest);
    expect(finalized).toBeLessThanOrEqual(safe);
  }, 120_000);
});
