import { useEffect, useRef } from 'react'
import { useStore } from '../store'

export function useWebSocket() {
  const {
    addActivity,
    updateLiveOccupancy,
    updateLiveRevenue,
    addAnomaly,
    resolveAnomaly,
    incrementAnomalyCount,
    setWsConnected,
  } = useStore()

  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const reconnectDelay = useRef(1000)

  const handleEvent = (event) => {
    switch (event.type) {
      case 'CHECKIN_EVENT':
        updateLiveOccupancy(event.gym_id, event.current_occupancy, event.capacity_pct)
        addActivity({ ...event, eventType: 'checkin' })
        break
      case 'CHECKOUT_EVENT':
        updateLiveOccupancy(event.gym_id, event.current_occupancy, event.capacity_pct)
        addActivity({ ...event, eventType: 'checkout' })
        break
      case 'PAYMENT_EVENT':
        updateLiveRevenue(event.gym_id, event.today_total)
        addActivity({ ...event, eventType: 'payment' })
        break
      case 'ANOMALY_DETECTED':
        addAnomaly({
          id: event.anomaly_id,
          gym_id: event.gym_id,
          gym_name: event.gym_name,
          type: event.anomaly_type,
          severity: event.severity,
          message: event.message,
          detected_at: new Date().toISOString(),
          resolved: false,
        })
        incrementAnomalyCount()
        break
      case 'ANOMALY_RESOLVED':
        resolveAnomaly(event.anomaly_id, event.resolved_at)
        break
      default:
        break
    }
  }

  const connect = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      setWsConnected(true)
      reconnectDelay.current = 1000
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }

    ws.onclose = () => {
      setWsConnected(false)
      const delay = Math.min(reconnectDelay.current, 30000)
      reconnectDelay.current = delay * 2
      reconnectTimer.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data)
        handleEvent(event)
      } catch (e) {
        // Ignore malformed messages
      }
    }
  }

  useEffect(() => {
    connect()
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
    }
  }, [])

  const connected = useStore((s) => s.wsConnected)
  return { connected }
}
