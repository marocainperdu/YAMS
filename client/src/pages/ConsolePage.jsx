import React from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { apiFetch, C } from '../lib/yamsShared'

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[91m',
  cyan: '\x1b[36m',
}

function formatLogLine({ type, data, timestamp }) {
  const ts = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const prefix = `${ANSI.gray}${ts}${ANSI.reset} `
  if (type === 'stderr') {
    return `${prefix}${ANSI.red}${data}${ANSI.reset}`
  }
  if (type === 'system') {
    return `${prefix}${ANSI.cyan}${ANSI.dim}${data}${ANSI.reset}`
  }
  const colored = (data || '').
    replace(/(\[.*?\/INFO\]:)/g, `${ANSI.green}$1${ANSI.reset}`).
    replace(/(\[.*?\/WARN\]:)/g, `${ANSI.yellow}$1${ANSI.reset}`).
    replace(/(\[.*?\/ERROR\]:)/g, `${ANSI.red}$1${ANSI.reset}`)
  return `${prefix}${ANSI.white}${colored}${ANSI.reset}`
}

function wsBaseUrl() {
  const token = sessionStorage.getItem('yams_token') ?? ''
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL + query
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws${query}`
}

export default function ConsolePage({ serverId, navigate }) {
  const termRef = React.useRef(null)
  const xtermRef = React.useRef(null)
  const fitRef = React.useRef(null)
  const wsRef = React.useRef(null)
  const mountedRef = React.useRef(true)

  const [cmdInput, setCmdInput] = React.useState('')
  const [history, setHistory] = React.useState([])
  const [histIdx, setHistIdx] = React.useState(-1)
  const [wsStatus, setWsStatus] = React.useState('connecting')
  const [serverName, setServerName] = React.useState(serverId)
  const inputRef = React.useRef(null)

  React.useEffect(() => {
    apiFetch(`/servers/${serverId}`)
      .then(res => { if (res.data?.name) setServerName(res.data.name) })
      .catch(() => {})
  }, [serverId])

  React.useEffect(() => {
    if (!termRef.current) return
    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        black: '#161b22',
        brightBlack: '#484f58',
        white: '#e6edf3',
        brightWhite: '#ffffff',
        red: '#f85149',
        brightRed: '#f85149',
        green: '#3fb950',
        brightGreen: '#56d364',
        yellow: '#d29922',
        brightYellow: '#e3b341',
        blue: '#388bfd',
        brightBlue: '#79c0ff',
        cyan: '#39c5cf',
        brightCyan: '#56d4dd',
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: 'bar',
      cursorBlink: false,
      scrollback: 2000,
      convertEol: true,
      disableStdin: true,
    })

    term.open(termRef.current)
    xtermRef.current = term

    const fit = new FitAddon()
    term.loadAddon(fit)
    fitRef.current = fit
    setTimeout(() => fit.fit(), 100)

    const ro = new ResizeObserver(() => fitRef.current?.fit())
    ro.observe(termRef.current)

    return () => {
      mountedRef.current = false
      ro.disconnect()
      term.dispose()
      xtermRef.current = null
    }
  }, [serverId])

  React.useEffect(() => {
    mountedRef.current = true
    let ws = null
    let reconnectTimer = null
    let backoff = 1000

    function writeLine(entry) {
      if (xtermRef.current) {
        xtermRef.current.writeln(formatLogLine(entry))
      }
    }

    function connect() {
      if (!mountedRef.current) return
      setWsStatus('connecting')
      ws = new WebSocket(wsBaseUrl())
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return ws.close()
        backoff = 1000
        ws.send(JSON.stringify({ action: 'subscribe', serverId }))
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        let msg
        try { msg = JSON.parse(event.data) } catch { return }

        if (msg.type === 'status') {
          if (msg.data === 'subscribed') {
            setWsStatus('connected')
            writeLine({ type: 'system', data: `── YAMS Console · ${msg.server || serverId} ──`, timestamp: Date.now() })
          } else if (msg.data === 'pending') {
            setWsStatus('connecting')
            writeLine({ type: 'system', data: 'Server is stopped — waiting for it to start…', timestamp: Date.now() })
          } else if (msg.data === 'started') {
            setWsStatus('connected')
            writeLine({ type: 'system', data: '── Server started ──', timestamp: Date.now() })
          } else if (msg.data === 'stopped') {
            setWsStatus('lost')
            writeLine({ type: 'system', data: '── Server stopped ──', timestamp: Date.now() })
          }
        } else if (msg.type === 'history') {
          (msg.data || []).forEach(entry => writeLine(entry))
        } else if (msg.type === 'stdout' || msg.type === 'stderr') {
          writeLine(msg)
        } else if (msg.type === 'error') {
          writeLine({ type: 'system', data: `[error] ${msg.data}`, timestamp: Date.now() })
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setWsStatus('lost')
        reconnectTimer = setTimeout(connect, Math.min(backoff, 10000))
        backoff = Math.min(backoff * 2, 10000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }, [serverId])

  function sendCommand(cmd) {
    const trimmed = cmd.trim()
    if (!trimmed) return
    setHistory(h => [trimmed, ...h].slice(0, 100))
    setHistIdx(-1)
    setCmdInput('')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'command', serverId, command: trimmed }))
    }
    if (xtermRef.current) {
      xtermRef.current.writeln(formatLogLine({ type: 'system', data: `> ${trimmed}`, timestamp: Date.now() }))
    }
  }

  function handleInputKey(e) {
    if (e.key === 'Enter') {
      sendCommand(cmdInput)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHistIdx(i => {
        const next = Math.min(i + 1, history.length - 1)
        setCmdInput(history[next] || '')
        return next
      })
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHistIdx(i => {
        const next = Math.max(i - 1, -1)
        setCmdInput(next === -1 ? '' : history[next])
        return next
      })
    }
  }

  const wsColor = wsStatus === 'connected' ? C.green : wsStatus === 'lost' ? C.red : C.amber
  const wsLabel = wsStatus === 'lost' ? 'Disconnected' : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', height: 48, flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.surface }}>
        <button
          onClick={() => navigate('#/')}
          style={{
            background: 'none', border: 'none', color: C.muted,
            cursor: 'pointer', fontSize: 13, padding: '4px 0',
            display: 'flex', alignItems: 'center', gap: 6, transition: 'color 150ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.text }}
          onMouseLeave={e => { e.currentTarget.style.color = C.muted }}
        >← Dashboard</button>
        <div style={{ width: 1, height: 16, background: C.border }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{serverName || 'Console'}</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: wsColor, fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: wsColor, boxShadow: wsStatus === 'connected' ? `0 0 6px ${C.green}88` : 'none', display: 'inline-block' }} />
          {wsLabel}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div ref={termRef} style={{ flex: 1, overflow: 'hidden', padding: '4px 4px 0 4px', background: C.bg }} />
        <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', opacity: wsStatus === 'connected' ? 1 : 0.5, transition: 'opacity 150ms' }}>
          <span style={{ padding: '0 12px 0 16px', color: C.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, userSelect: 'none', flexShrink: 0 }}>&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={cmdInput}
            onChange={e => setCmdInput(e.target.value)}
            onKeyDown={handleInputKey}
            placeholder="Enter command…"
            disabled={wsStatus !== 'connected'}
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: C.text, fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13, padding: '12px 0', caretColor: C.green,
            }}
          />
          <button
            onClick={() => sendCommand(cmdInput)}
            disabled={wsStatus !== 'connected' || !cmdInput.trim()}
            style={{
              background: 'none', border: 'none', borderLeft: `1px solid ${C.border}`,
              color: cmdInput.trim() && wsStatus === 'connected' ? C.blue : C.dim,
              padding: '0 16px', height: '100%', cursor: cmdInput.trim() && wsStatus === 'connected' ? 'pointer' : 'default',
              fontSize: 12, fontWeight: 600, transition: 'color 150ms', flexShrink: 0, minHeight: 45,
            }}
          >Send</button>
        </div>
      </div>
    </div>
  )
}
