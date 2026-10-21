/**
 * npm run ingest -- [address ...]
 * Adds any addresses given, then ingests every watched address once.
 */
import { isAddress } from "viem";
import { getDb } from "@/db";
import { publicClient } from "@/lib/chain";
import { ingestAll, viemChainReader } from "@/lib/ingest";
import { addWatched } from "@/lib/queries";

async function main() {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (!isAddress(a)) throw new Error(`not an address: ${a}`);
    console.log("watching", await addWatched(a));
  }
  const db = await getDb();
  const results = await ingestAll(db, viemChainReader(publicClient()), { log: (m) => console.log(m) });
  for (const r of results) {
    console.log(
      `${r.address}: blocks ${r.fromBlock ?? "-"}..${r.toBlock ?? "-"} transfers=${r.logsFound} written=${r.rowsWritten} removed=${r.rowsDeleted}${r.skipped ? ` skipped=${r.skipped}` : ""}${r.error ? ` ERROR ${r.error}` : ""}`,
    );
  }
  process.exit(results.some((r) => r.error) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
