import { useState, useEffect, useRef } from 'react'
import { C } from '../styles/tokens'

export default function MetricCard({ label, value, accent, sub, style, className }) {
  const [bump, setBump] = useState(false)
  const prev = useRef(value)

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value
      setBump(true)
      const t = setTimeout(() => setBump(false), 300)
      return () => clearTimeout(t)
    }
  }, [value])

  return (
    <div
      className={className}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0,
        flex: 1,
        ...style,
      }}
    >
      <span style={{
        fontSize: 11, fontWeight: 500, color: C.muted,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        {label}
      </span>

      <span
        className={bump ? 'animate-value-bump' : ''}
        style={{
          fontSize: 28, fontWeight: 700,
          color: accent || C.text,
          lineHeight: 1,
          display: 'inline-block',
          fontVariantNumeric: 'tabular-nums',
          transition: 'color 150ms',
        }}
      >
        {value ?? '—'}
      </span>

      {sub != null && (
        <span style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
          {sub}
        </span>
      )}
    </div>
  )
}

export function MetricCardSkeleton() {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 4, flex: 1,
    }}>
      <div className="animate-pulse" style={{ height: 11, width: 80, background: C.surface2, borderRadius: 3 }} />
      <div className="animate-pulse" style={{ height: 28, width: 48, background: C.surface2, borderRadius: 4, marginTop: 4 }} />
    </div>
  )
}
