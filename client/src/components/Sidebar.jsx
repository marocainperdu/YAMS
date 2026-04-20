import { memo } from 'react'
import { C, statusColor } from '../styles/tokens'

function Sidebar({ servers, selectedServerId, onSelectServer, loading }) {
  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: C.bg,
      borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
        background: C.surface2,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: C.muted,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Servers
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading ? (
          <div style={{ padding: '12px 16px' }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse" style={{
                height: 36, background: C.surface, borderRadius: 6,
                marginBottom: 4,
              }} />
            ))}
          </div>
        ) : servers.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: C.dim, fontSize: 12 }}>
            No servers yet
          </div>
        ) : (
          <div style={{ padding: '4px 8px' }}>
            {servers.map(server => (
              <ServerItem
                key={server.id}
                server={server}
                isSelected={server.id === selectedServerId}
                onSelect={() => onSelectServer(server.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

const ServerItem = memo(function ServerItem({ server, isSelected, onSelect }) {
  const status = server.status || 'stopped'
  const dotColor = statusColor(status)

  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 6,
        border: 'none', cursor: 'pointer',
        background: isSelected ? C.surface2 : 'transparent',
        outline: isSelected ? `1px solid ${C.border}` : '1px solid transparent',
        transition: 'background 150ms, outline 150ms',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.surface }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          className={status === 'running' ? 'dot-running' : ''}
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: dotColor, flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: 13, fontWeight: 500,
          color: isSelected ? C.text : C.muted,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 150ms',
        }}>
          {server.name}
        </span>
      </div>
      <span style={{ fontSize: 11, color: C.dim, paddingLeft: 13 }}>
        :{server.port}
      </span>
    </button>
  )
})

export default Sidebar
