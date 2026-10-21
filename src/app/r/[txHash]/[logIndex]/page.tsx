import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Direction } from "@/components/ReceiptTable";
import { basescanAddress, basescanTx, publicClient } from "@/lib/chain";
import { isoTime } from "@/lib/format";
import { formatUnitsFixed, formatUsdc } from "@/lib/receipts";
import { receiptByKey } from "@/lib/queries";

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
  const r = await receiptByKey(txHash, logIndex);
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
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Receipt</h1>
        <Direction d={r.direction} />
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-neutral-500">Amount</dt>
        <dd className="font-mono text-lg">{formatUsdc(BigInt(r.amountRaw))} USDC</dd>
        <dt className="text-neutral-500">From</dt>
        <dd className="font-mono break-all"><a className="underline decoration-neutral-400" href={basescanAddress(r.fromAddress)} target="_blank" rel="noreferrer">{r.fromAddress}</a></dd>
        <dt className="text-neutral-500">To</dt>
        <dd className="font-mono break-all"><a className="underline decoration-neutral-400" href={basescanAddress(r.toAddress)} target="_blank" rel="noreferrer">{r.toAddress}</a></dd>
        <dt className="text-neutral-500">Time</dt>
        <dd className="font-mono">{isoTime(r.blockTimestamp)}</dd>
        <dt className="text-neutral-500">Block</dt>
        <dd className="font-mono">{r.blockNumber.toString()}</dd>
        <dt className="text-neutral-500">Confirmations</dt>
        <dd className="font-mono">
          <Suspense fallback="…">
            <Confirmations block={r.blockNumber} />
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

async function Confirmations({ block }: { block: bigint }) {
  const head = await publicClient()
    .getBlockNumber()
    .catch(() => null);
  return <>{head === null ? "unavailable" : (head - block).toString()}</>;
}
