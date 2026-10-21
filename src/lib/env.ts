/** Environment access in one place so missing configuration fails loudly, not at random call sites. */

export type HeadTag = "latest" | "safe" | "finalized";

export function rpcUrl(): string {
  const url = process.env.BASE_RPC_URL;
  if (!url) {
    throw new Error(
      "BASE_RPC_URL is not set. Point it at a Base mainnet RPC with an API key " +
        "(Alchemy, QuickNode, dRPC, ...). Public endpoints rate-limit eth_getLogs.",
    );
  }
  return url;
}

/** True when a missing DATABASE_URL must be an error. ALLOW_PGLITE=1 lets `next start` run locally on PGlite. */
export function requireDatabaseUrl(): boolean {
  if (process.env.ALLOW_PGLITE === "1") return false;
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || undefined;
}

export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

export function headTag(): HeadTag {
  const raw = process.env.HEAD_TAG ?? "safe";
  if (raw !== "latest" && raw !== "safe" && raw !== "finalized") {
    throw new Error(`HEAD_TAG must be latest, safe or finalized, got "${raw}"`);
  }
  return raw;
}

export function ingestConfig() {
  return {
    /**
     * Which block the scan stops at. On Base (OP Stack):
     *   latest    – sequencer head, can be reorged by the sequencer
     *   safe      – included in a batch posted to L1; only an L1 reorg can undo it (default)
     *   finalized – the L1 batch is finalized (~15–20 min behind); cannot be undone
     */
    headTag: headTag(),
    /** Extra blocks below the chosen head before a log is stored. 0 is fine with safe/finalized. */
    confirmations: intEnv("CONFIRMATIONS", 0),
    /** Re-scan this many already-processed blocks each run; rows that vanished from the chain in that window are deleted. */
    reorgOverlap: intEnv("REORG_OVERLAP", 32),
    /** First run for an address looks back at most this far (~2 s per block on Base). */
    lookbackBlocks: intEnv("LOOKBACK_BLOCKS", 50_000),
    /** Base recommends eth_getLogs ranges of at most 2 000 blocks. */
    chunkBlocks: intEnv("CHUNK_BLOCKS", 2_000),
    /** One cron run stops starting new addresses after this long; the rest wait for the next minute. */
    timeBudgetMs: intEnv("INGEST_TIME_BUDGET_MS", 40_000),
    /** Anyone can add an address from the UI, so cap how many exist. */
    maxWatched: intEnv("MAX_WATCHED", 20),
  };
}
