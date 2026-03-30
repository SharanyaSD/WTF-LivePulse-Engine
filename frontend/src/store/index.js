import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // Gyms
  gyms: [],
  selectedGymId: null,
  setGyms: (gyms) => set({ gyms, selectedGymId: gyms[0]?.id || null }),
  selectGym: (id) => set({ selectedGymId: id }),

  // Live data per gym: { [gymId]: { occupancy, occupancy_pct, today_revenue, ... } }
  liveData: {},
  updateLiveOccupancy: (gymId, occupancy, occupancy_pct) =>
    set((s) => ({
      liveData: {
        ...s.liveData,
        [gymId]: { ...s.liveData[gymId], occupancy, occupancy_pct },
      },
    })),
  updateLiveRevenue: (gymId, today_revenue) =>
    set((s) => ({
      liveData: {
        ...s.liveData,
        [gymId]: { ...s.liveData[gymId], today_revenue },
      },
    })),
  setGymLiveData: (gymId, data) =>
    set((s) => ({
      liveData: {
        ...s.liveData,
        [gymId]: { ...s.liveData[gymId], ...data },
      },
    })),

  // Activity feed (last 20 events across all gyms)
  activityFeed: [],
  addActivity: (event) =>
    set((s) => ({
      activityFeed: [event, ...s.activityFeed].slice(0, 20),
    })),

  // Anomalies
  anomalies: [],
  setAnomalies: (anomalies) => set({ anomalies }),
  addAnomaly: (anomaly) =>
    set((s) => ({ anomalies: [anomaly, ...s.anomalies] })),
  resolveAnomaly: (anomalyId, resolved_at) =>
    set((s) => ({
      anomalies: s.anomalies.map((a) =>
        a.id === anomalyId ? { ...a, resolved: true, resolved_at } : a
      ),
    })),
  unreadAnomalyCount: 0,
  incrementAnomalyCount: () =>
    set((s) => ({ unreadAnomalyCount: s.unreadAnomalyCount + 1 })),
  clearAnomalyCount: () => set({ unreadAnomalyCount: 0 }),

  // WebSocket status
  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),

  // Simulator state
  simulatorRunning: false,
  simulatorSpeed: 1,
  setSimulatorState: (running, speed) =>
    set({ simulatorRunning: running, simulatorSpeed: speed }),

  // Summary bar (all gyms aggregate)
  totalOccupancy: 0,
  totalRevenue: 0,
  activeAnomalyCount: 0,
  updateSummary: (totalOccupancy, totalRevenue, activeAnomalyCount) =>
    set({ totalOccupancy, totalRevenue, activeAnomalyCount }),
}))
