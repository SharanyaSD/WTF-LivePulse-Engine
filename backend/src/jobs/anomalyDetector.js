'use strict';

const pool = require('../db/pool');
const {
  detectZeroCheckins,
  detectCapacityBreach,
  detectRevenueDrop,
  resolveAnomaly,
} = require('../services/anomalyService');
const { broadcast } = require('../websocket');
const { refreshMaterializedView } = require('../services/statsService');

// How often the detector runs (ms).  Default 30 s.
const INTERVAL_MS = Number(process.env.ANOMALY_DETECTOR_INTERVAL_MS ?? 30_000);

// Auto-archive resolved anomalies older than 24 hours
const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;

let detectorIntervalId = null;

// ---------------------------------------------------------------------------
// _runDetection
// Core detection cycle.  Fetches all active gyms, runs every detector in
// parallel, then broadcasts results.
// ---------------------------------------------------------------------------
async function _runDetection() {
  try {
    const { rows: gyms } = await pool.query(
      `SELECT id, name, city, capacity, status FROM gyms WHERE status = 'active'`
    );

    if (gyms.length === 0) return;

    // Run all detectors concurrently
    const [zeroCheckinAnomalies, capacityAnomalies, revenueAnomalies] =
      await Promise.all([
        detectZeroCheckins(gyms),
        detectCapacityBreach(gyms),
        detectRevenueDrop(gyms),
      ]);

    const allNew = [...zeroCheckinAnomalies, ...capacityAnomalies, ...revenueAnomalies];

    for (const anomaly of allNew) {
      broadcast({
        type: 'ANOMALY_DETECTED',
        timestamp: new Date().toISOString(),
        anomaly: {
          id: anomaly.id,
          gym_id: anomaly.gym_id,
          type: anomaly.type,
          severity: anomaly.severity,
          message: anomaly.message,
          created_at: anomaly.created_at,
        },
      });
    }

    if (allNew.length > 0) {
      console.info(`[anomaly-detector] ${allNew.length} new anomaly(ies) detected`);
    }

    // Auto-resolve: check if any previously open anomalies should now be closed
    await _autoResolveStaleAnomalies(gyms);

    // Archive resolved anomalies older than 24 hours
    await _archiveOldResolvedAnomalies();

    // Refresh materialized view for peak-hours heatmap
    try {
      await refreshMaterializedView();
    } catch (err) {
      console.warn('[anomaly-detector] materialized view refresh error:', err.message);
    }
  } catch (err) {
    console.error('[anomaly-detector] detection error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// _autoResolveStaleAnomalies
// For each gym, check open anomalies and resolve those whose condition no
// longer holds.
// ---------------------------------------------------------------------------
async function _autoResolveStaleAnomalies(gyms) {
  for (const gym of gyms) {
    try {
      // --- zero_checkins ---
      const { rows: recentCheckins } = await pool.query(
        `SELECT id FROM checkins
          WHERE gym_id = $1 AND checked_in > NOW() - INTERVAL '2 hours'
          LIMIT 1`,
        [gym.id]
      );

      if (recentCheckins.length > 0) {
        const { rows: openZero } = await pool.query(
          `SELECT id FROM anomalies
            WHERE gym_id = $1 AND type = 'zero_checkins' AND resolved = false`,
          [gym.id]
        );
        for (const a of openZero) {
          const resolved = await resolveAnomaly(a.id);
          if (resolved) {
            broadcast({ type: 'ANOMALY_RESOLVED', timestamp: new Date().toISOString(), anomaly: resolved });
          }
        }
      }

      // --- capacity_breach ---
      const { rows: occRow } = await pool.query(
        `SELECT COUNT(*)::int AS occupancy FROM checkins WHERE gym_id = $1 AND checked_out IS NULL`,
        [gym.id]
      );
      const occupancy = occRow[0].occupancy;
      const pct = gym.capacity > 0 ? occupancy / gym.capacity : 0;

      if (pct < 0.85) {
        const { rows: openCap } = await pool.query(
          `SELECT id FROM anomalies
            WHERE gym_id = $1 AND type = 'capacity_breach' AND resolved = false`,
          [gym.id]
        );
        for (const a of openCap) {
          const resolved = await resolveAnomaly(a.id);
          if (resolved) {
            broadcast({ type: 'ANOMALY_RESOLVED', timestamp: new Date().toISOString(), anomaly: resolved });
          }
        }
      }

      // --- revenue_drop ---
      const { rows: revRows } = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN paid_at >= CURRENT_DATE THEN amount END), 0)::numeric AS today_rev,
            COALESCE(SUM(CASE WHEN paid_at::date = CURRENT_DATE - INTERVAL '7 days' THEN amount END), 0)::numeric AS last_week_rev
           FROM payments
          WHERE gym_id = $1
            AND paid_at >= CURRENT_DATE - INTERVAL '7 days'`,
        [gym.id]
      );
      const todayRev    = Number(revRows[0].today_rev);
      const lastWeekRev = Number(revRows[0].last_week_rev);

      if (lastWeekRev === 0 || todayRev >= lastWeekRev * 0.8) {
        const { rows: openRev } = await pool.query(
          `SELECT id FROM anomalies
            WHERE gym_id = $1 AND type = 'revenue_drop' AND resolved = false`,
          [gym.id]
        );
        for (const a of openRev) {
          const resolved = await resolveAnomaly(a.id);
          if (resolved) {
            broadcast({ type: 'ANOMALY_RESOLVED', timestamp: new Date().toISOString(), anomaly: resolved });
          }
        }
      }
    } catch (err) {
      console.warn(`[anomaly-detector] auto-resolve error for gym ${gym.id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// _archiveOldResolvedAnomalies
// Delete (or mark archived) anomalies that were resolved >24 hours ago.
// ---------------------------------------------------------------------------
async function _archiveOldResolvedAnomalies() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM anomalies
        WHERE resolved = true
          AND resolved_at < NOW() - INTERVAL '24 hours'`
    );

    if (rowCount > 0) {
      console.info(`[anomaly-detector] archived ${rowCount} old resolved anomaly(ies)`);
    }
  } catch (err) {
    console.warn('[anomaly-detector] archive error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// startAnomalyDetector
// Starts the background interval.  Safe to call multiple times — won't
// create duplicate intervals.
// ---------------------------------------------------------------------------
function startAnomalyDetector() {
  if (detectorIntervalId) {
    console.warn('[anomaly-detector] already running, ignoring duplicate start');
    return;
  }

  // Run once immediately, then on schedule
  _runDetection().catch((err) =>
    console.error('[anomaly-detector] initial run error:', err.message)
  );

  detectorIntervalId = setInterval(_runDetection, INTERVAL_MS);
  console.info(`[anomaly-detector] started, interval=${INTERVAL_MS} ms`);
}

// ---------------------------------------------------------------------------
// stopAnomalyDetector
// ---------------------------------------------------------------------------
function stopAnomalyDetector() {
  if (detectorIntervalId) {
    clearInterval(detectorIntervalId);
    detectorIntervalId = null;
    console.info('[anomaly-detector] stopped');
  }
}

module.exports = { startAnomalyDetector, stopAnomalyDetector };
