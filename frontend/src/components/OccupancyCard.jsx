import { useStore } from '../store'
import styles from './OccupancyCard.module.css'

export default function OccupancyCard({ gymId, capacity }) {
  const { liveData, wsConnected } = useStore()
  const live = liveData[gymId] || {}
  const occupancy = live.occupancy ?? 0
  const pct =
    live.occupancy_pct ??
    (capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0)

  const color = pct > 85 ? '#EF4444' : pct >= 60 ? '#F59E0B' : '#22C55E'

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>Live Occupancy</span>
        {wsConnected && <span className={styles.liveDot} title="Live data" />}
      </div>
      <div className={styles.value} style={{ color }}>
        {occupancy}
      </div>
      <div className={styles.sub}>of {capacity} capacity</div>
      <div className={styles.barBg}>
        <div
          className={styles.barFill}
          style={{
            width: `${Math.min(pct, 100)}%`,
            background: color,
          }}
        />
      </div>
      <div className={styles.pct} style={{ color }}>
        {pct}%
      </div>
    </div>
  )
}
