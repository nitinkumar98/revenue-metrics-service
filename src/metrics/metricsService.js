const { pool } = require('../db');
const { COLLECTED_STATUSES } = require('./allowedStatuses');

/**
 * Everything in this file funnels through _sumCollected(). There is no
 * second SQL string anywhere that filters on status_canonical for revenue
 * purposes. That's what makes "both views always agree" true by
 * construction rather than by coincidence: the breakdown view is just the
 * summary query with an extra GROUP BY bucket, run through the same
 * WHERE status_canonical = ANY($allowlist) clause.
 *
 * @param {Date} start inclusive
 * @param {Date} end   exclusive
 * @param {string|null} bucket  null for a single total, or 'day' | 'week'
 */
async function _sumCollected(start, end, bucket) {
  if (!(start instanceof Date) || !(end instanceof Date) || isNaN(start) || isNaN(end)) {
    throw new Error('start and end must be valid Date objects');
  }
  if (bucket && !['day', 'week'].includes(bucket)) {
    throw new Error(`unsupported bucket: ${bucket}`);
  }

  if (!bucket) {
    const { rows } = await pool.query(
      `select coalesce(sum(amount_cents), 0)::bigint as amount_cents,
              count(*)::int as transaction_count
         from transactions
        where status_canonical = any($1::text[])
          and occurred_at >= $2
          and occurred_at <  $3`,
      [COLLECTED_STATUSES, start, end]
    );
    return {
      amount_cents: Number(rows[0].amount_cents),
      transaction_count: rows[0].transaction_count,
    };
  }

  // date_trunc('week', ...) buckets to the ISO week start (Monday).
  const { rows } = await pool.query(
    `select date_trunc($1, occurred_at) as period_start,
            coalesce(sum(amount_cents), 0)::bigint as amount_cents,
            count(*)::int as transaction_count
       from transactions
      where status_canonical = any($2::text[])
        and occurred_at >= $3
        and occurred_at <  $4
      group by 1
      order by 1`,
    [bucket, COLLECTED_STATUSES, start, end]
  );

  return rows.map((r) => ({
    period_start: r.period_start,
    amount_cents: Number(r.amount_cents),
    transaction_count: r.transaction_count,
  }));
}

/** Single total for [start, end). Powers GET /metrics/summary */
async function getSummary(start, end) {
  const { amount_cents, transaction_count } = await _sumCollected(start, end, null);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    total_collected_cents: amount_cents,
    transaction_count,
  };
}

/** Per-bucket breakdown for [start, end). Powers GET /metrics/breakdown */
async function getBreakdown(start, end, granularity = 'day') {
  const rows = await _sumCollected(start, end, granularity);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    granularity,
    buckets: rows.map((r) => ({
      period_start: r.period_start,
      collected_cents: r.amount_cents,
      transaction_count: r.transaction_count,
    })),
  };
}

module.exports = { getSummary, getBreakdown, _sumCollected };
