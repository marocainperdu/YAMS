import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

export default function useXTerm(containerRef) {
  const termRef    = useRef(null)
  const fitRef     = useRef(null)
  const [terminal, setTerminal] = useState(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background:   '#0d1117',
        foreground:   '#e6edf3',
        cursor:       '#e6edf3',
        black:        '#161b22',
        brightBlack:  '#484f58',
        white:        '#e6edf3',
        brightWhite:  '#ffffff',
        red:          '#f85149',
        brightRed:    '#f85149',
        green:        '#3fb950',
        brightGreen:  '#56d364',
        yellow:       '#d29922',
        brightYellow: '#e3b341',
        blue:         '#388bfd',
        brightBlue:   '#79c0ff',
        cyan:         '#39c5cf',
        brightCyan:   '#56d4dd',
        magenta:      '#a371f7',
        brightMagenta:'#d2a8ff',
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: 'bar',
      cursorBlink: false,
      scrollback: 1000,
      convertEol: true,
      disableStdin: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitRef.current = fitAddon

    term.open(containerRef.current)
    setTimeout(() => fitAddon.fit(), 50)

    termRef.current = term
    setTerminal(term)

    const ro = new ResizeObserver(() => fitRef.current?.fit())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [containerRef])

  const write = (text) => termRef.current?.write(text)
  const writeln = (text) => termRef.current?.writeln(text)
  const clear = () => termRef.current?.clear()

  return { terminal, write, writeln, clear }
}
