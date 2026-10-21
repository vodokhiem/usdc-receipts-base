import Link from "next/link";
import { basescanAddress, basescanTx } from "@/lib/chain";
import { isoTime, shortHex } from "@/lib/format";
import { formatUsdc } from "@/lib/receipts";

export interface ReceiptRow {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: bigint;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  direction: string;
}

export function ReceiptTable({ rows }: { rows: ReceiptRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No confirmed USDC transfers indexed yet. The ingester runs every minute.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="py-2 pr-4 font-normal">Time (UTC)</th>
            <th className="py-2 pr-4 font-normal">Direction</th>
            <th className="py-2 pr-4 font-normal text-right">USDC</th>
            <th className="py-2 pr-4 font-normal">Counterparty</th>
            <th className="py-2 pr-4 font-normal">Block</th>
            <th className="py-2 font-normal">Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const counterparty = r.direction === "in" ? r.fromAddress : r.toAddress;
            return (
              <tr key={`${r.txHash}-${r.logIndex}`} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs">{isoTime(r.blockTimestamp)}</td>
                <td className="py-2 pr-4">
                  <Direction d={r.direction} />
                </td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                  {r.direction === "out" ? "−" : r.direction === "in" ? "+" : ""}
                  {formatUsdc(BigInt(r.amountRaw))}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  <a className="underline decoration-neutral-400" href={basescanAddress(counterparty)} target="_blank" rel="noreferrer">
                    {shortHex(counterparty)}
                  </a>
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{r.blockNumber.toString()}</td>
                <td className="py-2 font-mono text-xs whitespace-nowrap">
                  <Link className="underline" href={`/r/${r.txHash}/${r.logIndex}`}>
                    receipt
                  </Link>
                  {" · "}
                  <a className="underline decoration-neutral-400" href={basescanTx(r.txHash)} target="_blank" rel="noreferrer">
                    {shortHex(r.txHash, 8, 4)}
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Direction({ d }: { d: string }) {
  const cls =
    d === "in"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : d === "out"
        ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
        : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{d}</span>;
}
