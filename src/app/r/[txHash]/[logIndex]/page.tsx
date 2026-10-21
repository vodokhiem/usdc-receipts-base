import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Direction } from "@/components/ReceiptTable";
import { basescanAddress, basescanTx, headBlockNumber, publicClient } from "@/lib/chain";
import { headTag } from "@/lib/env";
import { isoTime, shortHex } from "@/lib/format";
import { formatUnitsFixed, formatUsdc } from "@/lib/receipts";
import { receiptRows } from "@/lib/queries";

export default function ReceiptPage({ params }: { params: Promise<{ txHash: string; logIndex: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading receipt…</p>}>
      <ReceiptView params={params} />
    </Suspense>
  );
}

async function ReceiptView({ params }: { params: Promise<{ txHash: string; logIndex: string }> }) {
  const { txHash, logIndex } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !/^\d+$/.test(logIndex)) notFound();
  return <Receipt txHash={txHash.toLowerCase()} logIndex={Number(logIndex)} />;
}

async function Receipt({ txHash, logIndex }: { txHash: string; logIndex: number }) {
  await connection();
  // One transfer, one receipt; a row per watched side only changes the "direction" badges below.
  const rows = await receiptRows(txHash, logIndex);
  const r = rows[0];
  if (!r) notFound();
  const json = {
    chain: "base",
    asset: "USDC",
    txHash: r.txHash,
    logIndex: r.logIndex,
    blockNumber: r.blockNumber.toString(),
    blockTimestamp: Number(r.blockTimestamp),
    from: r.fromAddress,
    to: r.toAddress,
    amount: formatUnitsFixed(BigInt(r.amountRaw)),
    amountRaw: r.amountRaw,
    explorer: basescanTx(r.txHash),
  };
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Receipt</h1>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-neutral-500">Amount</dt>
        <dd className="font-mono text-lg">{formatUsdc(BigInt(r.amountRaw))} USDC</dd>
        <dt className="text-neutral-500">From</dt>
        <dd className="font-mono break-all"><a className="underline decoration-neutral-400" href={basescanAddress(r.fromAddress)} target="_blank" rel="noreferrer">{r.fromAddress}</a></dd>
        <dt className="text-neutral-500">To</dt>
        <dd className="font-mono break-all"><a className="underline decoration-neutral-400" href={basescanAddress(r.toAddress)} target="_blank" rel="noreferrer">{r.toAddress}</a></dd>
        <dt className="text-neutral-500">Watched as</dt>
        <dd className="flex flex-wrap gap-2">
          {rows.map((w) => (
            <span key={w.watchedAddress} className="inline-flex items-center gap-1 font-mono text-xs">
              <Direction d={w.direction} /> {shortHex(w.watchedAddress)}
            </span>
          ))}
        </dd>
        <dt className="text-neutral-500">Time</dt>
        <dd className="font-mono">{isoTime(r.blockTimestamp)}</dd>
        <dt className="text-neutral-500">Block</dt>
        <dd className="font-mono">{r.blockNumber.toString()}</dd>
        <dt className="text-neutral-500">Depth</dt>
        <dd className="font-mono">
          <Suspense fallback="…">
            <Depth block={r.blockNumber} />
          </Suspense>
        </dd>
        <dt className="text-neutral-500">Transaction</dt>
        <dd className="font-mono break-all"><a className="underline" href={basescanTx(r.txHash)} target="_blank" rel="noreferrer">{r.txHash}</a> · log {r.logIndex}</dd>
      </dl>
      <details>
        <summary className="cursor-pointer text-sm">JSON</summary>
        <pre className="mt-2 rounded bg-neutral-100 dark:bg-neutral-900 p-3 text-xs overflow-x-auto">{JSON.stringify(json, null, 2)}</pre>
      </details>
    </div>
  );
}

/** Blocks between this receipt and the latest / safe / finalized heads, read live. */
async function Depth({ block }: { block: bigint }) {
  const client = publicClient();
  const read = (tag: "latest" | "safe" | "finalized") => headBlockNumber(client, tag).catch(() => null);
  const [latest, safe, finalized] = await Promise.all([read("latest"), read("safe"), read("finalized")]);
  const fmt = (n: bigint | null) => (n === null ? "?" : (n - block).toString());
  return (
    <>
      {fmt(latest)} below latest · {fmt(safe)} below safe · {fmt(finalized)} below finalized
      <span className="text-neutral-500"> (stored at {headTag()})</span>
    </>
  );
}
