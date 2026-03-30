'use strict';

const { Router } = require('express');
const pool = require('../db/pool');
const { getGymOccupancy, getTodayRevenue, getRecentEvents } = require('../services/statsService');

const router = Router();

// UUID v4 regex for path param validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// GET /api/gyms
// List all gyms with live occupancy and today's revenue.
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { rows: gyms } = await pool.query(`
      SELECT
        g.id,
        g.name,
        g.city,
        g.capacity,
        g.status,
        COUNT(c.id)                        AS current_occupancy,
        COALESCE(SUM(p.amount), 0)::numeric AS today_revenue
      FROM gyms g
      LEFT JOIN checkins c
        ON c.gym_id = g.id AND c.checked_out IS NULL
      LEFT JOIN payments p
        ON p.gym_id = g.id AND p.paid_at >= CURRENT_DATE
      GROUP BY g.id, g.name, g.city, g.capacity, g.status
      ORDER BY g.name
    `);

    res.json(
      gyms.map((g) => ({
        id: g.id,
        name: g.name,
        city: g.city,
        capacity: g.capacity,
        status: g.status,
        current_occupancy: Number(g.current_occupancy),
        today_revenue: Number(g.today_revenue),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/gyms/:id/live
// Single-gym snapshot — all sub-queries run in parallel (Promise.all).
// Target: complete < 5 ms on warm DB.
// ---------------------------------------------------------------------------
router.get('/:id/live', async (req, res, next) => {
  const gymId = req.params.id;
  if (!UUID_RE.test(gymId)) {
    return res.status(400).json({ error: 'Invalid gym id — must be a UUID' });
  }

  try {
    const [gymRow, occupancyRow, revenueRow, recentEvents, anomalyRows] =
      await Promise.all([
        // Gym metadata
        pool.query('SELECT id, name, city, capacity, status FROM gyms WHERE id = $1', [gymId]),

        // Live occupancy count
        getGymOccupancy(gymId),

        // Today's revenue
        getTodayRevenue(gymId),

        // Last 20 events (checkins + payments)
        getRecentEvents(20, gymId),

        // Active anomalies for this gym
        pool.query(
          `SELECT id, type, severity, message, detected_at
             FROM anomalies
            WHERE gym_id = $1
              AND resolved = false
              AND dismissed = false
            ORDER BY detected_at DESC`,
          [gymId]
        ),
      ]);

    if (gymRow.rowCount === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const gym = gymRow.rows[0];
    const occupancy = Number(occupancyRow);
    const capacity = gym.capacity;
    const occupancy_pct = capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0;

    res.json({
      gym,
      occupancy,
      occupancy_pct,
      today_revenue: Number(revenueRow),
      recent_events: recentEvents,
      active_anomalies: anomalyRows.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/gyms/:id/members
// List members for a gym with optional filters.
// Query params: status (active/inactive/frozen), plan_type, limit, offset
// ---------------------------------------------------------------------------
router.get('/:id/members', async (req, res, next) => {
  const gymId = req.params.id;
  if (!UUID_RE.test(gymId)) {
    return res.status(400).json({ error: 'Invalid gym id — must be a UUID' });
  }

  const { status, plan_type, limit = 50, offset = 0 } = req.query;
  const conditions = ['m.gym_id = $1'];
  const params = [gymId];

  if (status) { params.push(status); conditions.push(`m.status = $${params.length}`); }
  if (plan_type) { params.push(plan_type); conditions.push(`m.plan_type = $${params.length}`); }

  try {
    const { rows } = await pool.query(`
      SELECT
        m.id, m.name, m.email, m.phone,
        m.plan_type, m.member_type, m.status,
        m.joined_at, m.plan_expires_at, m.last_checkin_at,
        CASE
          WHEN m.last_checkin_at < NOW() - INTERVAL '60 days' THEN 'CRITICAL'
          WHEN m.last_checkin_at < NOW() - INTERVAL '45 days' THEN 'HIGH'
          ELSE NULL
        END AS churn_risk
      FROM members m
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.joined_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, Number(limit), Number(offset)]);

    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*) AS total FROM members m WHERE ${conditions.join(' AND ')}`,
      params
    );

    res.json({ total: Number(total), limit: Number(limit), offset: Number(offset), members: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
