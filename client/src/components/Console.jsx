import { useEffect, useRef } from 'react'
import useXTerm from '../hooks/useXTerm'
import { C } from '../styles/tokens'

const ANSI = {
  reset:  '\x1b[0m',
  gray:   '\x1b[90m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[91m',
  white:  '\x1b[37m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
}

function formatLine(log) {
  const ts = new Date(log.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const prefix = `${ANSI.gray}${ts}${ANSI.reset} `
  if (log.type === 'stderr') {
    return `${prefix}${ANSI.red}${log.data}${ANSI.reset}`
  }
  const colored = String(log.data ?? '')
    .replace(/(\[.*?\/INFO\]:)/g,  `${ANSI.green}$1${ANSI.reset}`)
    .replace(/(\[.*?\/WARN\]:)/g,  `${ANSI.yellow}$1${ANSI.reset}`)
    .replace(/(\[.*?\/ERROR\]:)/g, `${ANSI.red}$1${ANSI.reset}`)
  return `${prefix}${ANSI.white}${colored}${ANSI.reset}`
}

export default function Console({ logs, serverId }) {
  const containerRef = useRef(null)
  const { terminal, writeln, clear } = useXTerm(containerRef)
  const writtenRef   = useRef(0)
  const prevServerRef = useRef(serverId)

  // Clear terminal and reset counter when switching servers
  useEffect(() => {
    if (!terminal) return
    if (prevServerRef.current !== serverId) {
      clear()
      writtenRef.current = 0
      prevServerRef.current = serverId
      // Write banner for the new server
      terminal.writeln(`${ANSI.cyan}${ANSI.dim}── YAMS Console · ${serverId} ──${ANSI.reset}`)
      terminal.writeln('')
    }
  }, [serverId, terminal, clear])

  // Write new log lines
  useEffect(() => {
    if (!terminal) return
    const newLogs = logs.slice(writtenRef.current)
    newLogs.forEach(log => writeln(formatLine(log)))
    writtenRef.current = logs.length
  }, [logs, terminal, writeln])

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: 'hidden', padding: '4px 4px 0 4px', background: C.bg }}
    />
  )
}
