import { useState, useEffect, useReducer, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Console from './components/Console'
import CommandInput from './components/CommandInput'
import StatusBar from './components/StatusBar'
import Toast from './components/Toast'
import useWebSocket from './hooks/useWebSocket'

// Toast reducer
function toastReducer(state, action) {
  switch (action.type) {
    case 'ADD':
      return [...state, { ...action.payload, id: Date.now() }]
    case 'REMOVE':
      return state.filter(t => t.id !== action.payload)
    default:
      return state
  }
}

export default function App() {
  // State
  const [servers, setServers] = useState([])
  const [selectedServerId, setSelectedServerId] = useState(null)
  const [toasts, dispatchToast] = useReducer(toastReducer, [])
  const [loading, setLoading] = useState(true)

  // WebSocket hook
  const {
    connected,
    subscribe,
    unsubscribe,
    sendCommand,
    logs,
    serverStatus,
    subscribe: wsSubscribe
  } = useWebSocket()

  // Fetch servers on mount
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const response = await fetch('/api/servers')
        if (!response.ok) throw new Error('Failed to fetch servers')
        const data = await response.json()
        setServers(data.data || data)
      } catch (error) {
        dispatchToast({
          type: 'ADD',
          payload: { type: 'error', message: `Failed to load servers: ${error.message}` }
        })
      } finally {
        setLoading(false)
      }
    }

    fetchServers()
    const interval = setInterval(fetchServers, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  // Handle server selection
  const handleSelectServer = useCallback((serverId) => {
    if (selectedServerId === serverId && connected) return

    // Unsubscribe from previous
    if (selectedServerId) {
      unsubscribe(selectedServerId)
    }

    // Subscribe to new
    setSelectedServerId(serverId)
    wsSubscribe(serverId)
  }, [selectedServerId, connected, unsubscribe, wsSubscribe])

  // Handle command submission
  const handleSendCommand = useCallback((command) => {
    if (!selectedServerId || !connected) {
      dispatchToast({
        type: 'ADD',
        payload: { type: 'warning', message: 'Not connected to server' }
      })
      return
    }

    sendCommand(selectedServerId, command)
  }, [selectedServerId, connected, sendCommand])

  // Auto-dismiss toasts
  useEffect(() => {
    toasts.forEach(toast => {
      if (toast.duration !== false) {
        const timeout = setTimeout(
          () => dispatchToast({ type: 'REMOVE', payload: toast.id }),
          toast.duration || 4000
        )
        return () => clearTimeout(timeout)
      }
    })
  }, [toasts])

  const selectedServer = servers.find(s => s.id === selectedServerId)

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Status Bar */}
      <StatusBar
        server={selectedServer}
        status={selectedServerId ? serverStatus : 'disconnected'}
        wsConnected={connected}
      />

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          servers={servers}
          selectedServerId={selectedServerId}
          onSelectServer={handleSelectServer}
          loading={loading}
        />

        {/* Console Area */}
        <div className="flex-1 flex flex-col bg-gray-900 border-l border-gray-800">
          {selectedServerId ? (
            <>
              <Console logs={logs[selectedServerId] || []} />
              <CommandInput onSubmit={handleSendCommand} disabled={!connected} />
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-500">
              <p>Select a server to view console</p>
            </div>
          )}
        </div>
      </div>

      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
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
