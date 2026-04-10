import { memo } from 'react'

const STATUS_COLORS = {
  running: 'text-green-500 bg-green-500/10',
  stopped: 'text-gray-500 bg-gray-500/10',
  crashed: 'text-red-500 bg-red-500/10'
}

const STATUS_ICON = {
  running: '●',
  stopped: '○',
  crashed: '✕'
}

function Sidebar({ servers, selectedServerId, onSelectServer, loading }) {
  if (loading) {
    return (
      <div className="w-64 bg-gray-950 border-r border-gray-800 p-4">
        <div className="text-sm text-gray-500">Loading servers...</div>
      </div>
    )
  }

  return (
    <aside className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300">Servers</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {servers.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 text-center">
            No servers created yet
          </div>
        ) : (
          <nav className="space-y-1 p-2">
            {servers.map(server => (
              <ServerItem
                key={server.id}
                server={server}
                isSelected={server.id === selectedServerId}
                onSelect={() => onSelectServer(server.id)}
              />
            ))}
          </nav>
        )}
      </div>
    </aside>
  )
}

const ServerItem = memo(function ServerItem({ server, isSelected, onSelect }) {
  const status = server.status || 'stopped'
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.stopped

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded transition-colors ${
        isSelected
          ? 'bg-blue-600 text-white'
          : 'hover:bg-gray-800 text-gray-300'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-xs ${statusColor} px-2 py-1 rounded`}>
          {STATUS_ICON[status]} {status}
        </span>
      </div>
      <div className="mt-1 text-sm font-medium truncate">{server.name}</div>
      <div className="text-xs text-gray-500">Port: {server.port}</div>
    </button>
  )
})

export default Sidebar
