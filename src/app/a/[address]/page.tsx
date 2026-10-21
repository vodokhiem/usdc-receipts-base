import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { ReceiptTable } from "@/components/ReceiptTable";
import { basescanAddress, publicClient, usdcBalance } from "@/lib/chain";
import { formatUsdc } from "@/lib/receipts";
import { receiptsFor } from "@/lib/queries";

export default function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
      <AddressView params={params} />
    </Suspense>
  );
}

async function AddressView({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  if (!isAddress(raw)) notFound();
  const address = getAddress(raw);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg break-all">{address}</h1>
        <a className="text-sm underline decoration-neutral-400" href={basescanAddress(address)} target="_blank" rel="noreferrer">
          view on Basescan
        </a>
      </div>
      <Suspense fallback={<p className="text-sm text-neutral-500">Reading balance…</p>}>
        <Balance address={address} />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading receipts…</p>}>
        <Receipts address={address} />
      </Suspense>
    </div>
  );
}

async function Balance({ address }: { address: `0x${string}` }) {
  const result = await cachedBalance(address)
    .then((value) => ({ ok: true as const, value }))
    .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
  if (!result.ok) {
    return <p className="text-sm text-rose-600">Balance unavailable: {result.error}</p>;
  }
  return (
    <p className="text-sm">
      Current USDC balance: <span className="font-mono tabular-nums">{formatUsdc(result.value)}</span>
      <span className="text-neutral-500"> (live from chain, cached 30 s)</span>
    </p>
  );
}

async function cachedBalance(address: `0x${string}`): Promise<bigint> {
  "use cache";
  const { cacheLife } = await import("next/cache");
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  return usdcBalance(publicClient(), address);
}

async function Receipts({ address }: { address: `0x${string}` }) {
  await connection();
  const rows = await receiptsFor(address);
  return <ReceiptTable rows={rows} />;
}
