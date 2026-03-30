'use strict';

const pool = require('../db/pool');

// Operating hours defaults (can be overridden via env)
const OPS_START = Number(process.env.GYM_OPERATING_HOURS_START ?? 6);
const OPS_END   = Number(process.env.GYM_OPERATING_HOURS_END   ?? 22);

// ---------------------------------------------------------------------------
// Helper: is the current local hour within operating hours?
// ---------------------------------------------------------------------------
function isDuringOperatingHours() {
  const hour = new Date().getHours();
  return hour >= OPS_START && hour < OPS_END;
}

// ---------------------------------------------------------------------------
// upsertAnomaly
// Inserts a new anomaly if one with the same (gym_id, type) is not already
// active (resolved=false, dismissed=false).  Returns the row.
// Severity must be 'warning' or 'critical' per DB constraint.
// ---------------------------------------------------------------------------
async function upsertAnomaly(gymId, type, severity, message) {
  const { rows } = await pool.query(
    `INSERT INTO anomalies (gym_id, type, severity, message)
     SELECT $1, $2, $3, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM anomalies
        WHERE gym_id   = $1
          AND type      = $2
          AND resolved  = false
          AND dismissed = false
     )
     RETURNING *`,
    [gymId, type, severity, message]
  );

  if (rows.length > 0) return rows[0];

  // Return the existing active anomaly
  const existing = await pool.query(
    `SELECT * FROM anomalies
      WHERE gym_id   = $1
        AND type      = $2
        AND resolved  = false
        AND dismissed = false
      LIMIT 1`,
    [gymId, type]
  );
  return existing.rows[0] || null;
}

// ---------------------------------------------------------------------------
// detectZeroCheckins
// For each active gym during operating hours, flag if no checkin in >2 hours.
// Returns array of newly-created anomaly rows.
// ---------------------------------------------------------------------------
async function detectZeroCheckins(gyms) {
  if (!isDuringOperatingHours()) return [];

  const created = [];

  for (const gym of gyms) {
    if (gym.status !== 'active') continue;

    const { rows } = await pool.query(
      `SELECT checked_in
         FROM checkins
        WHERE gym_id = $1
        ORDER BY checked_in DESC
        LIMIT 1`,
      [gym.id]
    );

    const lastCheckin = rows[0] ? new Date(rows[0].checked_in) : null;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    if (!lastCheckin || lastCheckin < twoHoursAgo) {
      const message = lastCheckin
        ? `No check-ins at ${gym.name} for over 2 hours (last: ${lastCheckin.toISOString()})`
        : `No check-ins ever recorded at ${gym.name}`;

      const anomaly = await upsertAnomaly(gym.id, 'zero_checkins', 'warning', message);
      if (anomaly && anomaly.detected_at) {
        // Only treat as "new" if it was just created (within last 5 s)
        const age = Date.now() - new Date(anomaly.detected_at).getTime();
        if (age < 5000) created.push(anomaly);
      }
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// detectCapacityBreach
// Flags gyms where live occupancy exceeds 90% of capacity.
// ---------------------------------------------------------------------------
async function detectCapacityBreach(gyms) {
  const created = [];

  for (const gym of gyms) {
    if (gym.status !== 'active') continue;

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS occupancy
         FROM checkins
        WHERE gym_id = $1
          AND checked_out IS NULL`,
      [gym.id]
    );

    const occupancy = rows[0].occupancy;
    const pct = gym.capacity > 0 ? occupancy / gym.capacity : 0;

    if (pct > 0.9) {
      const message = `${gym.name} is at ${Math.round(pct * 100)}% capacity (${occupancy}/${gym.capacity})`;
      const anomaly = await upsertAnomaly(gym.id, 'capacity_breach', 'critical', message);
      if (anomaly && anomaly.detected_at) {
        const age = Date.now() - new Date(anomaly.detected_at).getTime();
        if (age < 5000) created.push(anomaly);
      }
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// detectRevenueDrop
// Compares today's revenue to the same weekday last week.  Flags if < 70%.
// ---------------------------------------------------------------------------
async function detectRevenueDrop(gyms) {
  const created = [];

  for (const gym of gyms) {
    if (gym.status !== 'active') continue;

    const { rows } = await pool.query(
      `SELECT
          COALESCE(SUM(CASE WHEN paid_at >= CURRENT_DATE THEN amount END), 0)::numeric              AS today_rev,
          COALESCE(SUM(CASE WHEN paid_at::date = CURRENT_DATE - INTERVAL '7 days' THEN amount END), 0)::numeric AS last_week_rev
         FROM payments
        WHERE gym_id = $1
          AND paid_at >= CURRENT_DATE - INTERVAL '7 days'`,
      [gym.id]
    );

    const todayRev = Number(rows[0].today_rev);
    const lastWeekRev = Number(rows[0].last_week_rev);

    // Only flag if last week had meaningful revenue to compare against
    if (lastWeekRev > 0 && todayRev < lastWeekRev * 0.7) {
      const dropPct = Math.round((1 - todayRev / lastWeekRev) * 100);
      const message =
        `${gym.name} revenue is down ${dropPct}% vs same day last week ` +
        `(₹${todayRev.toFixed(2)} today vs ₹${lastWeekRev.toFixed(2)} last week)`;

      const anomaly = await upsertAnomaly(gym.id, 'revenue_drop', 'warning', message);
      if (anomaly && anomaly.detected_at) {
        const age = Date.now() - new Date(anomaly.detected_at).getTime();
        if (age < 5000) created.push(anomaly);
      }
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// resolveAnomaly
// Marks a specific anomaly as resolved.
// ---------------------------------------------------------------------------
async function resolveAnomaly(anomalyId) {
  const { rows } = await pool.query(
    `UPDATE anomalies
        SET resolved = true, resolved_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [anomalyId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// autoResolveCheckins
// Resolve any active zero_checkins anomaly for a gym if a checkin now exists.
// ---------------------------------------------------------------------------
async function autoResolveCheckins(gymId) {
  const { rows: recent } = await pool.query(
    `SELECT id FROM checkins WHERE gym_id = $1 ORDER BY checked_in DESC LIMIT 1`,
    [gymId]
  );

  if (recent.length === 0) return [];

  const { rows: anomalies } = await pool.query(
    `UPDATE anomalies
        SET resolved = true, resolved_at = NOW()
      WHERE gym_id   = $1
        AND type      = 'zero_checkins'
        AND resolved  = false
      RETURNING *`,
    [gymId]
  );

  return anomalies;
}

// ---------------------------------------------------------------------------
// autoResolveCapacity
// Resolve capacity_breach anomaly if occupancy drops below 85%.
// ---------------------------------------------------------------------------
async function autoResolveCapacity(gymId, occupancy, capacity) {
  const pct = capacity > 0 ? occupancy / capacity : 0;
  if (pct >= 0.85) return [];

  const { rows } = await pool.query(
    `UPDATE anomalies
        SET resolved = true, resolved_at = NOW()
      WHERE gym_id   = $1
        AND type      = 'capacity_breach'
        AND resolved  = false
      RETURNING *`,
    [gymId]
  );

  return rows;
}

// ---------------------------------------------------------------------------
// autoResolveRevenue
// Resolve revenue_drop anomaly if today's revenue is within 20% of last week.
// ---------------------------------------------------------------------------
async function autoResolveRevenue(gymId) {
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN paid_at >= CURRENT_DATE THEN amount END), 0)::numeric              AS today_rev,
        COALESCE(SUM(CASE WHEN paid_at::date = CURRENT_DATE - INTERVAL '7 days' THEN amount END), 0)::numeric AS last_week_rev
       FROM payments
      WHERE gym_id = $1
        AND paid_at >= CURRENT_DATE - INTERVAL '7 days'`,
    [gymId]
  );

  const todayRev    = Number(rows[0].today_rev);
  const lastWeekRev = Number(rows[0].last_week_rev);

  // Recovered = today's revenue is >= 80% of last week's
  if (lastWeekRev === 0 || todayRev >= lastWeekRev * 0.8) {
    const { rows: resolved } = await pool.query(
      `UPDATE anomalies
          SET resolved = true, resolved_at = NOW()
        WHERE gym_id   = $1
          AND type      = 'revenue_drop'
          AND resolved  = false
        RETURNING *`,
      [gymId]
    );
    return resolved;
  }

  return [];
}

module.exports = {
  detectZeroCheckins,
  detectCapacityBreach,
  detectRevenueDrop,
  resolveAnomaly,
  autoResolveCheckins,
  autoResolveCapacity,
  autoResolveRevenue,
  upsertAnomaly,
};
