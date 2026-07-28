/**
 * ALLOW-LIST, not an exclusion list.
 *
 * This is deliberate: an exclusion list ("everything except pending/failed/
 * refunded/voided counts") silently treats any brand-new or misspelled
 * status as revenue. An allow-list treats anything it doesn't recognize as
 * NOT revenue, which is the safe failure direction for a number finance
 * will report externally.
 *
 * This constant is the ONLY place "what counts as collected" is defined.
 * metricsService.js is the ONLY module allowed to import it and use it in
 * a query. See test/no-second-revenue-definition.test.js for the guardrail
 * that fails CI if a second copy of this logic shows up anywhere else.
 */
const COLLECTED_STATUSES = Object.freeze(['collected']);

module.exports = { COLLECTED_STATUSES };
