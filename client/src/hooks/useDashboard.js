import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/yamsShared'

export default function useDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(Date.now())

  async function fetchMetrics() {
    try {
      const metrics = await apiFetch('/metrics')
      setData({
        metrics: {
          totalServers: metrics.servers.total,
          runningServers: metrics.servers.running,
          activeClients: metrics.clients.active,
          pendingClients: metrics.clients.pending,
          droppedMessages: metrics.backpressure.droppedMessages,
        },
        servers: (metrics.servers.list || []).map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
          port: s.port,
          clients: s.clients || 0,
          maxClients: 50,
          uptime: s.uptime || 0,
        })),
        systemUptime: metrics.uptime || 0,
        systemHealth: 0.95,
        logs: (metrics.recentLogs || []).map((l, i) => ({
          id: l.id || i,
          ts: l.timestamp || Date.now(),
          msg: l.serverName ? `[${l.serverName}] ${l.data || ''}` : (l.data || ''),
        })),
      })
      setLastUpdated(Date.now())
      setError(null)
    } catch {
      setError('Connection lost — retrying…')
    }
  }

  useEffect(() => {
    fetchMetrics()
    const id = setInterval(fetchMetrics, 3000)
    return () => clearInterval(id)
  }, [])

  const defaultData = {
    metrics: { totalServers: 0, runningServers: 0, activeClients: 0, pendingClients: 0, droppedMessages: 0 },
    servers: [],
    systemUptime: 0,
    systemHealth: 1,
    logs: [],
  }

  return { data: data || defaultData, error, lastUpdated }
}
