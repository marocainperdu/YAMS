import { useRef, useEffect } from 'react'

const TYPE_COLOR = {
  stdout: 'text-gray-400',
  stderr: 'text-red-400',
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function ActivityFeed({ logs }) {
  const bottomRef = useRef(null)
  const containerRef = useRef(null)

  // Auto-scroll to bottom when new logs arrive, but only if already near bottom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (isNearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const visible = logs?.slice(-20) ?? []

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Recent Activity</h3>
        {visible.length > 0 && (
          <span className="text-xs text-gray-600 font-mono">{visible.length} lines</span>
        )}
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto min-h-0 max-h-48 p-3 space-y-0.5 scroll-smooth"
      >
        {visible.length === 0 ? (
          <p className="text-xs text-gray-600 italic px-1 py-2">No recent activity</p>
        ) : (
          visible.map((log, i) => (
            <div key={i} className="flex items-start gap-2 font-mono text-xs leading-relaxed">
              <span className="text-gray-600 shrink-0 select-none">{formatTime(log.timestamp)}</span>
              {log.serverName && (
                <span className="text-blue-500/70 shrink-0 truncate max-w-[80px]">{log.serverName}</span>
              )}
              <span className={`${TYPE_COLOR[log.type] ?? 'text-gray-400'} truncate`}>
                {String(log.data ?? '').trim()}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
