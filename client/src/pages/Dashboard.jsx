import useDashboard from '../hooks/useDashboard'
import ServerTable, { ServerTableSkeleton } from '../components/ServerTable'
import SystemPanel from '../components/SystemPanel'
import ActivityFeed from '../components/ActivityFeed'
import { C } from '../styles/tokens'



export default function Dashboard() {
  const { data, loading, error, lastFetched } = useDashboard()

  return (
    <div style={{
      height: '100%', overflowY: 'auto',
      background: C.bg, padding: '24px',
      display: 'flex', flexDirection: 'column', gap: 16,
      maxWidth: 1200, margin: '0 auto', boxSizing: 'border-box', width: '100%',
    }}>
      {/* Error banner */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 6,
          background: `${C.red}18`, border: `1px solid ${C.red}44`,
          color: C.red, fontSize: 13, fontWeight: 500,
        }}>
          <span style={{ fontSize: 10 }}>●</span>
          /metrics unreachable — {error}. Retrying…
        </div>
      )}

      {/* Page heading */}
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.text }}>
        Dashboard
      </h1>


      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16 }}>
        {/* Left: server table + activity feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: C.muted,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>
              Servers
            </div>
            {loading ? <ServerTableSkeleton /> : <ServerTable servers={data.servers.list} />}
          </div>
          <ActivityFeed logs={data.recentLogs} />
        </div>

        {/* Right: system panel */}
        {!loading && (
          <SystemPanel
            uptime={data.uptime}
            lastFetched={lastFetched}
            running={data.servers.running}
            total={data.servers.total}
          />
        )}
      </div>
    </div>
  )
}
