import { useNavigate } from 'react-router-dom'

// Reuse the same status color pattern established in Sidebar.jsx
const STATUS = {
  running: { dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'running' },
  stopped: { dot: 'bg-gray-500',    badge: 'bg-gray-500/10 text-gray-400 border-gray-500/20',          label: 'stopped' },
  crashed: { dot: 'bg-red-500',     badge: 'bg-red-500/10 text-red-400 border-red-500/20',             label: 'crashed' },
}

function formatUptime(ms) {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

export default function ServerTable({ servers }) {
  const navigate = useNavigate()

  if (!servers?.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg px-6 py-10 text-center text-gray-500 text-sm">
        No servers configured yet.
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_130px_70px_90px_80px] px-5 py-2.5 border-b border-gray-800 bg-gray-950/60">
        {['Name', 'Status', 'Clients', 'Uptime', ''].map((h, i) => (
          <span key={i} className="text-xs font-medium text-gray-500 uppercase tracking-widest">
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {servers.map((server, idx) => {
        const s = STATUS[server.status] ?? STATUS.stopped
        return (
          <div
            key={server.id}
            onClick={() => navigate(`/console/${server.id}`)}
            className="grid grid-cols-[1fr_130px_70px_90px_80px] items-center px-5 py-3.5 border-b border-gray-800/60 last:border-0 cursor-pointer group transition-colors duration-150 hover:bg-gray-800/40"
          >
            {/* Name */}
            <span className="font-medium text-gray-200 text-sm truncate group-hover:text-white transition-colors">
              {server.name}
            </span>

            {/* Status badge */}
            <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border w-fit ${s.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${server.status === 'running' ? 'animate-pulse' : ''}`} />
              {s.label}
            </span>

            {/* Clients */}
            <span className="font-mono text-sm text-gray-400">
              {server.clients ?? 0}
            </span>

            {/* Uptime */}
            <span className="font-mono text-sm text-gray-400">
              {formatUptime(server.uptime)}
            </span>

            {/* Action */}
            <span className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity text-right">
              Open →
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function ServerTableSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1fr_130px_70px_90px_80px] px-5 py-2.5 border-b border-gray-800 bg-gray-950/60">
        {[100, 80, 60, 70, 0].map((w, i) => (
          <div key={i} className={`h-3 bg-gray-800 rounded animate-pulse`} style={{ width: w || 0 }} />
        ))}
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} className="grid grid-cols-[1fr_130px_70px_90px_80px] items-center px-5 py-4 border-b border-gray-800/60 last:border-0 gap-4">
          <div className="h-4 w-32 bg-gray-800 rounded animate-pulse" />
          <div className="h-5 w-20 bg-gray-800 rounded-full animate-pulse" />
          <div className="h-4 w-8 bg-gray-800 rounded animate-pulse" />
          <div className="h-4 w-12 bg-gray-800 rounded animate-pulse" />
          <div />
        </div>
      ))}
    </div>
  )
}
