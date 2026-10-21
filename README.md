# usdc-receipts-base

A small indexer that turns USDC transfers on Base into receipts you can link to.

Add an address. Every minute the ingester reads USDC `Transfer` events for it up to Base's `safe` block, stores each transfer keyed by `(tx_hash, log_index, watched_address)`, and re-checks the most recent blocks so rows that the chain no longer reports are removed. Each address gets a page with its live balance and receipts; each receipt gets a page with a Basescan link, its depth below the `latest` / `safe` / `finalized` heads, and a JSON view.

Live: _see the repo description_

## How it works

```
watched_addresses ──► ingest (per address, per run, under an advisory lock)
                        1. head   = block number of HEAD_TAG (safe) − CONFIRMATIONS
                        2. window = [cursor + 1 − 32 overlap, head]   (first run: head − LOOKBACK)
                        3. per ≤2 000-block chunk, in one transaction:
                             eth_getLogs(from = addr) + eth_getLogs(to = addr)
                             upsert what was found; delete rows in the range that were not found
                        4. advance cursor only after every chunk succeeded
```

Design decisions, and why:

- **`safe`, not `latest`.** On Base (OP Stack) a `latest` block can still be reorganised by the sequencer; a `safe` block is already in a batch posted to L1 and only an L1 reorg can undo it; `finalized` cannot be undone. The default stops at `safe` (about a minute behind the tip); set `HEAD_TAG=finalized` for settlement-grade receipts at the cost of ~15–20 minutes of delay.
- **Reconcile, don't just upsert.** Each run re-reads the last 32 blocks behind the cursor. In that window the chunk's transaction upserts the logs the chain reports and deletes the rows it no longer reports. A transfer dropped or re-keyed by a reorg inside the overlap is therefore removed or rewritten on the next run. A reorg deeper than the overlap is not handled; below `safe` that requires an L1 reorg, below `finalized` it cannot happen.
- **Keyed by `(tx_hash, log_index, watched_address)`.** One transaction can carry several `Transfer` logs, so `tx_hash` alone is not a key. Re-running over the same range writes the same rows again (the upsert is a `DO UPDATE`, counted in `rows_written`) and produces no duplicates. A transfer between two watched addresses is one row per side.
- **Bounded RPC usage.** `eth_getLogs` ranges are capped at 2 000 blocks, queries are split by `from` and `to` so topic filters stay selective, and 429/5xx responses get exponential backoff. The ingester refuses to run without `BASE_RPC_URL`: public endpoints rate-limit log queries almost immediately.
- **Bounded cron runs.** Anyone can add an address from the UI, so there is a cap (`MAX_WATCHED`), each run processes least-recently-scanned addresses first and stops starting new ones after `INGEST_TIME_BUDGET_MS`, and a per-address Postgres advisory lock stops two overlapping runs from racing on one cursor.
- **Timestamps from the log.** OP-Stack nodes include `blockTimestamp` on each log; `eth_getBlockByNumber` is the fallback, called once per block.
- **Money is never a float.** Amounts are stored as `numeric(38,0)` raw units and formatted from `bigint`.
- **One database handle, two drivers.** With `DATABASE_URL` set it uses Postgres (Neon on Vercel); migrations are applied by `npm run db:migrate`, not on cold start. Without it, in development only, it uses [PGlite](https://pglite.dev), an embedded Postgres, so `npm run dev` and the tests need no external service. In production a missing `DATABASE_URL` is an error, not a fallback.

Not in scope: Solana, wallet connection, sending transactions, escrow, adaptive range splitting when a provider rejects a 2 000-block query.

## Run it

```bash
cp .env.example .env.local      # set BASE_RPC_URL (Alchemy / QuickNode / dRPC key)
npm install
npm run ingest -- 0xYourAddress # adds the address and indexes the last ~28 h (LOOKBACK_BLOCKS)
npm run dev                     # http://localhost:3000
```

The CLI and the dev server share `./data/pglite`; run them one at a time (PGlite is single-process).

## Deploy

1. Create a Postgres database (Neon free tier is enough) and run `DATABASE_URL=... npm run db:migrate` once.
2. Import the repo on Vercel; set `BASE_RPC_URL`, `DATABASE_URL`, `CRON_SECRET`.
3. `vercel.json` schedules `GET /api/ingest` every minute; Vercel sends `Authorization: Bearer $CRON_SECRET`.

## Tests

```bash
npm test                          # 24 unit/DB tests on an in-memory PGlite, ~20 s
BASE_RPC_URL=... npm test         # also runs the live test against Base mainnet
```

The DB tests cover idempotent re-runs, a reorg that moves a transfer to another block, a reorg that drops a transfer, a reorg that re-keys its `logIndex`, chunking, backoff, the time budget and the address cap. The live test picks a recipient from the latest USDC transfers, indexes it, and checks the stored row against the chain.

## Stack

Next.js 16 (App Router, Cache Components), viem, Drizzle, Postgres / PGlite, Vitest, Tailwind.
