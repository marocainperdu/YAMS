import { useState, useEffect } from 'react'
import { C } from '../styles/tokens'

function formatSysUptime(ms) {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
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
  if (ago < 2) return 'Updated just now'
  return `Updated ${ago}s ago`
}

export default function SystemPanel({ uptime, lastFetched, running, total }) {
  const ago = useSecondsAgo(lastFetched)
  const healthPct = total > 0 ? Math.round((running / total) * 100) : 0
  const healthColor = healthPct > 85 ? C.green : healthPct > 60 ? C.amber : C.red

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, color: C.muted,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        System
      </span>

      {/* Uptime */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 11, color: C.dim }}>YAMS Uptime</span>
        <span style={{
          fontSize: 16, fontWeight: 700, color: C.text,
          fontVariantNumeric: 'tabular-nums', fontFamily: "'JetBrains Mono', monospace",
        }}>
          {formatSysUptime(uptime)}
        </span>
      </div>

      {/* Health bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: C.dim }}>Health</span>
          <span style={{
            fontSize: 12, fontWeight: 600, color: healthColor,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {running}/{total}
          </span>
        </div>
        <div style={{
          height: 4, background: C.surface2, borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${healthPct}%`,
            background: healthColor, borderRadius: 2,
            transition: 'width 600ms ease, background 300ms',
          }} />
        </div>
      </div>

      {/* Last refresh */}
      <div style={{ fontSize: 11, color: C.dim, marginTop: 'auto' }}>
        {ago ?? '—'}
      </div>
    </div>
  )
}
