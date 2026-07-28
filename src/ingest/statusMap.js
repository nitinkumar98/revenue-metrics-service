/**
 * Every source speaks its own status dialect. This is the ONLY place in the
 * codebase that is allowed to know those dialects. Everything downstream
 * (the metrics service, both endpoints) only ever sees the canonical
 * vocabulary defined below.
 *
 * Canonical vocabulary (closed set):
 *   collected | pending | refunded | voided | failed | other
 *
 * If a source sends a status we've never seen before, we map it to 'other'
 * rather than guessing -- 'other' is never revenue (see allowedStatuses.js),
 * so an unrecognized status can NEVER silently count as collected money.
 * It still gets stored (raw_status + status_canonical='other') so it's
 * visible for a human to triage and add a mapping.
 */

const CANONICAL = {
  COLLECTED: 'collected',
  PENDING: 'pending',
  REFUNDED: 'refunded',
  VOIDED: 'voided',
  FAILED: 'failed',
  OTHER: 'other',
};

const SOURCE_MAPS = {
  // Stripe charge/payment_intent statuses
  stripe: {
    succeeded: CANONICAL.COLLECTED,
    paid: CANONICAL.COLLECTED,
    processing: CANONICAL.PENDING,
    requires_payment_method: CANONICAL.PENDING,
    requires_action: CANONICAL.PENDING,
    requires_confirmation: CANONICAL.PENDING,
    canceled: CANONICAL.VOIDED,
    failed: CANONICAL.FAILED,
    refunded: CANONICAL.REFUNDED,
  },

  // Example second source, e.g. a CRM/invoicing system with its own vocab.
  // Kept here to demonstrate the pipeline handling >1 source without
  // touching the metrics service at all.
  crm_invoices: {
    completed: CANONICAL.COLLECTED,
    paid_in_full: CANONICAL.COLLECTED,
    open: CANONICAL.PENDING,
    draft: CANONICAL.PENDING,
    void: CANONICAL.VOIDED,
    uncollectible: CANONICAL.FAILED,
    refunded: CANONICAL.REFUNDED,
  },
};

/**
 * @param {string} source - e.g. 'stripe'
 * @param {string} rawStatus - status string as reported by that source
 * @returns {string} canonical status, always one of CANONICAL's values
 */
function toCanonicalStatus(source, rawStatus) {
  const map = SOURCE_MAPS[source];
  if (!map) return CANONICAL.OTHER;
  const normalizedKey = String(rawStatus || '').toLowerCase().trim();
  return map[normalizedKey] || CANONICAL.OTHER;
}

module.exports = { CANONICAL, SOURCE_MAPS, toCanonicalStatus };
