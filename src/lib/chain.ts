import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";
import { rpcUrl } from "./env";

/** Native USDC on Base (Circle). 6 decimals. */
export const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type BaseClient = ReturnType<typeof makeClient>;

function makeClient() {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl(), { retryCount: 0, timeout: 20_000 }),
  });
}

let cached: BaseClient | undefined;

export function publicClient(): BaseClient {
  if (!cached) cached = makeClient();
  return cached;
}

export async function usdcBalance(client: BaseClient, address: Address): Promise<bigint> {
  return client.readContract({
    address: USDC_ADDRESS,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [address],
  });
}

export function basescanTx(hash: string) {
  return `https://basescan.org/tx/${hash}`;
}

export function basescanAddress(address: string) {
  return `https://basescan.org/address/${address}`;
}
