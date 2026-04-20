import { useState, useEffect, useReducer, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Console from '../components/Console'
import CommandInput from '../components/CommandInput'
import StatusBar from '../components/StatusBar'
import Toast from '../components/Toast'
import useWebSocket from '../hooks/useWebSocket'

function toastReducer(state, action) {
  switch (action.type) {
    case 'ADD': return [...state, { ...action.payload, id: Date.now() }]
    case 'REMOVE': return state.filter(t => t.id !== action.payload)
    default: return state
  }
}

export default function ConsolePage() {
  const { id: urlServerId } = useParams()
  const navigate = useNavigate()

  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [toasts, dispatchToast] = useReducer(toastReducer, [])

  const { connected, subscribe, unsubscribe, sendCommand, logs, serverStatus } = useWebSocket()

  // Fetch server list for the sidebar
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const res = await fetch('/api/servers')
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
    const interval = setInterval(fetchServers, 30000)
    return () => clearInterval(interval)
  }, [])

  // Subscribe/unsubscribe when the URL server id changes
  useEffect(() => {
    if (!urlServerId) return
    subscribe(urlServerId)
    return () => unsubscribe(urlServerId)
  }, [urlServerId, subscribe, unsubscribe])

  // Sidebar server selection → push new route
  const handleSelectServer = useCallback((serverId) => {
    navigate(`/console/${serverId}`)
  }, [navigate])

  const handleSendCommand = useCallback((command) => {
    if (!urlServerId || !connected) {
      dispatchToast({ type: 'ADD', payload: { type: 'warning', message: 'Not connected to server' } })
      return
    }
    sendCommand(urlServerId, command)
  }, [urlServerId, connected, sendCommand])

  // Auto-dismiss toasts
  useEffect(() => {
    toasts.forEach(toast => {
      if (toast.duration !== false) {
        const t = setTimeout(
          () => dispatchToast({ type: 'REMOVE', payload: toast.id }),
          toast.duration || 4000
        )
        return () => clearTimeout(t)
      }
    })
  }, [toasts])

  const selectedServer = servers.find(s => s.id === urlServerId)

  // No id in URL — user hit /console directly
  if (!urlServerId) {
    return (
      <div className="flex h-full">
        <Sidebar servers={servers} selectedServerId={null} onSelectServer={handleSelectServer} loading={loading} />
        <div className="flex-1 flex items-center justify-center text-gray-500 bg-gray-900 border-l border-gray-800">
          <p>Select a server to view its console</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <StatusBar
        server={selectedServer}
        status={urlServerId ? serverStatus[urlServerId] : 'disconnected'}
        wsConnected={connected}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          servers={servers}
          selectedServerId={urlServerId}
          onSelectServer={handleSelectServer}
          loading={loading}
        />

        <div className="flex-1 flex flex-col bg-gray-900 border-l border-gray-800">
          <Console logs={logs[urlServerId] || []} />
          <CommandInput onSubmit={handleSendCommand} disabled={!connected} />
        </div>
      </div>

      <div className="fixed top-16 right-4 z-50 space-y-2">
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
