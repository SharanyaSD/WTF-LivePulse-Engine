import { useState } from 'react'
import { useStore } from '../store'
import styles from './SimulatorPanel.module.css'

export default function SimulatorPanel() {
  const { simulatorRunning, simulatorSpeed, setSimulatorState } = useStore()
  const [loading, setLoading] = useState(false)
  const [speed, setSpeed] = useState(1)

  const callApi = async (action, body = {}) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/simulator/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (action === 'start') setSimulatorState(true, data.speed ?? speed)
      if (action === 'stop') setSimulatorState(false, simulatorSpeed)
      if (action === 'reset') setSimulatorState(false, 1)
    } catch (e) {
      console.error('Simulator API error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSpeedChange = (s) => {
    setSpeed(s)
    if (simulatorRunning) {
      callApi('start', { speed: s })
    }
  }

  const handleReset = () => {
    if (window.confirm('Reset all live data to baseline?')) {
      callApi('reset')
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.titleRow}>
        <span className={styles.title}>Simulation Engine</span>
        <div className={styles.statusRow}>
          <span
            className={`${styles.dot} ${simulatorRunning ? styles.runningDot : styles.stoppedDot}`}
          />
          <span className={styles.statusText}>
            {simulatorRunning ? `Running at ${simulatorSpeed}x speed` : 'Paused'}
          </span>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={`${styles.btn} ${simulatorRunning ? styles.pauseBtn : styles.startBtn}`}
          disabled={loading}
          onClick={() =>
            simulatorRunning ? callApi('stop') : callApi('start', { speed })
          }
        >
          {loading ? (
            <span className={styles.spinner}>●</span>
          ) : simulatorRunning ? (
            '⏸ Pause'
          ) : (
            '▶ Start'
          )}
        </button>

        <div className={styles.speedGroup}>
          <span className={styles.speedLabel}>Speed</span>
          {[1, 5, 10].map((s) => (
            <button
              key={s}
              className={`${styles.speedBtn} ${speed === s ? styles.activeSpeed : ''}`}
              onClick={() => handleSpeedChange(s)}
              disabled={loading}
            >
              {s}x
            </button>
          ))}
        </div>

        <button
          className={styles.resetBtn}
          disabled={loading}
          onClick={handleReset}
        >
          ↺ Reset
        </button>
      </div>
    </div>
  )
}
