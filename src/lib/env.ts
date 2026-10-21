/** Environment access in one place so missing configuration fails loudly, not at random call sites. */

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

export function ingestConfig() {
  return {
    /** Logs are only stored once this many blocks sit on top of them. */
    confirmations: intEnv("CONFIRMATIONS", 12),
    /** Re-scan this many already-processed blocks each run so a shallow reorg cannot leave a stale row behind. */
    reorgOverlap: intEnv("REORG_OVERLAP", 32),
    /** First run for an address looks back at most this far (~2 s per block on Base). */
    lookbackBlocks: intEnv("LOOKBACK_BLOCKS", 50_000),
    /** Base recommends eth_getLogs ranges of at most 2 000 blocks. */
    chunkBlocks: intEnv("CHUNK_BLOCKS", 2_000),
  };
}
