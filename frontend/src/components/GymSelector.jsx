import { useStore } from '../store'
import styles from './GymSelector.module.css'

export default function GymSelector() {
  const { gyms, selectedGymId, selectGym } = useStore()

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor="gym-select">
        Gym Location
      </label>
      <select
        id="gym-select"
        className={styles.select}
        value={selectedGymId || ''}
        onChange={(e) => selectGym(e.target.value)}
      >
        {gyms.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} — {g.city}
          </option>
        ))}
      </select>
    </div>
  )
}
