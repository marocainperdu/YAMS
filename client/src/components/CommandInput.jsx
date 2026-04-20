import { useState, useRef, useEffect } from 'react'
import { C } from '../styles/tokens'

export default function CommandInput({ onSubmit, disabled }) {
  const [input, setInput]       = useState('')
  const [history, setHistory]   = useState([])
  const [histIdx, setHistIdx]   = useState(-1)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(e) {
    e?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setHistory(h => [trimmed, ...h].slice(0, 100))
    setHistIdx(-1)
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter')     { handleSubmit(); return }
    if (e.key === 'ArrowUp')   {
      e.preventDefault()
      setHistIdx(i => {
        const n = Math.min(i + 1, history.length - 1)
        setInput(history[n] ?? '')
        return n
      })
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHistIdx(i => {
        const n = Math.max(i - 1, -1)
        setInput(n === -1 ? '' : history[n])
        return n
      })
    }
  }

  const hasInput = input.trim().length > 0

  return (
    <div style={{
      flexShrink: 0,
      borderTop: `1px solid ${C.border}`,
      background: C.surface,
      display: 'flex', alignItems: 'center',
      opacity: disabled ? 0.5 : 1,
      transition: 'opacity 150ms',
    }}>
      {/* Prompt */}
      <span style={{
        padding: '0 12px 0 16px',
        color: C.green,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13, fontWeight: 600,
        userSelect: 'none', flexShrink: 0,
      }}>
        &gt;
      </span>

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter command…"
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        style={{
          flex: 1, background: 'none', border: 'none', outline: 'none',
          color: C.text,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13, padding: '12px 0',
          caretColor: C.green,
        }}
      />

      {/* Send button */}
      <button
        onClick={handleSubmit}
        disabled={disabled || !hasInput}
        style={{
          background: 'none',
          border: 'none',
          borderLeft: `1px solid ${C.border}`,
          color: hasInput && !disabled ? C.blue : C.dim,
          padding: '0 16px', height: '100%',
          cursor: hasInput && !disabled ? 'pointer' : 'default',
          fontSize: 12, fontWeight: 600,
          transition: 'color 150ms', flexShrink: 0,
          minHeight: 45,
        }}
      >
        Send
      </button>
    </div>
  )
}
