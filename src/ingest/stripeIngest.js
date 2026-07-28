require('dotenv').config();
const Stripe = require('stripe');
const { pool } = require('../db');
const { toCanonicalStatus } = require('./statusMap');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
console.log('DEBUG key loaded:', process.env.STRIPE_SECRET_KEY);


/**
 * Upsert on the (source, source_id) unique constraint. Whether this charge
 * arrives via a fresh full-fetch, a re-run of this same script, or (in a
 * webhook-driven version of this) the same event firing twice, the result
 * is one row that just gets its fields refreshed -- never a duplicate.
 */
async function upsertTransaction(tx) {
  const canonical = toCanonicalStatus(tx.source, tx.raw_status);
  await pool.query(
    `insert into transactions
       (source, source_id, raw_status, status_canonical, amount_cents, currency, occurred_at, raw_payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (source, source_id) do update set
       raw_status       = excluded.raw_status,
       status_canonical = excluded.status_canonical,
       amount_cents     = excluded.amount_cents,
       currency         = excluded.currency,
       occurred_at      = excluded.occurred_at,
       raw_payload      = excluded.raw_payload,
       ingested_at      = now()`,
    [
      tx.source,
      tx.source_id,
      tx.raw_status,
      canonical,
      tx.amount_cents,
      tx.currency,
      tx.occurred_at,
      JSON.stringify(tx.raw_payload || {}),
    ]
  );
}

/**
 * Pulls charges from Stripe test mode. Stripe's list endpoint is itself a
 * paginated "full fetch" -- for a real incremental sync you'd pass
 * `created: { gt: lastCursorUnixTs }` and persist the returned cursor,
 * falling back to a full unfiltered list if the stored cursor is missing,
 * unparsable, or Stripe returns an error for it.
 */
async function ingestStripeCharges({ sinceUnixSeconds = null } = {}) {
  let hasMore = true;
  let startingAfter;
  let ingested = 0;
  let failed = 0;

  while (hasMore) {
    let page;
    try {
      page = await stripe.charges.list({
        limit: 100,
        starting_after: startingAfter,
        ...(sinceUnixSeconds ? { created: { gt: sinceUnixSeconds } } : {}),
      });
    } catch (err) {
      // A source being down/misbehaving must not crash the whole ingest run.
      console.error('Stripe fetch failed, aborting this source only:', err.message);
      break;
    }
   

    for (const charge of page.data) {
      try {
        await upsertTransaction({
          source: 'stripe',
          source_id: charge.id,
          raw_status: charge.status,
          amount_cents: charge.amount,
          currency: charge.currency,
          occurred_at: new Date(charge.created * 1000),
          raw_payload: charge,
        });
        ingested += 1;
      } catch (err) {
        // One bad/malformed record must not wedge the whole batch.
        console.error(`Skipping charge ${charge.id}:`, err.message);
        failed += 1;
      }
    }

    hasMore = page.has_more;
    startingAfter = page.data.length ? page.data[page.data.length - 1].id : undefined;
  }

  return { ingested, failed };
}

if (require.main === module) {
  ingestStripeCharges()
    .then((result) => {
      console.log('Stripe ingest complete:', result);
      return pool.end();
    })
    .catch((err) => {
      console.error('Ingest failed:', err);
      process.exitCode = 1;
    });
}

module.exports = { ingestStripeCharges, upsertTransaction };
