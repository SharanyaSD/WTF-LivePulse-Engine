'use strict';

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep a small pool — each query already uses async/await
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Bubble up unexpected pool errors so the process can log / restart cleanly
pool.on('error', (err) => {
  console.error('[pool] Unexpected idle-client error:', err.message);
});

module.exports = pool;
