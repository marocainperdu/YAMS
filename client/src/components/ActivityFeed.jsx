import { useRef, useEffect } from 'react'
import { C } from '../styles/tokens'

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function ActivityFeed({ logs }) {
  const listRef = useRef(null)
  const atBottomRef = useRef(true)

  const displayed = logs?.slice(-20) ?? []

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onScroll = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (atBottomRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [logs?.length])

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
        background: C.surface2, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: C.muted,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Activity
        </span>
        <span style={{ fontSize: 10, color: C.dim }}>
          {logs?.length ?? 0} events
        </span>
      </div>

      {/* Log list */}
      <div
        ref={listRef}
        style={{ overflowY: 'auto', maxHeight: 260, padding: '8px 0' }}
      >
        {displayed.length === 0 ? (
          <div style={{ padding: '16px', color: C.dim, fontSize: 12 }}>
            No activity yet
          </div>
        ) : (
          displayed.map((log, i) => (
            <div
              key={log.id ?? i}
              style={{
                padding: '4px 16px', fontSize: 12, color: C.muted,
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.6, display: 'flex', gap: 10,
              }}
            >
              <span style={{ color: C.dim, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(log.timestamp || log.ts)}
              </span>
              {log.serverName && (
                <span style={{ color: C.blue + 'aa', flexShrink: 0, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  [{log.serverName}]
                </span>
              )}
              <span style={{
                color: log.type === 'stderr' ? C.red : C.muted,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {String(log.data ?? log.msg ?? '').trim()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
