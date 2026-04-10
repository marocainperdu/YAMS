import { useState, useRef, useEffect } from 'react'

export default function CommandInput({ onSubmit, disabled }) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || disabled) return

    onSubmit(input)
    setHistory([...history, input])
    setHistoryIndex(-1)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIndex = historyIndex + 1
      if (newIndex < history.length) {
        setHistoryIndex(newIndex)
        setInput(history[history.length - 1 - newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIndex = historyIndex - 1
      if (newIndex < 0) {
        setHistoryIndex(-1)
        setInput('')
      } else {
        setHistoryIndex(newIndex)
        setInput(history[history.length - 1 - newIndex])
      }
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 border-t border-gray-800 p-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command..."
          disabled={disabled}
          className="flex-1 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-green-400 placeholder-gray-600 focus:outline-none focus:border-green-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="px-4 py-2 bg-green-700 text-white rounded text-sm font-medium hover:bg-green-600 disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </form>
  )
}
