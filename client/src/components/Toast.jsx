import { useEffect, useState } from 'react'

const TOAST_STYLES = {
  error: 'bg-red-600 text-white',
  warning: 'bg-yellow-600 text-white',
  success: 'bg-green-600 text-white',
  info: 'bg-blue-600 text-white'
}

export default function Toast({ type = 'info', message, onClose }) {
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsClosing(true)
      setTimeout(onClose, 200)
    }, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div
      className={`${TOAST_STYLES[type]} px-4 py-3 rounded shadow-lg text-sm transition-all duration-200 transform ${
        isClosing ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p>{message}</p>
        <button
          onClick={() => {
            setIsClosing(true)
            setTimeout(onClose, 200)
          }}
          className="text-white hover:opacity-80"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
