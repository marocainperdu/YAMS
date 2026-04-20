import { useState, useEffect } from 'react'

function formatUptime(ms) {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function useSecondsAgo(timestamp) {
  const [ago, setAgo] = useState(null)

  useEffect(() => {
    if (!timestamp) return
    const tick = () => setAgo(Math.floor((Date.now() - timestamp) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timestamp])

  if (ago === null) return null
  if (ago < 5) return 'just now'
  return `${ago}s ago`
}

export default function SystemPanel({ uptime, lastFetched, running, total }) {
  const ago = useSecondsAgo(lastFetched)
  const healthPct = total > 0 ? Math.round((running / total) * 100) : 0

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col gap-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">System</h3>

      <div>
        <div className="text-xs text-gray-500 mb-1">YAMS Uptime</div>
        <div className="font-mono text-lg font-bold text-gray-100">{formatUptime(uptime)}</div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500">Server Health</span>
          <span className="font-mono text-xs text-gray-400">{running}/{total}</span>
        </div>
        {/* Health bar */}
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${healthPct}%` }}
          />
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-0.5">Last Refreshed</div>
        <div className="text-sm text-gray-400">{ago ?? '—'}</div>
      </div>
    </div>
  )
}
