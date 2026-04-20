import { useState, useEffect, useReducer, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Console from '../components/Console'
import CommandInput from '../components/CommandInput'
import StatusBar from '../components/StatusBar'
import Toast from '../components/Toast'
import useWebSocket from '../hooks/useWebSocket'
import { C } from '../styles/tokens'

function toastReducer(state, action) {
  switch (action.type) {
    case 'ADD':    return [...state, { ...action.payload, id: Date.now() }]
    case 'REMOVE': return state.filter(t => t.id !== action.payload)
    default:       return state
  }
}

export default function ConsolePage() {
  const { id: urlServerId } = useParams()
  const navigate = useNavigate()

  const [servers, setServers]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [toasts, dispatchToast]     = useReducer(toastReducer, [])

  const { isConnected, subscribe, unsubscribe, sendCommand, logs, serverStatus } = useWebSocket()

  // Fetch server list for sidebar
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const res  = await fetch('/api/servers')
        if (!res.ok) throw new Error('Failed to fetch servers')
        const data = await res.json()
        setServers(data.data || data)
      } catch (err) {
        dispatchToast({ type: 'ADD', payload: { type: 'error', message: err.message } })
      } finally {
        setLoading(false)
      }
    }
    fetchServers()
    const id = setInterval(fetchServers, 30000)
    return () => clearInterval(id)
  }, [])

  // Subscribe/unsubscribe on route change
  useEffect(() => {
    if (!urlServerId) return
    subscribe(urlServerId)
    return () => unsubscribe(urlServerId)
  }, [urlServerId, subscribe, unsubscribe])

  // Auto-dismiss toasts
  useEffect(() => {
    toasts.forEach(toast => {
      if (toast.duration !== false) {
        const t = setTimeout(
          () => dispatchToast({ type: 'REMOVE', payload: toast.id }),
          toast.duration || 4000,
        )
        return () => clearTimeout(t)
      }
    })
  }, [toasts])

  const handleSelectServer = useCallback((id) => navigate(`/console/${id}`), [navigate])

  const handleSendCommand = useCallback((command) => {
    if (!urlServerId || !isConnected) {
      dispatchToast({ type: 'ADD', payload: { type: 'warning', message: 'Not connected to server' } })
      return
    }
    sendCommand(urlServerId, command)
  }, [urlServerId, isConnected, sendCommand])

  const selectedServer = servers.find(s => s.id === urlServerId)
  const currentStatus  = urlServerId ? serverStatus[urlServerId] : undefined

  // No id → show empty state
  if (!urlServerId) {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <Sidebar
          servers={servers}
          selectedServerId={null}
          onSelectServer={handleSelectServer}
          loading={loading}
        />
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: C.bg, borderLeft: `1px solid ${C.border}`,
          color: C.dim, fontSize: 13,
        }}>
          Select a server to view its console
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <StatusBar
        server={selectedServer}
        status={currentStatus}
        wsConnected={isConnected}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          servers={servers}
          selectedServerId={urlServerId}
          onSelectServer={handleSelectServer}
          loading={loading}
        />

        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          background: C.bg, borderLeft: `1px solid ${C.border}`,
        }}>
          <Console logs={logs[urlServerId] || []} serverId={urlServerId} />
          <CommandInput onSubmit={handleSendCommand} disabled={!isConnected} />
        </div>
      </div>

      {/* Toasts */}
      <div style={{
        position: 'fixed', top: 64, right: 16, zIndex: 50,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            type={toast.type}
            message={toast.message}
            onClose={() => dispatchToast({ type: 'REMOVE', payload: toast.id })}
          />
        ))}
      </div>
    </div>
  )
}
