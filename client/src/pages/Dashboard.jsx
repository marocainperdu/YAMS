import useDashboard from '../hooks/useDashboard'
import MetricCard, { MetricCardSkeleton } from '../components/MetricCard'
import ServerTable, { ServerTableSkeleton } from '../components/ServerTable'
import SystemPanel from '../components/SystemPanel'
import ActivityFeed from '../components/ActivityFeed'

const CARDS = (servers, clients, backpressure) => [
  { icon: '🖥️', label: 'Total Servers',    value: servers.total,                color: 'default' },
  { icon: '●',  label: 'Running',           value: servers.running,              color: 'green'   },
  { icon: '👥', label: 'Active Clients',    value: clients.active,               color: 'blue'    },
  { icon: '⏳', label: 'Pending',           value: clients.pending,              color: 'amber'   },
  { icon: '⚠️', label: 'Dropped Messages',  value: backpressure.droppedMessages, color: backpressure.droppedMessages > 0 ? 'red' : 'default' },
]

export default function Dashboard() {
  const { data, loading, error, lastFetched } = useDashboard()

  const cards = CARDS(data.servers, data.clients, data.backpressure)

  return (
    // h-full + overflow-y-auto: fills Layout's flex-1 and scrolls when content overflows
    <div className="h-full overflow-y-auto bg-gray-950 px-6 py-5 space-y-5">

      {/* Error banner — non-blocking, stale data stays visible */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-950/40 border border-red-800/50 rounded-lg text-sm text-red-400">
          <span className="shrink-0">⚠</span>
          <span>/metrics unreachable — {error}. Retrying…</span>
        </div>
      )}

      {/* ── Metric cards ───────────────────────────────────────────────────── */}
      <section>
        <p className="text-xs text-gray-600 uppercase tracking-widest mb-3">Overview</p>
        {/* 5 cols on lg, 3 on md, 2 on sm */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => <MetricCardSkeleton key={i} />)
            : cards.map((c, i) => (
                <MetricCard
                  key={c.label}
                  {...c}
                  style={{ animationDelay: `${i * 60}ms`, opacity: 0, animationFillMode: 'forwards' }}
                />
              ))}
        </div>
      </section>

      {/* ── Server table ───────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-600 uppercase tracking-widest">Servers</p>
          {!loading && (
            <span className="text-xs font-mono text-gray-600">
              {data.servers.total} total · {data.servers.running} running
            </span>
          )}
        </div>
        {loading
          ? <ServerTableSkeleton />
          : <ServerTable servers={data.servers.list} />}
      </section>

      {/* ── Bottom row: SystemPanel + ActivityFeed ─────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 pb-2">
        {loading ? (
          <>
            <div className="bg-gray-900 border border-gray-800 rounded-lg h-40 animate-pulse" />
            <div className="bg-gray-900 border border-gray-800 rounded-lg h-40 animate-pulse" />
          </>
        ) : (
          <>
            <SystemPanel
              uptime={data.uptime}
              lastFetched={lastFetched}
              running={data.servers.running}
              total={data.servers.total}
            />
            <ActivityFeed logs={data.recentLogs} />
          </>
        )}
      </section>

    </div>
  )
}
