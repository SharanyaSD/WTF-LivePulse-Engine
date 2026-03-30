import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function useGymData() {
  const { selectedGymId, setGyms, setGymLiveData, setAnomalies } = useStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/gyms').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
      fetch('/api/anomalies').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
    ])
      .then(([gyms, anomalies]) => {
        setGyms(gyms)
        gyms.forEach((g) =>
          setGymLiveData(g.id, {
            occupancy: g.current_occupancy,
            today_revenue: g.today_revenue,
          })
        )
        setAnomalies(anomalies)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedGymId) return
    fetch(`/api/gyms/${selectedGymId}/live`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setGymLiveData(selectedGymId, {
          occupancy: data.occupancy,
          occupancy_pct: data.occupancy_pct,
          today_revenue: data.today_revenue,
          recent_events: data.recent_events,
          active_anomalies: data.active_anomalies,
        })
      })
      .catch(() => {
        // Non-fatal: live data will populate via WebSocket
      })
  }, [selectedGymId])

  return { loading, error }
}
