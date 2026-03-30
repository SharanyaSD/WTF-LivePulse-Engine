import { useStore } from '../store'
import styles from './NavBar.module.css'

export default function NavBar({ activePage, onNavigate }) {
  const { wsConnected, unreadAnomalyCount, clearAnomalyCount, gyms, liveData, anomalies } =
    useStore()

  const totalOccupancy = gyms.reduce(
    (sum, g) => sum + (liveData[g.id]?.occupancy ?? g.current_occupancy ?? 0),
    0
  )
  const totalRevenue = gyms.reduce(
    (sum, g) =>
      sum + parseFloat(liveData[g.id]?.today_revenue ?? g.today_revenue ?? 0),
    0
  )
  const activeAnomalyCount = anomalies.filter((a) => !a.resolved).length

  const pages = ['dashboard', 'analytics', 'anomalies']

  return (
    <nav className={styles.nav}>
      <div className={styles.left}>
        <span className={styles.logo}>⚡ WTF LivePulse</span>
        <div className={styles.summary}>
          <span className={styles.stat}>
            <span className={styles.statValue}>{totalOccupancy}</span> live
          </span>
          <span className={styles.divider}>|</span>
          <span className={styles.stat}>
            <span className={styles.statValue}>
              ₹{totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>{' '}
            today
          </span>
          <span className={styles.divider}>|</span>
          <span className={styles.stat}>
            <span className={styles.statValue} style={{ color: activeAnomalyCount > 0 ? '#EF4444' : '#22C55E' }}>
              {activeAnomalyCount}
            </span>{' '}
            alerts
          </span>
        </div>
      </div>

      <div className={styles.center}>
        {pages.map((page) => (
          <button
            key={page}
            onClick={() => {
              onNavigate(page)
              if (page === 'anomalies') clearAnomalyCount()
            }}
            className={`${styles.navBtn} ${activePage === page ? styles.active : ''}`}
          >
            {page.charAt(0).toUpperCase() + page.slice(1)}
            {page === 'anomalies' && unreadAnomalyCount > 0 && (
              <span className={styles.badge}>{unreadAnomalyCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.right}>
        <span
          className={`${styles.liveIndicator} ${wsConnected ? styles.connected : styles.disconnected}`}
          title={wsConnected ? 'Connected — live data streaming' : 'Disconnected — attempting reconnect'}
        />
        <span className={`${styles.liveLabel} ${wsConnected ? styles.connectedLabel : styles.disconnectedLabel}`}>
          {wsConnected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
    </nav>
  )
}
