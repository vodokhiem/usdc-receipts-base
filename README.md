# usdc-receipts-base

A small indexer that turns confirmed USDC transfers on Base into receipts you can link to.

Add an address. Every minute the ingester reads USDC `Transfer` events for it from Base, waits for 12 confirmations, and stores each transfer keyed by `(tx_hash, log_index, watched_address)`. Each address gets a page with its live balance and its receipts; each receipt gets a page with a Basescan link, its current confirmation count and a JSON view.

Live: _deployed on Vercel — URL in the repo description_

## How it works

```
watched_addresses ──► ingest (per address, per run)
                        1. window  = [cursor + 1 − 32 overlap, head − 12 confirmations]
                        2. for each ≤2 000-block chunk: eth_getLogs(from = addr) and eth_getLogs(to = addr)
                        3. upsert rows on (tx_hash, log_index, watched_address)
                        4. advance cursor only after every chunk succeeded
```

Design decisions, and why:

- **Confirmations before storage.** Rows are only written once a transfer sits 12 blocks below the head, so the table never contains a transfer that was dropped in a reorg.
- **Overlap on every run.** Each run re-reads the last 32 blocks behind the cursor. If a shallow reorg moved a transfer to a different block between two runs, the upsert rewrites the row instead of leaving a stale one.
- **Idempotent writes.** The primary key is `(tx_hash, log_index, watched_address)`. Running ingest twice over the same range is a no-op; a transfer between two watched addresses produces one row per side.
- **Bounded RPC usage.** `eth_getLogs` ranges are capped at 2 000 blocks (the limit Base recommends), queries are split by `from` and `to` so topic filters stay selective, and 429/5xx responses get exponential backoff. The ingester refuses to run without `BASE_RPC_URL`: public endpoints rate-limit log queries almost immediately.
- **Timestamps from the log.** Base returns `blockTimestamp` on each log; `eth_getBlockByNumber` is only called as a fallback, once per block.
- **Money is never a float.** Amounts are stored as `numeric(38,0)` raw units and formatted from `bigint`.
- **One database handle, two drivers.** With `DATABASE_URL` set it uses Postgres (Neon on Vercel). Without it, it uses [PGlite](https://pglite.dev), an embedded Postgres, so `npm run dev` and the test suite need no external service. The query code is identical.

Not in scope: Solana, wallet connection, sending transactions, escrow.

## Run it

```bash
cp .env.example .env.local      # set BASE_RPC_URL (Alchemy / QuickNode / dRPC key)
npm install
npm run ingest -- 0xYourAddress # adds the address and indexes the last ~28 h (LOOKBACK_BLOCKS)
npm run dev                     # http://localhost:3000
```

The CLI and the dev server share `./data/pglite`; run them one at a time (PGlite is single-process).

## Deploy

1. Import the repo on Vercel.
2. Set `BASE_RPC_URL`, `DATABASE_URL` (Neon), `CRON_SECRET`.
3. `vercel.json` schedules `GET /api/ingest` every minute; Vercel sends `Authorization: Bearer $CRON_SECRET`.

## Tests

```bash
npm test                          # 19 unit/DB tests on an in-memory PGlite, ~15 s
BASE_RPC_URL=... npm test         # also runs the live test against Base mainnet
```

The live test picks a recipient from the latest USDC transfers, indexes it, and checks the stored row matches the chain.

## Stack

Next.js 16 (App Router, Cache Components), viem, Drizzle, Postgres / PGlite, Vitest, Tailwind.
