/** Read-side helpers shared by pages and the CLI. Pages call connection() first so nothing here runs at build time. */
import { desc, eq, and } from "drizzle-orm";
import { getAddress, isAddress, type Address } from "viem";
import { getDb } from "@/db";
import { ingestRuns, receipts, watchedAddresses } from "@/db/schema";

export async function listWatched() {
  const db = await getDb();
  return db.select().from(watchedAddresses).orderBy(desc(watchedAddresses.createdAt));
}

export async function addWatched(raw: string, label?: string): Promise<Address> {
  if (!isAddress(raw)) throw new Error("not a valid EVM address");
  const address = getAddress(raw);
  const db = await getDb();
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

export async function receiptByKey(txHash: string, logIndex: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.txHash, txHash), eq(receipts.logIndex, logIndex)));
  return rows[0] ?? null;
}

export async function latestRuns(limit = 10) {
  const db = await getDb();
  return db.select().from(ingestRuns).orderBy(desc(ingestRuns.id)).limit(limit);
}
