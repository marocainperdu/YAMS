import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

/**
 * xterm.js terminal management hook
 */
export default function useXTerm(containerRef) {
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [terminal, setTerminal] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      lineHeight: 1.2,
      fontFamily: 'Courier New, monospace',
      fontSize: 13,
      theme: {
        background: '#1a1a1a',
        foreground: '#00ff00',
        cursor: '#00ff00',
        black: '#000000',
        red: '#ff4444',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#4444ff',
        magenta: '#ff44ff',
        cyan: '#44ffff',
        white: '#ffffff',
        brightBlack: '#444444',
        brightRed: '#ff6666',
        brightGreen: '#66ff66',
        brightYellow: '#ffff66',
        brightBlue: '#6666ff',
        brightMagenta: '#ff66ff',
        brightCyan: '#66ffff',
        brightWhite: '#ffffff'
      },
      scrollback: 1000
    });

    // Fit addon for responsive sizing
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Mount terminal
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    setTerminal(term);

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, [containerRef]);

  /**
   * Write text to terminal (no newline)
   */
  const write = (text) => {
    if (terminalRef.current) {
      terminalRef.current.write(text);
    }
  };

  /**
   * Write line to terminal (with newline)
   */
  const writeLine = (text) => {
    if (terminalRef.current) {
      terminalRef.current.writeln(text);
    }
  };

  /**
   * Clear terminal
   */
  const clear = () => {
    if (terminalRef.current) {
      terminalRef.current.clear();
    }
  };

  /**
   * Dispose terminal
   */
  const dispose = () => {
    if (terminalRef.current) {
      terminalRef.current.dispose();
    }
  };

  return {
    terminal,
    write,
    writeLine,
    clear,
    dispose
  };
}
