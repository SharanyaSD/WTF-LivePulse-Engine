'use strict';

const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

// UUID v4 regex for path param validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Map query-param shorthand to a PostgreSQL interval string
const DATE_RANGE_MAP = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

// ---------------------------------------------------------------------------
// GET /api/gyms/:id/analytics
// Returns peak hours, revenue by plan, churn risk, and new/renewal ratio
// for the requested gym.  Query param: ?dateRange=7d|30d|90d (default 30d)
// ---------------------------------------------------------------------------
router.get('/gyms/:id/analytics', async (req, res, next) => {
  const gymId = req.params.id;
  if (!UUID_RE.test(gymId)) {
    return res.status(400).json({ error: 'Invalid gym id — must be a UUID' });
  }

  const rangeKey = req.query.dateRange || '30d';
  const interval = DATE_RANGE_MAP[rangeKey];
  if (!interval) {
    return res.status(400).json({
      error: `Invalid dateRange. Allowed values: ${Object.keys(DATE_RANGE_MAP).join(', ')}`,
    });
  }

  try {
    const [peakHours, revenueByPlan, churnRisk, ratioRows] = await Promise.all([
      // Peak hours from the materialized view
      pool.query(
        `SELECT day_of_week, hour_of_day, checkin_count
           FROM gym_hourly_stats
          WHERE gym_id = $1
          ORDER BY day_of_week, hour_of_day`,
        [gymId]
      ),

      // Revenue by plan type (stored on the payment record) in the date window
      pool.query(
        `SELECT
            p.plan_type,
            COALESCE(SUM(p.amount), 0)::numeric AS total_revenue,
            COUNT(p.id)                          AS payment_count
           FROM payments p
          WHERE p.gym_id = $1
            AND p.paid_at >= NOW() - $2::interval
          GROUP BY p.plan_type
          ORDER BY total_revenue DESC`,
        [gymId, interval]
      ),

      // Churn risk: active members with no check-in for 45+ days
      // High = 45–60 days inactive, Critical = 60+ days inactive
      pool.query(
        `SELECT
            m.id,
            m.name,
            m.email,
            m.last_checkin_at,
            CASE
              WHEN m.last_checkin_at IS NULL OR m.last_checkin_at < NOW() - INTERVAL '60 days'
                THEN 'CRITICAL'
              ELSE 'HIGH'
            END AS risk_level,
            EXTRACT(DAY FROM NOW() - COALESCE(m.last_checkin_at, NOW() - INTERVAL '90 days'))::int AS days_inactive
           FROM members m
          WHERE m.gym_id = $1
            AND m.status = 'active'
            AND (m.last_checkin_at IS NULL OR m.last_checkin_at < NOW() - INTERVAL '45 days')
          ORDER BY m.last_checkin_at ASC NULLS FIRST
          LIMIT 50`,
        [gymId]
      ),

      // New vs renewal ratio in the date window
      pool.query(
        `SELECT
            payment_type,
            COUNT(*) AS count
           FROM payments
          WHERE gym_id = $1
            AND paid_at >= NOW() - $2::interval
            AND payment_type IN ('new', 'renewal')
          GROUP BY payment_type`,
        [gymId, interval]
      ),
    ]);

    // Compute new/renewal ratio
    const ratioMap = Object.fromEntries(
      ratioRows.rows.map((r) => [r.payment_type, Number(r.count)])
    );
    const newCount = ratioMap['new'] || 0;
    const renewalCount = ratioMap['renewal'] || 0;
    const total = newCount + renewalCount;
    const new_renewal_ratio = total > 0 ? Math.round((newCount / total) * 100) : null;

    res.json({
      gym_id: gymId,
      date_range: rangeKey,
      peak_hours: peakHours.rows,
      revenue_by_plan: revenueByPlan.rows.map((r) => ({
        plan_type: r.plan_type,
        total_revenue: Number(r.total_revenue),
        payment_count: Number(r.payment_count),
      })),
      churn_risk_members: churnRisk.rows,
      new_renewal_ratio: {
        new_count: newCount,
        renewal_count: renewalCount,
        new_pct: new_renewal_ratio,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/cross-gym
// All gyms ranked by total revenue in the last 30 days.
// ---------------------------------------------------------------------------
router.get('/analytics/cross-gym', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        g.id,
        g.name,
        g.city,
        g.capacity,
        COALESCE(SUM(p.amount), 0)::numeric        AS total_revenue,
        COUNT(DISTINCT p.member_id)                 AS paying_members,
        COUNT(DISTINCT c.id)                        AS total_checkins,
        RANK() OVER (ORDER BY COALESCE(SUM(p.amount), 0) DESC) AS revenue_rank
      FROM gyms g
      LEFT JOIN payments p
        ON p.gym_id = g.id AND p.paid_at >= NOW() - INTERVAL '30 days'
      LEFT JOIN checkins c
        ON c.gym_id = g.id AND c.checked_in >= NOW() - INTERVAL '30 days'
      GROUP BY g.id, g.name, g.city, g.capacity
      ORDER BY total_revenue DESC
    `);

    res.json(
      rows.map((r) => ({
        id: r.id,
        gym_name: r.name,
        city: r.city,
        capacity: r.capacity,
        total_revenue: Number(r.total_revenue),
        paying_members: Number(r.paying_members),
        total_checkins: Number(r.total_checkins),
        revenue_rank: Number(r.revenue_rank),
      }))
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
