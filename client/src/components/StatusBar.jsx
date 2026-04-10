export default function StatusBar({ server, status, wsConnected }) {
  const statusColor = {
    running: 'bg-green-600',
    stopped: 'bg-gray-600',
    crashed: 'bg-red-600',
    pending: 'bg-yellow-600'
  }[status] || 'bg-gray-600'

  return (
    <header className="bg-gray-950 border-b border-gray-800 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">
            {server ? server.name : 'YAMS Console'}
          </h1>
          {server && (
            <>
              <div className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
              <span className="text-sm text-gray-400">{status}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-600' : 'bg-red-600'}`} />
          <span className="text-xs text-gray-400">
            {wsConnected ? 'Connected' : 'Offline'}
          </span>
        </div>
      </div>
    </header>
  )
}
