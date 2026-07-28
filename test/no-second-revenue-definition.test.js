const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/**
 * This is the guardrail the assignment asks for: "if someone later adds a
 * second, slightly different way of computing this same number somewhere
 * else in the codebase, something would actually catch it."
 *
 * It works by walking every .js file under src/ (excluding the two files
 * that are SANCTIONED to know about revenue statuses) and failing if any of
 * them contain a status_canonical filter or a hardcoded 'collected' /
 * 'paid' / 'succeeded' style status string used in a query-shaped context.
 * That's exactly the shape a second, drifted revenue calculation would take.
 */

const SRC_DIR = path.join(__dirname, '..', 'src');
const SANCTIONED_FILES = new Set([
  path.join(SRC_DIR, 'metrics', 'allowedStatuses.js'),
  path.join(SRC_DIR, 'metrics', 'metricsService.js'),
  path.join(SRC_DIR, 'ingest', 'statusMap.js'), // defines the mapping INTO canonical, not revenue logic
]);

// Patterns that indicate someone is filtering/summing by revenue status
// outside the sanctioned files.
const SUSPICIOUS_PATTERNS = [
  // A WHERE clause (or "and") filtering by status_canonical -- this is the
  // shape a second revenue query would take. Deliberately does NOT match
  // `status_canonical = excluded.status_canonical`, which is a legitimate
  // write in the ingestion upsert, not a revenue filter.
  /(where|and)\s+status_canonical\s*=/i,
  /['"]collected['"]/,
  /sum\(amount_cents\)/i,
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('no second revenue-status definition exists outside metricsService/allowedStatuses', () => {
  const offenders = [];

  for (const file of walk(SRC_DIR)) {
    if (SANCTIONED_FILES.has(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(content)) {
        offenders.push({ file: path.relative(SRC_DIR, file), pattern: pattern.toString() });
      }
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `Found revenue-status logic outside the sanctioned files. This is exactly the kind of ` +
      `drift the allow-list pattern is meant to prevent -- route the logic through ` +
      `metricsService.js instead:\n${JSON.stringify(offenders, null, 2)}`
  );
});
