import styles from './SkeletonCard.module.css'

export default function SkeletonCard({ height = 120 }) {
  return <div className={styles.skeleton} style={{ height }} />
}
