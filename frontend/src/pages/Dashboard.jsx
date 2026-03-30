import { useStore } from '../store'
import GymSelector from '../components/GymSelector'
import OccupancyCard from '../components/OccupancyCard'
import RevenueCard from '../components/RevenueCard'
import ActivityFeed from '../components/ActivityFeed'
import SimulatorPanel from '../components/SimulatorPanel'
import SkeletonCard from '../components/SkeletonCard'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const { gyms, selectedGymId, anomalies } = useStore()
  const gym = gyms.find((g) => g.id === selectedGymId)
  const activeAnomalies = anomalies.filter(
    (a) => !a.resolved && a.gym_id === selectedGymId
  )

  if (!gym) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.skeletonRow}>
          <SkeletonCard height={100} />
          <SkeletonCard height={100} />
          <SkeletonCard height={100} />
        </div>
        <div className={styles.skeletonRow}>
          <SkeletonCard height={300} />
          <SkeletonCard height={300} />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <GymSelector />
        <h1 className={styles.pageTitle}>{gym.name} — Live Operations</h1>
      </div>

      <div className={styles.grid}>
        <div className={styles.leftCol}>
          <div className={styles.kpiRow}>
            <OccupancyCard gymId={selectedGymId} capacity={gym.capacity} />
            <RevenueCard gymId={selectedGymId} />
            <div className={styles.anomalyCount}>
              <div className={styles.acTitle}>Active Alerts</div>
              <div
                className={styles.acValue}
                style={{ color: activeAnomalies.length > 0 ? '#EF4444' : '#22C55E' }}
              >
                {activeAnomalies.length}
              </div>
              <div className={styles.acSub}>this gym</div>
            </div>
          </div>
          <SimulatorPanel />
        </div>

        <div className={styles.rightCol}>
          <ActivityFeed />
        </div>
      </div>
    </div>
  )
}
