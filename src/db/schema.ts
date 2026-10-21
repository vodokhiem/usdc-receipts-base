import { bigint, index, integer, numeric, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

export const watchedAddresses = pgTable("watched_addresses", {
  /** Checksummed address. */
  address: text("address").primaryKey(),
  label: text("label"),
  /** Highest block fully processed for this address; null until the first successful run. */
  cursorBlock: bigint("cursor_block", { mode: "bigint" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receipts = pgTable(
  "receipts",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    /** A transfer between two watched addresses yields one row per side. */
    watchedAddress: text("watched_address").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTimestamp: bigint("block_timestamp", { mode: "bigint" }).notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    /** Raw 6-decimal units as numeric(38,0): exact, sortable, never a float. */
    amountRaw: numeric("amount_raw", { precision: 38, scale: 0 }).notNull(),
    direction: text("direction").notNull(),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex, t.watchedAddress] }),
    index("receipts_watched_block_idx").on(t.watchedAddress, t.blockNumber),
  ],
);

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  watchedAddress: text("watched_address").notNull(),
  fromBlock: bigint("from_block", { mode: "bigint" }),
  toBlock: bigint("to_block", { mode: "bigint" }),
  logsFound: integer("logs_found").notNull().default(0),
  rowsWritten: integer("rows_written").notNull().default(0),
  rowsDeleted: integer("rows_deleted").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
