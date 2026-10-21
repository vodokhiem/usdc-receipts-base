import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { watchAddress } from "./actions";
import { latestRuns, listWatched } from "@/lib/queries";
import { shortHex } from "@/lib/format";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Confirmed USDC transfers on Base, as receipts</h1>
        <p className="text-neutral-600 dark:text-neutral-400 max-w-2xl">
          Add an address. The ingester reads USDC <code>Transfer</code> events for it from Base, waits for
          confirmations, and stores each one keyed by <code>(tx, logIndex)</code> so re-runs are no-ops.
        </p>
        <form action={watchAddress} className="flex flex-col sm:flex-row gap-2 max-w-2xl">
          <input
            name="address"
            required
            pattern="^0x[0-9a-fA-F]{40}$"
            placeholder="0x… address on Base"
            className="flex-1 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 font-mono text-sm"
          />
          <input
            name="label"
            placeholder="label (optional)"
            className="sm:w-40 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
          <button className="rounded bg-neutral-900 text-white dark:bg-white dark:text-black px-4 py-2 text-sm">Watch</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Watched addresses</h2>
        <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
          <Watched />
        </Suspense>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Recent ingest runs</h2>
        <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
          <Runs />
        </Suspense>
      </section>
    </div>
  );
}

async function Watched() {
  await connection();
  const rows = await listWatched();
  if (rows.length === 0) return <p className="text-sm text-neutral-500">Nothing watched yet.</p>;
  return (
    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {rows.map((w) => (
        <li key={w.address} className="py-2 flex items-center justify-between gap-4">
          <Link href={`/a/${w.address}`} className="font-mono text-sm underline">
            {w.address}
          </Link>
          <span className="text-xs text-neutral-500">
            {w.label ? `${w.label} · ` : ""}
            {w.cursorBlock ? `cursor ${w.cursorBlock.toString()}` : "not indexed yet"}
          </span>
        </li>
      ))}
    </ul>
  );
}

async function Runs() {
  await connection();
  const runs = await latestRuns();
  if (runs.length === 0) return <p className="text-sm text-neutral-500">No runs yet.</p>;
  return (
    <table className="w-full text-xs font-mono">
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-800">
            <td className="py-1 pr-3">{r.startedAt.toISOString().slice(0, 19).replace("T", " ")}</td>
            <td className="py-1 pr-3">{shortHex(r.watchedAddress)}</td>
            <td className="py-1 pr-3">
              {r.fromBlock?.toString()}–{r.toBlock?.toString()}
            </td>
            <td className="py-1 pr-3">{r.logsFound} transfers</td>
            <td className="py-1 text-rose-600">{r.error ? `error: ${r.error.slice(0, 80)}` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
