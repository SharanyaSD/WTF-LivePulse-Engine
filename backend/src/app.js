'use strict';

require('dotenv').config();

const http    = require('http');
const express = require('express');
const cors    = require('cors');

const pool                = require('./db/pool');
const { initWebSocket }   = require('./websocket');
const { startAnomalyDetector } = require('./jobs/anomalyDetector');
const simulatorService    = require('./services/simulatorService');

// Routes
const gymsRouter      = require('./routes/gyms');
const analyticsRouter = require('./routes/analytics');
const anomaliesRouter = require('./routes/anomalies');
const simulatorRouter = require('./routes/simulator');

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------
const app = express();

app.use(cors());
app.use(express.json());

// Health / readiness check (no auth required)
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Mount API routes
app.use('/api/gyms',      gymsRouter);
// analyticsRouter handles both /api/gyms/:id/analytics and /api/analytics/cross-gym
// by being mounted at /api — it defines full sub-paths internally.
app.use('/api',           analyticsRouter);
app.use('/api/anomalies', anomaliesRouter);
app.use('/api/simulator', simulatorRouter);

// 404 handler for unknown API paths
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route found for ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[express] unhandled error:', err.stack || err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ---------------------------------------------------------------------------
// HTTP server (wraps Express so the WebSocket server can share the port)
// ---------------------------------------------------------------------------
const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Wait for DB migrations to be applied before allowing traffic
// ---------------------------------------------------------------------------
async function waitForMigrations(maxAttempts = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Minimal smoke-test: the "gyms" table must exist
      await pool.query('SELECT 1 FROM gyms LIMIT 1');
      console.info('[app] Database is ready');
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        throw new Error(`Database not ready after ${maxAttempts} attempts: ${err.message}`);
      }
      console.info(`[app] Waiting for migrations… attempt ${attempt}/${maxAttempts}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  const PORT = Number(process.env.PORT) || 3001;

  // 1. Wait for DB to be seeded / migrated
  await waitForMigrations();

  // 2. Attach WebSocket server to the HTTP server
  initWebSocket(server);

  // 3. Start background jobs
  startAnomalyDetector();

  // 4. Start simulator in paused mode — the frontend can start it via API
  //    Uncomment the next line to auto-start at speed 1 on boot:
  // simulatorService.start(1);

  // 5. Start listening
  server.listen(PORT, () => {
    console.info(`[app] WTF LivePulse backend listening on port ${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

async function shutdown(signal) {
  console.info(`[app] ${signal} received — shutting down gracefully…`);
  simulatorService.stop();
  server.close(async () => {
    await pool.end();
    console.info('[app] Shutdown complete');
    process.exit(0);
  });
}

// Only call start() when this file is run directly (not imported in tests)
if (require.main === module) {
  start().catch((err) => {
    console.error('[app] Fatal startup error:', err.message);
    process.exit(1);
  });
}

// Export app (and server) for integration tests
module.exports = { app, server };
