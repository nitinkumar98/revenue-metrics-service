const test = require('node:test');
const assert = require('node:assert');
const { toCanonicalStatus } = require('../src/ingest/statusMap');
const { COLLECTED_STATUSES } = require('../src/metrics/allowedStatuses');

test('known Stripe statuses map to expected canonical values', () => {
  assert.strictEqual(toCanonicalStatus('stripe', 'succeeded'), 'collected');
  assert.strictEqual(toCanonicalStatus('stripe', 'refunded'), 'refunded');
  assert.strictEqual(toCanonicalStatus('stripe', 'failed'), 'failed');
});

test('an unrecognized status from a known source maps to "other", never "collected"', () => {
  const canonical = toCanonicalStatus('stripe', 'some_brand_new_status_stripe_invents_later');
  assert.strictEqual(canonical, 'other');
  assert.ok(
    !COLLECTED_STATUSES.includes(canonical),
    'a never-seen-before status must never count as revenue'
  );
});

test('a completely unknown source maps everything to "other"', () => {
  assert.strictEqual(toCanonicalStatus('some_new_source_nobody_configured', 'paid'), 'other');
});
