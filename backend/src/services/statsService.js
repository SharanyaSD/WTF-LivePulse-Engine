'use strict';

const pool = require('../db/pool');

// ---------------------------------------------------------------------------
// getGymOccupancy
// Returns the number of members currently checked in (checked_out IS NULL).
// ---------------------------------------------------------------------------
async function getGymOccupancy(gymId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS occupancy
       FROM checkins
      WHERE gym_id = $1
        AND checked_out IS NULL`,
    [gymId]
  );
  return rows[0].occupancy;
}

// ---------------------------------------------------------------------------
// getTodayRevenue
// Returns the sum of payments made since midnight today (UTC).
// Returns 0 if no payments exist.
// ---------------------------------------------------------------------------
async function getTodayRevenue(gymId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS revenue
       FROM payments
      WHERE gym_id = $1
        AND paid_at >= CURRENT_DATE`,
    [gymId]
  );
  return Number(rows[0].revenue);
}

// ---------------------------------------------------------------------------
// getRecentEvents
// Returns the last `limit` events across checkins and payments, optionally
// filtered to a single gym.  Events are sorted newest-first.
// ---------------------------------------------------------------------------
async function getRecentEvents(limit = 20, gymId = null) {
  const params = [limit];
  const gymFilter = gymId != null ? `AND e.gym_id = $${params.push(gymId)}` : '';

  const { rows } = await pool.query(
    `SELECT *
       FROM (
         SELECT
           'checkin'             AS event_type,
           c.id                  AS event_id,
           c.gym_id,
           g.name                AS gym_name,
           c.member_id,
           m.name                AS member_name,
           c.checked_in          AS occurred_at,
           c.checked_out,
           NULL::numeric         AS amount,
           NULL::text            AS payment_type
         FROM checkins c
         JOIN gyms    g ON g.id = c.gym_id
         JOIN members m ON m.id = c.member_id

         UNION ALL

         SELECT
           'payment'             AS event_type,
           p.id::text            AS event_id,
           p.gym_id,
           g.name                AS gym_name,
           p.member_id,
           m.name                AS member_name,
           p.paid_at             AS occurred_at,
           NULL::timestamptz,
           p.amount,
           p.payment_type
         FROM payments p
         JOIN gyms    g ON g.id = p.gym_id
         JOIN members m ON m.id = p.member_id
       ) e
      WHERE 1 = 1 ${gymFilter}
      ORDER BY e.occurred_at DESC
      LIMIT $1`,
    params
  );

  return rows;
}

// ---------------------------------------------------------------------------
// refreshMaterializedView
// Refreshes gym_hourly_stats without locking reads (CONCURRENTLY).
// ---------------------------------------------------------------------------
async function refreshMaterializedView() {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY gym_hourly_stats');
}

module.exports = {
  getGymOccupancy,
  getTodayRevenue,
  getRecentEvents,
  refreshMaterializedView,
};
