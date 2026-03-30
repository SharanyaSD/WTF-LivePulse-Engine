'use strict';

const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

// UUID v4 regex for path param validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// GET /api/anomalies
// List active (non-resolved, non-dismissed) anomalies.
// Optional query params: gym_id (UUID), severity (warning|critical)
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const conditions = ['resolved = false', 'dismissed = false'];
    const params = [];

    if (req.query.gym_id) {
      if (!UUID_RE.test(req.query.gym_id)) {
        return res.status(400).json({ error: 'Invalid gym_id — must be a UUID' });
      }
      params.push(req.query.gym_id);
      conditions.push(`a.gym_id = $${params.length}`);
    }

    if (req.query.severity) {
      const allowed = ['warning', 'critical'];
      if (!allowed.includes(req.query.severity)) {
        return res.status(400).json({
          error: `Invalid severity. Allowed: ${allowed.join(', ')}`,
        });
      }
      params.push(req.query.severity);
      conditions.push(`a.severity = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const { rows } = await pool.query(
      `SELECT
          a.id,
          a.gym_id,
          g.name AS gym_name,
          a.type,
          a.severity,
          a.message,
          a.detected_at,
          a.resolved_at
         FROM anomalies a
         JOIN gyms g ON g.id = a.gym_id
        WHERE ${where}
        ORDER BY
          CASE a.severity
            WHEN 'critical' THEN 1
            ELSE 2
          END,
          a.detected_at DESC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/anomalies/:id/dismiss
// Mark an anomaly as dismissed.  Refuses for critical-severity anomalies.
// ---------------------------------------------------------------------------
router.patch('/:id/dismiss', async (req, res, next) => {
  const anomalyId = req.params.id;
  if (!UUID_RE.test(anomalyId)) {
    return res.status(400).json({ error: 'Invalid anomaly id — must be a UUID' });
  }

  try {
    // Fetch the anomaly first so we can enforce the severity rule
    const { rows } = await pool.query(
      'SELECT id, severity, dismissed, resolved FROM anomalies WHERE id = $1',
      [anomalyId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Anomaly not found' });
    }

    const anomaly = rows[0];

    // Business rule: critical anomalies cannot be silently dismissed
    if (anomaly.severity === 'critical') {
      return res.status(403).json({
        error: 'Critical anomalies cannot be dismissed. Resolve the underlying issue first.',
      });
    }

    if (anomaly.dismissed) {
      return res.status(409).json({ error: 'Anomaly is already dismissed' });
    }

    await pool.query(
      'UPDATE anomalies SET dismissed = true WHERE id = $1',
      [anomalyId]
    );

    res.json({ id: anomalyId, dismissed: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
