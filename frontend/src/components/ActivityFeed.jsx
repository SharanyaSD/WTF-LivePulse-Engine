import { useStore } from '../store'
import styles from './ActivityFeed.module.css'

const EVENT_ICONS = { checkin: '→', checkout: '←', payment: '₹' }
const EVENT_COLORS = { checkin: '#22C55E', checkout: '#64748B', payment: '#00D4AA' }
const EVENT_LABELS = { checkin: 'Check In', checkout: 'Check Out', payment: 'Payment' }

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return '--:--:--'
  }
}

export default function ActivityFeed() {
  const { activityFeed } = useStore()

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>Live Activity Feed</span>
        <span className={styles.count}>{activityFeed.length} events</span>
      </div>
      <div className={styles.feed}>
        {activityFeed.length === 0 ? (
          <div className={styles.empty}>
            No events yet. Start the simulator to see activity.
          </div>
        ) : (
          activityFeed.map((evt, i) => (
            <div key={i} className={styles.item}>
              <span
                className={styles.icon}
                style={{ color: EVENT_COLORS[evt.eventType] }}
              >
                {EVENT_ICONS[evt.eventType]}
              </span>
              <div className={styles.details}>
                <span
                  className={styles.eventType}
                  style={{ color: EVENT_COLORS[evt.eventType] }}
                >
                  {EVENT_LABELS[evt.eventType]}
                </span>
                <span className={styles.memberName}>{evt.member_name}</span>
                {evt.gym_name && (
                  <span className={styles.gymName}>{evt.gym_name}</span>
                )}
              </div>
              <span className={styles.time}>{formatTime(evt.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
