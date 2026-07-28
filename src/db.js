const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

pool.on('error', (err) => {
  // A stray idle-client error must never crash the whole process --
  // log it and let the pool recover the next request.
  console.error('Unexpected Postgres pool error:', err.message);
});

module.exports = { pool };
