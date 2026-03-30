import { useEffect, useState } from 'react'
import { useStore } from '../store'
import styles from './Anomalies.module.css'

const TYPE_LABELS = {
  zero_checkins: 'Zero Check-ins',
  capacity_breach: 'Capacity Breach',
  revenue_drop: 'Revenue Drop',
}

const TYPE_ICONS = {
  zero_checkins: '🚫',
  capacity_breach: '🔴',
  revenue_drop: '📉',
}

export default function Anomalies() {
  const { anomalies, setAnomalies, gyms } = useStore()
  const [filterGym, setFilterGym] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/anomalies')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setAnomalies(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleDismiss = async (id) => {
    if (!window.confirm('Dismiss this anomaly?')) return
    try {
      const res = await fetch(`/api/anomalies/${id}/dismiss`, { method: 'PATCH' })
      if (res.status === 403) {
        alert('Cannot dismiss critical anomalies — they require investigation.')
        return
      }
      if (res.ok) {
        setAnomalies(anomalies.map((a) => (a.id === id ? { ...a, dismissed: true } : a)))
      }
    } catch (e) {
      console.error('Dismiss error:', e)
    }
  }

  const filtered = anomalies
    .filter((a) => !filterGym || a.gym_id === filterGym)
    .filter((a) => !filterSeverity || a.severity === filterSeverity)
    .sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at))

  const activeCount = anomalies.filter((a) => !a.resolved && !a.dismissed).length
  const resolvedCount = anomalies.filter((a) => a.resolved).length

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.titleGroup}>
          <h2 className={styles.pageTitle}>Anomaly Detection Log</h2>
          <div className={styles.summary}>
            <span className={styles.summaryItem}>
              <span className={styles.activeDot} />
              {activeCount} active
            </span>
            <span className={styles.summarySep}>·</span>
            <span className={styles.summaryItem}>
              <span className={styles.resolvedDot} />
              {resolvedCount} resolved
            </span>
          </div>
        </div>

        <div className={styles.filters}>
          <select
            className={styles.filterSelect}
            value={filterGym}
            onChange={(e) => setFilterGym(e.target.value)}
          >
            <option value="">All Gyms</option>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            className={styles.filterSelect}
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
          >
            <option value="">All Severities</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.loadingDot} />
          Loading anomalies...
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>✓</div>
              <div className={styles.emptyTitle}>No anomalies detected</div>
              <div className={styles.emptyText}>
                {filterGym || filterSeverity
                  ? 'No anomalies match the current filters.'
                  : 'System is healthy. Start the simulator to generate live data.'}
              </div>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Gym</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Detected</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    className={a.resolved || a.dismissed ? styles.dimRow : ''}
                  >
                    <td className={styles.gymCell}>
                      {a.gym_name ||
                        gyms.find((g) => g.id === a.gym_id)?.name ||
                        a.gym_id}
                    </td>
                    <td>
                      <span className={styles.typeLabel}>
                        <span className={styles.typeIcon}>
                          {TYPE_ICONS[a.type] || '⚠'}
                        </span>
                        {TYPE_LABELS[a.type] || a.type}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`${styles.severityBadge} ${
                          a.severity === 'critical'
                            ? styles.severityCritical
                            : styles.severityWarning
                        }`}
                      >
                        {a.severity?.toUpperCase()}
                      </span>
                    </td>
                    <td className={styles.timeCell}>
                      {a.detected_at
                        ? new Date(a.detected_at).toLocaleString('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${
                          a.resolved
                            ? styles.statusResolved
                            : a.dismissed
                            ? styles.statusDismissed
                            : styles.statusActive
                        }`}
                      >
                        {a.resolved ? 'RESOLVED' : a.dismissed ? 'DISMISSED' : 'ACTIVE'}
                      </span>
                    </td>
                    <td>
                      {!a.resolved && !a.dismissed && a.severity !== 'critical' && (
                        <button
                          className={styles.dismissBtn}
                          onClick={() => handleDismiss(a.id)}
                        >
                          Dismiss
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
