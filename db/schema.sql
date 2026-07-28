-- Revenue metrics schema
-- Run this once against your Supabase Postgres project (SQL editor, or via db/migrate.js)

create table if not exists transactions (
  id                bigserial primary key,

  -- Where this record came from and its ID *in that system*.
  -- (source, source_id) is the idempotency key: re-running ingestion or
  -- replaying a webhook twice must never create a second row for the same
  -- underlying charge/invoice.
  source            text        not null,          -- e.g. 'stripe', 'crm_invoices', 'legacy_billing'
  source_id         text        not null,           -- e.g. Stripe charge/payment_intent id

  -- Raw status exactly as the source reported it. Never used directly for
  -- revenue math -- kept for audit/debugging only.
  raw_status        text        not null,

  -- Canonical status this raw_status was mapped to at ingestion time.
  -- This is a CLOSED, small vocabulary the rest of the system understands:
  --   collected | pending | refunded | voided | failed | other
  -- 'other' exists so an unrecognized future status from any source lands
  -- somewhere visible and auditable instead of crashing ingestion --
  -- but 'other' is never in the revenue allow-list (see allowedStatuses.js).
  status_canonical  text        not null,

  amount_cents      bigint      not null,
  currency          text        not null default 'usd',

  occurred_at       timestamptz not null,           -- when the money actually moved / was booked
  ingested_at       timestamptz not null default now(),
  raw_payload       jsonb,                          -- full original record, for debugging/replay

  unique (source, source_id)
);

create index if not exists idx_transactions_occurred_at on transactions (occurred_at);
create index if not exists idx_transactions_status_canonical on transactions (status_canonical);
create index if not exists idx_transactions_source on transactions (source);
