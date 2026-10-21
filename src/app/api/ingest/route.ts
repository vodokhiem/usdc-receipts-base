/**
 * Triggered by Vercel Cron (see vercel.json) or manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/ingest
 */
import { getDb } from "@/db";
import { publicClient } from "@/lib/chain";
import { cronSecret } from "@/lib/env";
import { ingestAll, viemChainReader } from "@/lib/ingest";

export async function GET(request: Request) {
  const secret = cronSecret();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const results = await ingestAll(db, viemChainReader(publicClient()));
  return Response.json(
    results.map((r) => ({
      ...r,
      fromBlock: r.fromBlock?.toString() ?? null,
      toBlock: r.toBlock?.toString() ?? null,
    })),
    { status: results.some((r) => r.error) ? 500 : 200 },
  );
}
