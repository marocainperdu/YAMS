import { useState } from 'react'
import { C } from '../styles/tokens'

const TOAST_CONFIG = {
  error:   { bg: `${C.red}20`,   border: `${C.red}55`,   color: C.red   },
  warning: { bg: `${C.amber}20`, border: `${C.amber}55`, color: C.amber },
  success: { bg: `${C.green}20`, border: `${C.green}55`, color: C.green },
  info:    { bg: `${C.blue}20`,  border: `${C.blue}55`,  color: C.blue  },
}

export default function Toast({ type = 'info', message, onClose }) {
  const [closing, setClosing] = useState(false)
  const cfg = TOAST_CONFIG[type] ?? TOAST_CONFIG.info

  function dismiss() {
    setClosing(true)
    setTimeout(onClose, 200)
  }

  return (
    <div
      className="animate-slide-in"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 6, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, color: C.text, minWidth: 240, maxWidth: 360,
        transition: 'opacity 200ms, transform 200ms',
        opacity: closing ? 0 : 1,
        transform: closing ? 'translateX(20px)' : 'translateX(0)',
      }}
    >
      <span style={{ color: cfg.color, fontSize: 10 }}>●</span>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={dismiss}
        style={{
          background: 'none', border: 'none', color: C.muted,
          cursor: 'pointer', fontSize: 12, padding: 2, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}
