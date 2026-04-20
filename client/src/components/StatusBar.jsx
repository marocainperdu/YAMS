import { useNavigate } from 'react-router-dom'
import { C, statusColor } from '../styles/tokens'

export default function StatusBar({ server, status, wsConnected }) {
  const navigate = useNavigate()
  const wsColor = wsConnected ? C.green : status === 'lost' ? C.red : C.amber
  const wsLabel = wsConnected ? 'Connected' : 'Reconnecting…'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 24px', height: 48, flexShrink: 0,
      borderBottom: `1px solid ${C.border}`,
      background: C.surface,
    }}>
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
          fontSize: 13, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6,
          transition: 'color 150ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.text }}
        onMouseLeave={e => { e.currentTarget.style.color = C.muted }}
      >
        ← Dashboard
      </button>

      <div style={{ width: 1, height: 16, background: C.border }} />

      <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
        {server?.name ?? 'Console'}
      </span>

      {server && (
        <>
          <span style={{
            fontSize: 11, color: statusColor(status), fontWeight: 500,
            textTransform: 'capitalize',
          }}>
            {status}
          </span>
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* WS status pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, color: wsColor, fontWeight: 500,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: wsColor,
          boxShadow: wsConnected ? `0 0 6px ${C.green}88` : 'none',
          display: 'inline-block',
        }} />
        {wsLabel}
      </div>
    </div>
  )
}
