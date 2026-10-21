/** Read-side helpers shared by pages and the CLI. Pages call connection() first so nothing here runs at build time. */
import { desc, eq, and } from "drizzle-orm";
import { getAddress, isAddress, type Address } from "viem";
import { getDb } from "@/db";
import { ingestRuns, receipts, watchedAddresses } from "@/db/schema";
import { ingestConfig } from "@/lib/env";

export async function listWatched() {
  const db = await getDb();
  return db.select().from(watchedAddresses).orderBy(desc(watchedAddresses.createdAt));
}

export async function addWatched(raw: string, label?: string): Promise<Address> {
  if (!isAddress(raw)) throw new Error("not a valid EVM address");
  const address = getAddress(raw);
  const db = await getDb();
  const existing = await db.select({ address: watchedAddresses.address }).from(watchedAddresses);
  if (existing.some((w) => w.address === address)) return address;
  const max = ingestConfig().maxWatched;
  if (existing.length >= max) {
    throw new Error(`this demo watches at most ${max} addresses; pick one of the existing ones`);
  }
  await db
    .insert(watchedAddresses)
    .values({ address, label: label?.trim() || null })
    .onConflictDoNothing();
  return address;
}

export async function receiptsFor(address: Address, limit = 100) {
  const db = await getDb();
  return db
    .select()
    .from(receipts)
    .where(eq(receipts.watchedAddress, address))
    .orderBy(desc(receipts.blockNumber), desc(receipts.logIndex))
    .limit(limit);
}

/** One row per watched side of the transfer (two when both parties are watched). */
export async function receiptRows(txHash: string, logIndex: number) {
  const db = await getDb();
  return db
    .select()
    .from(receipts)
    .where(and(eq(receipts.txHash, txHash), eq(receipts.logIndex, logIndex)))
    .orderBy(receipts.watchedAddress);
}

export async function latestRuns(limit = 10) {
  const db = await getDb();
  return db.select().from(ingestRuns).orderBy(desc(ingestRuns.id)).limit(limit);
}
