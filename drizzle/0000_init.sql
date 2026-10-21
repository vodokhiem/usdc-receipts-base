CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"watched_address" text NOT NULL,
	"from_block" bigint,
	"to_block" bigint,
	"logs_found" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"rows_deleted" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"watched_address" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_raw" numeric(38, 0) NOT NULL,
	"direction" text NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_tx_hash_log_index_watched_address_pk" PRIMARY KEY("tx_hash","log_index","watched_address")
);
--> statement-breakpoint
CREATE TABLE "watched_addresses" (
	"address" text PRIMARY KEY NOT NULL,
	"label" text,
	"cursor_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "receipts_watched_block_idx" ON "receipts" USING btree ("watched_address","block_number");