const test = require('node:test');
const assert = require('node:assert');
try { require('dotenv').config(); } catch (_) { /* fine if dotenv isn't installed; DATABASE_URL may still be set in env */ }

/**
 * "Both views always agree" is asserted here directly rather than just
 * argued in the README: sum up every bucket in the breakdown view and
 * compare it, in cents, to the summary view's single total, for the same
 * date range. Because both are thin wrappers over the same _sumCollected()
 * query (see metricsService.js), this should hold by construction -- this
 * test exists to catch a regression if that ever stops being true.
 *
 * Requires a reachable DATABASE_URL with the schema applied; skips with a
 * clear message in environments where that isn't set up (e.g. a bare
 * `npm test` before `npm run migrate`).
 */
test('summary total equals sum of breakdown buckets', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set -- skipping DB-backed consistency test');
    return;
  }

  const { getSummary, getBreakdown } = require('../src/metrics/metricsService');
  const { pool } = require('../src/db');

  const start = new Date('2020-01-01T00:00:00Z');
  const end = new Date('2100-01-01T00:00:00Z');

  try {
    const summary = await getSummary(start, end);
    const breakdown = await getBreakdown(start, end, 'day');
    const breakdownTotal = breakdown.buckets.reduce((sum, b) => sum + b.collected_cents, 0);

    assert.strictEqual(
      breakdownTotal,
      summary.total_collected_cents,
      `breakdown sum (${breakdownTotal}) diverged from summary total (${summary.total_collected_cents})`
    );
  } finally {
    await pool.end();
  }
});
