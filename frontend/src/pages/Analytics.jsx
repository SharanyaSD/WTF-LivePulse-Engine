import React, { useState, useEffect } from 'react'
import { useStore } from '../store'
import GymSelector from '../components/GymSelector'
import SkeletonCard from '../components/SkeletonCard'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import styles from './Analytics.module.css'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const PLAN_COLORS = {
  monthly: '#00D4AA',
  quarterly: '#F59E0B',
  annual: '#8B5CF6',
}
const DONUT_COLORS = ['#00D4AA', '#F59E0B']

const CustomTooltipStyle = {
  background: '#1A1A2E',
  border: '1px solid #2D3748',
  color: '#E2E8F0',
  borderRadius: '8px',
  fontSize: '13px',
}

export default function Analytics() {
  const { selectedGymId } = useStore()
  const [data, setData] = useState(null)
  const [crossGym, setCrossGym] = useState([])
  const [dateRange, setDateRange] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!selectedGymId) return
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`/api/gyms/${selectedGymId}/analytics?dateRange=${dateRange}`).then(
        (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        }
      ),
      fetch('/api/analytics/cross-gym').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
    ])
      .then(([gymData, cgData]) => {
        setData(gymData)
        setCrossGym(cgData)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [selectedGymId, dateRange])

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <GymSelector />
        </div>
        <div className={styles.skeletonGrid}>
          <SkeletonCard height={260} />
          <SkeletonCard height={260} />
          <SkeletonCard height={260} />
          <SkeletonCard height={260} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>
          <span className={styles.errorIcon}>!</span>
          Error loading analytics: {error}
        </div>
      </div>
    )
  }

  if (!data) return null

  // Build heatmap matrix: [dayOfWeek][hourOfDay] = count
  const heatMatrix = {}
  ;(data.peak_hours || []).forEach((r) => {
    if (!heatMatrix[r.day_of_week]) heatMatrix[r.day_of_week] = {}
    heatMatrix[r.day_of_week][r.hour_of_day] = r.checkin_count
  })
  const maxCount = Math.max(
    ...Object.values(heatMatrix).flatMap((h) => Object.values(h)),
    1
  )

  const donutData = [
    { name: 'New', value: data.new_renewal_ratio?.new_count || 0 },
    { name: 'Renewal', value: data.new_renewal_ratio?.renewal_count || 0 },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <GymSelector />
        <div className={styles.dateFilters}>
          {['7d', '30d', '90d'].map((r) => (
            <button
              key={r}
              className={`${styles.filterBtn} ${dateRange === r ? styles.active : ''}`}
              onClick={() => setDateRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        {/* Peak Hours Heatmap */}
        <div className={`${styles.card} ${styles.heatmapCard}`}>
          <div className={styles.cardTitle}>7-Day Peak Hours Heatmap</div>
          <div className={styles.heatmapWrapper}>
            <div className={styles.heatmapGrid}>
              {/* Corner spacer */}
              <div className={styles.heatmapCorner} />
              {/* Hour labels */}
              {HOURS.map((h) => (
                <div key={h} className={styles.heatmapHour}>
                  {h}h
                </div>
              ))}
              {/* Day rows */}
              {DAYS.map((day, d) => (
                <React.Fragment key={day}>
                  <div className={styles.heatmapDay}>{day}</div>
                  {HOURS.map((h) => {
                    const count = heatMatrix[d]?.[h] || 0
                    const intensity = count / maxCount
                    return (
                      <div
                        key={`${d}-${h}`}
                        className={styles.heatCell}
                        title={`${day} ${h}:00 — ${count} check-ins`}
                        style={{
                          background: `rgba(0,212,170,${intensity * 0.85 + (intensity > 0 ? 0.08 : 0)})`,
                          border: '1px solid rgba(0,212,170,0.08)',
                        }}
                      />
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
            <div className={styles.heatLegend}>
              <span className={styles.legendLabel}>Low</span>
              <div className={styles.legendGradient} />
              <span className={styles.legendLabel}>High</span>
            </div>
          </div>
        </div>

        {/* Revenue by Plan */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            Revenue by Plan Type (Last {dateRange})
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.revenue_by_plan || []}>
              <XAxis dataKey="plan_type" stroke="#64748B" tick={{ fontSize: 12 }} />
              <YAxis
                stroke="#64748B"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={CustomTooltipStyle}
                formatter={(v) => [
                  `₹${Number(v).toLocaleString('en-IN')}`,
                  'Revenue',
                ]}
              />
              <Bar dataKey="total_revenue" radius={[4, 4, 0, 0]}>
                {(data.revenue_by_plan || []).map((entry, i) => (
                  <Cell
                    key={i}
                    fill={PLAN_COLORS[entry.plan_type] || '#00D4AA'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* New vs Renewal Donut */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>New vs Renewal (Last 30d)</div>
          <div style={{ padding: '12px 0 8px' }}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={85}
                  dataKey="value"
                  label={({ name, percent }) =>
                    percent > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                  }
                  labelLine={false}
                >
                  {DONUT_COLORS.map((c, i) => (
                    <Cell key={i} fill={c} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CustomTooltipStyle}
                  formatter={(v, name) => [v, name]}
                />
                <Legend
                  wrapperStyle={{ paddingTop: '20px' }}
                  formatter={(value) => (
                    <span style={{ color: '#E2E8F0', fontSize: 12 }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Churn Risk */}
        <div className={`${styles.card} ${styles.churnCard}`}>
          <div className={styles.cardTitle}>Churn Risk Members</div>
          {!data.churn_risk_members || data.churn_risk_members.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>✓</span>
              No at-risk members detected
            </div>
          ) : (
            <div className={styles.churnTable}>
              <div className={styles.churnHeader}>
                <span>Member</span>
                <span>Last Check-in</span>
                <span>Risk Level</span>
              </div>
              {data.churn_risk_members.map((m, i) => (
                <div key={i} className={styles.churnRow}>
                  <span className={styles.churnName}>{m.name}</span>
                  <span className={styles.churnDate}>
                    {m.last_checkin_at
                      ? new Date(m.last_checkin_at).toLocaleDateString('en-IN')
                      : 'Never'}
                  </span>
                  <span
                    className={`${styles.riskBadge} ${
                      m.risk_level === 'CRITICAL'
                        ? styles.riskCritical
                        : styles.riskHigh
                    }`}
                  >
                    {m.risk_level}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cross-Gym Revenue Comparison */}
        <div className={`${styles.card} ${styles.crossGymCard}`}>
          <div className={styles.cardTitle}>Cross-Gym Revenue (Last 30d)</div>
          <div style={{ padding: '12px 0 4px' }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={crossGym} layout="vertical">
              <XAxis
                type="number"
                stroke="#64748B"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                type="category"
                dataKey="gym_name"
                stroke="#64748B"
                width={150}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={CustomTooltipStyle}
                formatter={(v) => [
                  `₹${Number(v).toLocaleString('en-IN')}`,
                  'Revenue',
                ]}
              />
              <Bar dataKey="total_revenue" fill="#00D4AA" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
