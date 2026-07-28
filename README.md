# revenue-metrics-service

A single-source-of-truth revenue metrics service. Ingests transactions from
multiple sources with different status vocabularies, normalizes them into a
closed canonical vocabulary, and exposes **one** definition of "revenue
collected" through two views (a total and a time-bucketed breakdown) that are
structurally guaranteed to agree.

## Live deployment

**Base URL:** https://revenue-metrics-service-g2vn.onrender.com

Deployed on Render's free tier. Note: free-tier services spin down after
~15 minutes of inactivity — the first request after idle may take 30–60
seconds to respond while it wakes up. Hit `/health` once to warm it up
before running anything timing-sensitive.

```bash
curl "https://revenue-metrics-service-g2vn.onrender.com/health"
curl "https://revenue-metrics-service-g2vn.onrender.com/metrics/summary?start=2020-01-01&end=2030-01-01"
curl "https://revenue-metrics-service-g2vn.onrender.com/metrics/breakdown?start=2020-01-01&end=2030-01-01&granularity=day"
```

## Why this design

**Allow-list, not exclusion-list.** `src/metrics/allowedStatuses.js` defines
`COLLECTED_STATUSES = ['collected']`. Nothing else in the codebase is allowed
to independently decide what counts as revenue — see the guardrail below.
An exclusion list ("everything except pending/failed/refunded/voided counts")
would silently treat any new or misspelled status as revenue the moment a
source introduces one. An allow-list fails safe instead: unrecognized
statuses land in the `other` bucket, are stored and visible for audit, but
never count.

**Two views, one query.** `src/metrics/metricsService.js` has exactly one
internal function, `_sumCollected(start, end, bucket)`, that does the actual
filtering/summing. `getSummary()` calls it with `bucket = null`;
`getBreakdown()` calls it with `bucket = 'day' | 'week'`. Both HTTP endpoints
are thin wrappers around these two functions. They can't drift apart because
they're not two implementations — they're one implementation called two ways.

**A guardrail that would catch drift.**
`test/no-second-revenue-definition.test.js` walks every file under `src/`
(except the two files sanctioned to know about revenue statuses) and fails
the test suite if it finds a WHERE-clause-shaped filter on
`status_canonical`, a hardcoded `'collected'` status string, or a
`sum(amount_cents)` outside `metricsService.js`. I verified this by
temporarily pasting a second, drifted revenue query into `server.js` — the
test failed immediately, pointing at the exact file and line pattern; I then
reverted it. `test/summary-breakdown-agree.test.js` is a second, runtime
guardrail: it computes the summary total and the sum of every breakdown
bucket for the same range and asserts they're byte-for-byte equal in cents.

**Idempotent ingestion.** `transactions` has a `unique (source, source_id)`
constraint. Ingestion always does `INSERT ... ON CONFLICT (source,
source_id) DO UPDATE`, so re-running the ingest script, or replaying the same
webhook/event twice, updates the same row instead of creating a duplicate.

**Ingestion failure isolation.** A single malformed record is caught and
skipped without aborting the batch; a Stripe API failure aborts *only* that
source's fetch loop, not the whole process — this mirrors the multi-source
resilience the assignment asks for, scoped down to the one source actually
wired up here (see Tradeoffs).

## Schema

```
transactions
  id                bigserial primary key
  source            text            -- 'stripe', 'crm_invoices', ...
  source_id         text            -- ID in that source system
  raw_status        text            -- exactly as the source reported it
  status_canonical  text            -- collected | pending | refunded | voided | failed | other
  amount_cents      bigint
  currency          text
  occurred_at       timestamptz
  ingested_at       timestamptz
  raw_payload       jsonb
  unique (source, source_id)
```

## Running locally

1. **Supabase**: create a free project at supabase.com. Grab the Postgres
   connection string from Project Settings → Database → Connection string.
2. **Stripe**: create a free account, stay in **test mode**, grab the test
   secret key (`sk_test_...`) from Developers → API keys. Create a handful
   of test charges either via the Dashboard ("New payment" in test mode) or
   the API/CLI.
3. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and
   `STRIPE_SECRET_KEY`.
4. Install deps: `npm install`
5. Apply the schema: `npm run migrate`
6. Ingest Stripe test transactions: `npm run seed:stripe`
7. Run the server: `npm start`
8. Run the tests: `npm test`

## Testing the endpoints

Swap `$BASE` for `http://localhost:3000` locally, or
`https://revenue-metrics-service-g2vn.onrender.com` for the live deployment.

**1. Start the server (local only — the Render deployment is already running)**
```bash
npm start
```

**2. Health check**
```bash
curl "$BASE/health"
```
Expected:
```json
{"status":"ok"}
```

**3. Summary — the canonical revenue number**
```bash
curl "$BASE/metrics/summary?start=2020-01-01&end=2030-01-01"
```
Expected shape:
```json
{
  "start": "2020-01-01T00:00:00.000Z",
  "end": "2030-01-01T00:00:00.000Z",
  "total_collected_cents": <amount>,
  "transaction_count": <txnCount>
}
```

**4. Daily breakdown**
```bash
curl "$BASE/metrics/breakdown?start=2020-01-01&end=2030-01-01&granularity=day"
```
Expected: one bucket with `collected_cents: <amount>` on the day you created
that charge — everything else in the DB (declined/failed charges) simply
won't appear here since they're excluded by the allow-list.

**5. Weekly breakdown**
```bash
curl "$BASE/metrics/breakdown?start=2020-01-01&end=2030-01-01&granularity=week"
```

**6. Edge cases**

Missing params → 400, not a crash:
```bash
curl "$BASE/metrics/summary"
```
```json
{"error":"start and end query params are required (ISO 8601 dates)"}
```

Invalid range (end before start) → 400:
```bash
curl "$BASE/metrics/summary?start=2026-01-01&end=2020-01-01"
```
```json
{"error":"end must be after start"}
```

A narrow date range with no data → zero, not an error:
```bash
curl "$BASE/metrics/summary?start=1999-01-01&end=1999-12-31"
```
```json
{"total_collected_cents":0,"transaction_count":0}
```

**7. Idempotency**
```bash
npm run seed:stripe
npm run seed:stripe
curl "$BASE/metrics/summary?start=2020-01-01&end=2030-01-01"
```
`total_collected_cents` and `transaction_count` must stay exactly the same
after re-running ingestion twice — no duplicates, because of the
`unique(source, source_id)` constraint + upsert.

**8. Run the automated test suite**
```bash
npm test
```
Expected: 4 pass



