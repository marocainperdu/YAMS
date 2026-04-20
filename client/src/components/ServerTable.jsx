import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C, statusColor } from '../styles/tokens'

function formatUptime(ms) {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function StatusDot({ status }) {
  const color = statusColor(status)
  return (
    <span
      className={status === 'running' ? 'dot-running' : ''}
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: color, flexShrink: 0,
      }}
    />
  )
}

const COLS = [
  { label: 'Name',    w: '30%' },
  { label: 'Status',  w: '18%' },
  { label: 'Clients', w: '17%' },
  { label: 'Uptime',  w: '17%' },
  { label: '',        w: '18%' },
]

export default function ServerTable({ servers }) {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(null)

  if (!servers?.length) {
    return (
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: '40px 24px',
        textAlign: 'center', color: C.dim, fontSize: 13,
      }}>
        No servers configured yet.
      </div>
    )
  }

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', padding: '10px 16px',
        borderBottom: `1px solid ${C.border}`,
        background: C.surface2,
      }}>
        {COLS.map(col => (
          <div key={col.label} style={{
            width: col.w, fontSize: 11, fontWeight: 500,
            color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {col.label}
          </div>
        ))}
      </div>

      {/* Rows */}
      {servers.map((server, i) => {
        const isHov = hovered === server.id
        const sColor = statusColor(server.status)
        return (
          <div
            key={server.id}
            onClick={() => navigate(`/console/${server.id}`)}
            onMouseEnter={() => setHovered(server.id)}
            onMouseLeave={() => setHovered(null)}
            style={{
              display: 'flex', alignItems: 'center',
              padding: '12px 16px', cursor: 'pointer',
              borderBottom: i < servers.length - 1 ? `1px solid ${C.borderLight}` : 'none',
              background: isHov ? C.surface2 : 'transparent',
              transition: 'background 150ms',
            }}
          >
            {/* Name */}
            <div style={{
              width: '30%', fontWeight: 500, fontSize: 13, color: C.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12,
            }}>
              {server.name}
            </div>

            {/* Status */}
            <div style={{ width: '18%', display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={server.status} />
              <span style={{
                fontSize: 12, color: sColor, fontWeight: 500, textTransform: 'capitalize',
              }}>
                {server.status}
              </span>
            </div>

            {/* Clients */}
            <div style={{
              width: '17%', fontSize: 13,
              color: server.clients > 0 ? C.text : C.dim,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {server.status === 'running' ? server.clients ?? 0 : '—'}
            </div>

            {/* Uptime */}
            <div style={{
              width: '17%', fontSize: 13, color: C.muted,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatUptime(server.uptime)}
            </div>

            {/* Action */}
            <div style={{ width: '18%', display: 'flex', justifyContent: 'flex-end' }}>
              <span style={{
                fontSize: 11, color: C.blue, fontWeight: 500,
                opacity: isHov ? 1 : 0, transition: 'opacity 150ms',
              }}>
                Open Console →
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ServerTableSkeleton() {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', padding: '10px 16px',
        borderBottom: `1px solid ${C.border}`, background: C.surface2,
      }}>
        {[80, 70, 60, 60, 0].map((w, i) => (
          <div key={i} className="animate-pulse" style={{
            width: COLS[i].w, height: 11,
            background: C.border, borderRadius: 3,
          }} />
        ))}
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', padding: '14px 16px',
          borderBottom: i < 3 ? `1px solid ${C.borderLight}` : 'none', gap: 12,
        }}>
          <div className="animate-pulse" style={{ flex: 1, height: 13, background: C.surface2, borderRadius: 3 }} />
          <div className="animate-pulse" style={{ width: 60, height: 13, background: C.surface2, borderRadius: 3 }} />
          <div className="animate-pulse" style={{ width: 30, height: 13, background: C.surface2, borderRadius: 3 }} />
          <div className="animate-pulse" style={{ width: 50, height: 13, background: C.surface2, borderRadius: 3 }} />
          <div style={{ flex: 1 }} />
        </div>
      ))}
    </div>
  )
}
