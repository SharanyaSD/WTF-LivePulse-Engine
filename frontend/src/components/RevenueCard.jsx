import { useStore } from '../store'
import styles from './RevenueCard.module.css'

export default function RevenueCard({ gymId }) {
  const { liveData } = useStore()
  const revenue = parseFloat(liveData[gymId]?.today_revenue ?? 0)

  return (
    <div className={styles.card}>
      <div className={styles.title}>Today's Revenue</div>
      <div className={styles.value}>
        <span className={styles.currency}>₹</span>
        {revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
      <div className={styles.sub}>membership revenue</div>
    </div>
  )
}
