import { useEffect, useRef } from 'react'
import useXTerm from '../hooks/useXTerm'

export default function Console({ logs }) {
  const containerRef = useRef(null)
  const { terminal, write, clear } = useXTerm(containerRef)

  // Write logs to terminal
  useEffect(() => {
    if (!terminal) return

    logs.forEach(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString()
      const prefix = `[${timestamp}] `

      if (log.type === 'stderr') {
        write(`\x1b[31m${prefix}${log.data}\x1b[0m\n`)
      } else if (log.type === 'stdout') {
        write(`${prefix}${log.data}\n`)
      }
    })
  }, [logs, terminal, write])

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-terminal-bg overflow-hidden"
      style={{ fontSize: '14px', fontFamily: 'Fira Code, monospace' }}
    />
  )
}
