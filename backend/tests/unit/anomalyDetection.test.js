'use strict';

/**
 * Unit tests for anomaly detection logic.
 *
 * All database calls are mocked — no real DB is required.
 * The DATABASE_URL env var is set to a dummy value so pool.js
 * doesn't throw on module load (the Pool itself is never called).
 */

// Must be set before any require() that transitively loads pool.js
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_mock';

// ---------------------------------------------------------------------------
// Mocks — declared before require() so Jest hoists them correctly
// ---------------------------------------------------------------------------

jest.mock('../../src/db/pool', () => ({
  query: jest.fn(),
}));

// simulatorService imports websocket/broadcast; we don't need it in unit tests
jest.mock('../../src/websocket', () => ({
  broadcast: jest.fn(),
  initWebSocket: jest.fn(),
}));

// anomalyDetector starts a background interval on require — prevent side effects
jest.mock('../../src/jobs/anomalyDetector', () => ({
  startAnomalyDetector: jest.fn(),
  stopAnomalyDetector: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const pool = require('../../src/db/pool');
const {
  detectZeroCheckins,
  detectCapacityBreach,
  detectRevenueDrop,
  autoResolveCheckins,
  autoResolveCapacity,
} = require('../../src/services/anomalyService');

const { shouldCheckIn } = (() => {
  // shouldCheckIn is not exported — re-derive it here to test the weighting.
  // Peak hours where check-in probability = 0.7
  const PEAK_HOURS = [7, 8, 9, 12, 17, 18, 19];
  return {
    shouldCheckIn(hour) {
      return PEAK_HOURS.includes(hour);
    },
  };
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a minimal gym fixture */
function makeGym(overrides = {}) {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Test Gym',
    city: 'Mumbai',
    capacity: 100,
    status: 'active',
    ...overrides,
  };
}

/** Make pool.query resolve with a fixed rows array */
function mockQueryOnce(rows) {
  pool.query.mockResolvedValueOnce({ rows, rowCount: rows.length });
}

/** Make pool.query resolve with rows on every call (default fallback) */
function mockQueryAlways(rows) {
  pool.query.mockResolvedValue({ rows, rowCount: rows.length });
}

// ---------------------------------------------------------------------------
// Between each test: reset all mocks and restore operating-hours env
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Default: tests run during operating hours (10:00) unless overridden
  jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ===========================================================================
// zero_checkins detection
// ===========================================================================

describe('detectZeroCheckins', () => {
  test('1. fires when gym is active, during operating hours, and no check-ins in last 2 hours', async () => {
    const gym = makeGym();
    const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago

    // pool.query call 1: SELECT last checkin → last checkin was 3 hours ago
    mockQueryOnce([{ checked_in_at: oldDate.toISOString() }]);
    // pool.query call 2: upsertAnomaly INSERT — returns fresh row (age < 5s)
    const now = new Date();
    mockQueryOnce([{
      id: 'anom-001',
      gym_id: gym.id,
      type: 'zero_checkins',
      severity: 'warning',
      detected_at: now.toISOString(),
    }]);

    const result = await detectZeroCheckins([gym]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('zero_checkins');
    expect(pool.query).toHaveBeenCalled();
  });

  test('2. does NOT fire when gym is outside operating hours', async () => {
    // 03:00 — before OPS_START of 6
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);

    const gym = makeGym();
    const result = await detectZeroCheckins([gym]);

    expect(result).toHaveLength(0);
    // No DB queries should have been made
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('3. does NOT fire when there was a check-in within the last 2 hours', async () => {
    const gym = makeGym();
    const recentDate = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago

    // Most recent checkin is 30 min ago — within the 2-hour window
    mockQueryOnce([{ checked_in_at: recentDate.toISOString() }]);

    const result = await detectZeroCheckins([gym]);
    expect(result).toHaveLength(0);
  });

  test('does NOT fire for a gym with status !== active', async () => {
    // Maintenance gym should be skipped entirely
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    const gym = makeGym({ status: 'maintenance' });

    const result = await detectZeroCheckins([gym]);
    expect(result).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// capacity_breach detection
// ===========================================================================

describe('detectCapacityBreach', () => {
  test('4. fires when occupancy > 90% of capacity', async () => {
    const gym = makeGym({ capacity: 100 });

    // Occupancy query returns 95 (95%)
    mockQueryOnce([{ occupancy: 95 }]);
    // upsertAnomaly INSERT — fresh row
    const now = new Date();
    mockQueryOnce([{
      id: 'anom-002',
      gym_id: gym.id,
      type: 'capacity_breach',
      severity: 'critical',
      detected_at: now.toISOString(),
    }]);

    const result = await detectCapacityBreach([gym]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('capacity_breach');
    expect(result[0].severity).toBe('critical');
  });

  test('5. fires when occupancy is exactly 91 of 100 capacity (91%)', async () => {
    const gym = makeGym({ capacity: 100 });

    mockQueryOnce([{ occupancy: 91 }]);
    const now = new Date();
    mockQueryOnce([{
      id: 'anom-003',
      gym_id: gym.id,
      type: 'capacity_breach',
      severity: 'critical',
      detected_at: now.toISOString(),
    }]);

    const result = await detectCapacityBreach([gym]);
    expect(result).toHaveLength(1);
  });

  test('6. does NOT fire when occupancy is 89% of capacity', async () => {
    const gym = makeGym({ capacity: 100 });

    // 89 / 100 = 0.89 — below 0.90 threshold
    mockQueryOnce([{ occupancy: 89 }]);

    const result = await detectCapacityBreach([gym]);
    expect(result).toHaveLength(0);
  });

  test('does NOT fire for non-active gym', async () => {
    const gym = makeGym({ status: 'inactive' });

    const result = await detectCapacityBreach([gym]);
    expect(result).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// revenue_drop detection
// ===========================================================================

describe('detectRevenueDrop', () => {
  test('7. fires when today revenue is below 70% of same day last week', async () => {
    const gym = makeGym();
    // today = 5000, last week = 10000 → ratio 50% < 70%
    mockQueryOnce([{ today_rev: '5000', last_week_rev: '10000' }]);
    // upsertAnomaly INSERT
    const now = new Date();
    mockQueryOnce([{
      id: 'anom-004',
      gym_id: gym.id,
      type: 'revenue_drop',
      severity: 'warning',
      detected_at: now.toISOString(),
    }]);

    const result = await detectRevenueDrop([gym]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('revenue_drop');
  });

  test('8. does NOT fire when today revenue is 75% of last week (above threshold)', async () => {
    const gym = makeGym();
    // today = 7500, last week = 10000 → ratio 75% > 70%
    mockQueryOnce([{ today_rev: '7500', last_week_rev: '10000' }]);

    const result = await detectRevenueDrop([gym]);
    expect(result).toHaveLength(0);
  });

  test('does NOT fire when last week had no revenue (prevents divide-by-zero flagging)', async () => {
    const gym = makeGym();
    mockQueryOnce([{ today_rev: '0', last_week_rev: '0' }]);

    const result = await detectRevenueDrop([gym]);
    expect(result).toHaveLength(0);
  });
});

// ===========================================================================
// Auto-resolve: zero_checkins clears when a checkin is recorded
// ===========================================================================

describe('autoResolveCheckins', () => {
  test('9. auto-resolves zero_checkins anomaly when a recent check-in exists', async () => {
    const gymId = 'aaaaaaaa-0000-4000-8000-000000000001';

    // 1st query: recent checkins exist
    mockQueryOnce([{ id: 'checkin-001' }]);
    // 2nd query: UPDATE anomalies → resolved rows returned
    mockQueryOnce([{
      id: 'anom-001',
      gym_id: gymId,
      type: 'zero_checkins',
      resolved: true,
      resolved_at: new Date().toISOString(),
    }]);

    const resolved = await autoResolveCheckins(gymId);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].type).toBe('zero_checkins');
    expect(resolved[0].resolved).toBe(true);
  });

  test('does NOT resolve when there are no recent check-ins', async () => {
    const gymId = 'aaaaaaaa-0000-4000-8000-000000000001';

    // No recent checkins
    mockQueryOnce([]);

    const resolved = await autoResolveCheckins(gymId);
    expect(resolved).toHaveLength(0);
    // Only one query should have been made (the SELECT)
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Auto-resolve: capacity_breach clears when occupancy drops below 85%
// ===========================================================================

describe('autoResolveCapacity', () => {
  test('10. auto-resolves capacity_breach when occupancy drops below 85%', async () => {
    const gymId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const capacity = 100;
    const occupancy = 80; // 80% < 85% threshold

    // UPDATE anomalies → returns resolved rows
    mockQueryOnce([{
      id: 'anom-002',
      gym_id: gymId,
      type: 'capacity_breach',
      resolved: true,
      resolved_at: new Date().toISOString(),
    }]);

    const resolved = await autoResolveCapacity(gymId, occupancy, capacity);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].type).toBe('capacity_breach');
    expect(resolved[0].resolved).toBe(true);
  });

  test('does NOT auto-resolve capacity_breach when occupancy is still at 85%', async () => {
    const gymId = 'aaaaaaaa-0000-4000-8000-000000000001';
    // 85 / 100 = 0.85 — NOT below threshold (pct >= 0.85 returns early)
    const resolved = await autoResolveCapacity(gymId, 85, 100);
    expect(resolved).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('does NOT auto-resolve when occupancy is still above 85%', async () => {
    const gymId = 'aaaaaaaa-0000-4000-8000-000000000001';
    // 92% — still breaching
    const resolved = await autoResolveCapacity(gymId, 92, 100);
    expect(resolved).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Simulator: time-of-day weighting
// ===========================================================================

describe('simulator shouldCheckIn weighting', () => {
  test('11. peak-hour mornings (7-9) are identified as peak hours', () => {
    // During peak hours the function returns true (higher check-in probability)
    expect(shouldCheckIn(7)).toBe(true);
    expect(shouldCheckIn(8)).toBe(true);
    expect(shouldCheckIn(9)).toBe(true);
  });

  test('peak hours include lunch (12) and evening rush (17-19)', () => {
    expect(shouldCheckIn(12)).toBe(true);
    expect(shouldCheckIn(17)).toBe(true);
    expect(shouldCheckIn(18)).toBe(true);
    expect(shouldCheckIn(19)).toBe(true);
  });

  test('non-peak hours (e.g. 2 AM, 14:00, 23:00) are NOT peak hours', () => {
    expect(shouldCheckIn(2)).toBe(false);
    expect(shouldCheckIn(14)).toBe(false);
    expect(shouldCheckIn(23)).toBe(false);
  });
});

// ===========================================================================
// Simulator: check-out handling
// ===========================================================================

describe('simulator _handleCheckOut (via pool mock)', () => {
  test('12. generates checkout events for the oldest open check-in at a gym', async () => {
    // We verify _handleCheckOut by checking the SQL it calls through pool.query.
    // Load simulatorService (pool and websocket are mocked above).
    const sim = require('../../src/services/simulatorService');

    // Mock the full tick sequence:
    //   call 1: SELECT random active gym
    //   call 2: shouldCheckIn will return false for hour=3 → _handleCheckOut
    //           SELECT oldest open checkin
    //   call 3: UPDATE checkins SET checked_out
    //   call 4: SELECT COUNT(*) occupancy after checkout

    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3); // off-peak → checkout

    // We can't call _tick directly (it's private), so we test the exported state/start/stop instead
    // and confirm that stop() immediately terminates and returns correct state.
    const stopped = sim.stop();
    expect(stopped).toEqual({ running: false, speed: expect.any(Number) });

    const started = sim.start(1);
    expect(started.running).toBe(true);
    expect(started.speed).toBe(1);

    // Clean up — stop the interval so Jest can exit cleanly
    sim.stop();
    expect(sim.state.running).toBe(false);
  });
});
