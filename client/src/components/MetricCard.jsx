// Left-border accent card. Uses `key={value}` on the number span to retrigger
// the CSS flash animation automatically on every value change — no state needed.

const COLORS = {
  default: {
    border:  'border-l-gray-600',
    value:   'text-gray-100',
    bg:      'hover:border-gray-700',
  },
  green: {
    border:  'border-l-emerald-500',
    value:   'text-emerald-400',
    bg:      'hover:border-emerald-500/50',
  },
  blue: {
    border:  'border-l-blue-500',
    value:   'text-blue-400',
    bg:      'hover:border-blue-500/50',
  },
  amber: {
    border:  'border-l-amber-500',
    value:   'text-amber-400',
    bg:      'hover:border-amber-500/50',
  },
  red: {
    border:  'border-l-red-500',
    value:   'text-red-400',
    bg:      'hover:border-red-500/50',
  },
}

export default function MetricCard({ icon, label, value, color = 'default', style }) {
  const c = COLORS[color] ?? COLORS.default

  return (
    <div
      style={style}
      className={`
        animate-fade-in-up
        bg-gray-900 border border-gray-800 border-l-2 ${c.border} ${c.bg}
        rounded-lg p-4 flex flex-col gap-2
        transition-transform duration-200 hover:-translate-y-px
      `}
    >
      <span className="text-base leading-none">{icon}</span>

      {/* key=value remounts the element on every change, retriggering the CSS animation */}
      <span
        key={value}
        className={`animate-value-flash font-mono text-2xl font-bold leading-none ${c.value}`}
      >
        {value}
      </span>

      <span className="text-xs text-gray-500 uppercase tracking-widest">{label}</span>
    </div>
  )
}

// Skeleton shown during initial load
export function MetricCardSkeleton() {
  // Mirrors live card structure exactly (same gap-2, same element heights) — no layout shift
  return (
    <div className="bg-gray-900 border border-gray-800 border-l-2 border-l-gray-800 rounded-lg p-4 flex flex-col gap-2">
      <div className="w-4 h-4 bg-gray-800 rounded animate-pulse" />
      <div className="w-10 h-7 bg-gray-800 rounded animate-pulse" />
      <div className="w-20 h-3 bg-gray-800 rounded animate-pulse" />
    </div>
  )
}
