import { useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useGymData } from './hooks/useGymData'
import NavBar from './components/NavBar'
import Dashboard from './pages/Dashboard'
import Analytics from './pages/Analytics'
import Anomalies from './pages/Anomalies'
import styles from './App.module.css'

export default function App() {
  useWebSocket()
  useGymData()
  const [activePage, setActivePage] = useState('dashboard')

  return (
    <div className={styles.app}>
      <NavBar activePage={activePage} onNavigate={setActivePage} />
      <main className={styles.main}>
        {activePage === 'dashboard' && <Dashboard />}
        {activePage === 'analytics' && <Analytics />}
        {activePage === 'anomalies' && <Anomalies />}
      </main>
    </div>
  )
}
