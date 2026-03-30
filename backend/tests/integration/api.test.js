'use strict';

/**
 * Integration tests for the WTF LivePulse REST API.
 *
 * Requires a running PostgreSQL database seeded with the standard seed data
 * (10 gyms, members, payments, anomalies).
 *
 * Set DATABASE_URL in the environment to run these tests.
 * If DATABASE_URL is absent the whole suite is skipped gracefully.
 *
 * Run with: jest tests/integration
 *   or:     DATABASE_URL=postgres://... jest tests/integration
 */

// DATABASE_URL must be present before pool.js is loaded. Check early.
const DB_AVAILABLE = Boolean(process.env.DATABASE_URL);

// We still need to mock the anomalyDetector to stop it from spawning
// a background interval that keeps Jest alive after tests finish.
jest.mock('../../src/jobs/anomalyDetector', () => ({
  startAnomalyDetector: jest.fn(),
  stopAnomalyDetector: jest.fn(),
}));

// Similarly prevent the simulator interval from leaking into Jest's timer queue.
// The simulator router is tested via HTTP — we don't need the real setInterval.
jest.mock('../../src/services/simulatorService', () => {
  const state = { running: false, speed: 1 };
  return {
    state,
    start(speed = 1) {
      state.running = true;
      state.speed = speed;
      return { running: state.running, speed: state.speed };
    },
    stop() {
      state.running = false;
      return { running: state.running, speed: state.speed };
    },
    async reset() {
      state.running = false;
      return { running: state.running, speed: state.speed };
    },
  };
});

// WebSocket server must not actually bind a port during tests
jest.mock('../../src/websocket', () => ({
  broadcast: jest.fn(),
  initWebSocket: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Conditional describe: skip everything when no DB is configured
// ---------------------------------------------------------------------------
const skipIfNoDb = DB_AVAILABLE ? describe : describe.skip;

// Use a separate require so supertest/app only loads when DB is available;
// this avoids the pool.js "DATABASE_URL required" throw when skipping.
let request;
let app;

if (DB_AVAILABLE) {
  request = require('supertest');
  ({ app } = require('../../src/app'));
}

// ---------------------------------------------------------------------------
// Shared state across tests
// ---------------------------------------------------------------------------
let gymId;         // A real gym UUID fetched from /api/gyms
let anomalyId;     // A critical anomaly UUID fetched from /api/anomalies
let warningAnomalyId; // A warning anomaly for dismiss tests

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

skipIfNoDb('API Integration Tests', () => {
  // Fetch a valid gym ID once before all tests run
  beforeAll(async () => {
    const res = await request(app).get('/api/gyms');
    gymId = res.body[0]?.id;

    // Try to grab a critical anomaly and a warning anomaly for later tests
    const anomRes = await request(app).get('/api/anomalies');
    if (Array.isArray(anomRes.body)) {
      const critical = anomRes.body.find((a) => a.severity === 'critical');
      const warning  = anomRes.body.find((a) => a.severity === 'warning');
      if (critical) anomalyId = critical.id;
      if (warning)  warningAnomalyId = warning.id;
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/gyms
  // -------------------------------------------------------------------------

  test('1. GET /api/gyms returns 200 with an array of 10 gyms after seeding', async () => {
    const res = await request(app).get('/api/gyms');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(10);
  });

  test('2. GET /api/gyms response objects have the required fields', async () => {
    const res = await request(app).get('/api/gyms');
    const gym = res.body[0];
    const REQUIRED = ['id', 'name', 'city', 'capacity', 'current_occupancy', 'today_revenue', 'status'];
    for (const field of REQUIRED) {
      expect(gym).toHaveProperty(field);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/gyms/:id/live
  // -------------------------------------------------------------------------

  test('3. GET /api/gyms/:id/live returns 200 with all required fields', async () => {
    expect(gymId).toBeDefined();
    const res = await request(app).get(`/api/gyms/${gymId}/live`);
    expect(res.status).toBe(200);

    const REQUIRED = ['gym', 'occupancy', 'occupancy_pct', 'today_revenue', 'recent_events', 'active_anomalies'];
    for (const field of REQUIRED) {
      expect(res.body).toHaveProperty(field);
    }
    // Nested gym object must have basic fields
    expect(res.body.gym).toHaveProperty('id', gymId);
    expect(res.body.gym).toHaveProperty('name');
    expect(res.body.gym).toHaveProperty('capacity');
  });

  test('4. GET /api/gyms/:id/live returns 400 for an invalid (non-UUID) id', async () => {
    const res = await request(app).get('/api/gyms/not-a-uuid/live');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('5. GET /api/gyms/:id/live returns 404 for a well-formed but non-existent UUID', async () => {
    const fakeId = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const res = await request(app).get(`/api/gyms/${fakeId}/live`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // GET /api/anomalies
  // -------------------------------------------------------------------------

  test('6. GET /api/anomalies returns 200 with an array', async () => {
    const res = await request(app).get('/api/anomalies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('7. GET /api/anomalies?severity=critical returns only critical anomalies', async () => {
    const res = await request(app).get('/api/anomalies?severity=critical');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const anomaly of res.body) {
      expect(anomaly.severity).toBe('critical');
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/anomalies/:id/dismiss
  // -------------------------------------------------------------------------

  test('8. PATCH /api/anomalies/:id/dismiss returns 403 for a critical anomaly', async () => {
    if (!anomalyId) {
      console.warn('Skipping test 8: no critical anomaly found in DB');
      return;
    }
    const res = await request(app).patch(`/api/anomalies/${anomalyId}/dismiss`);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('9. PATCH /api/anomalies/invalid-id/dismiss returns 400 for non-UUID id', async () => {
    const res = await request(app).patch('/api/anomalies/invalid-id/dismiss');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // POST /api/simulator/start and /stop
  // -------------------------------------------------------------------------

  test('10. POST /api/simulator/start returns 200 with running=true', async () => {
    const res = await request(app).post('/api/simulator/start').send({ speed: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('running', true);
  });

  test('11. POST /api/simulator/stop returns 200 with running=false', async () => {
    const res = await request(app).post('/api/simulator/stop');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('running', false);
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/cross-gym
  // -------------------------------------------------------------------------

  test('12. GET /api/analytics/cross-gym returns 200 with array of gyms with total_revenue', async () => {
    const res = await request(app).get('/api/analytics/cross-gym');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('gyms');
    expect(Array.isArray(res.body.gyms)).toBe(true);

    const firstGym = res.body.gyms[0];
    expect(firstGym).toHaveProperty('id');
    expect(firstGym).toHaveProperty('name');
    expect(firstGym).toHaveProperty('total_revenue');
    expect(typeof firstGym.total_revenue).toBe('number');
  });

  // -------------------------------------------------------------------------
  // GET /api/gyms/:id/analytics
  // -------------------------------------------------------------------------

  test('13. GET /api/gyms/:id/analytics returns 200 with expected shape', async () => {
    expect(gymId).toBeDefined();
    const res = await request(app).get(`/api/gyms/${gymId}/analytics`);
    expect(res.status).toBe(200);

    // All four top-level keys must be present
    expect(res.body).toHaveProperty('peak_hours');
    expect(res.body).toHaveProperty('revenue_by_plan');
    expect(res.body).toHaveProperty('churn_risk_members');
    expect(res.body).toHaveProperty('new_renewal_ratio');

    expect(Array.isArray(res.body.peak_hours)).toBe(true);
    expect(Array.isArray(res.body.revenue_by_plan)).toBe(true);
    expect(Array.isArray(res.body.churn_risk_members)).toBe(true);
    expect(res.body.new_renewal_ratio).toHaveProperty('new');
    expect(res.body.new_renewal_ratio).toHaveProperty('renewal');
  });
});
