import React from 'react'
import useDashboard from '../hooks/useDashboard'
import {
  C,
  ErrorBanner,
  EmptyState,
  StatusDot,
  formatSysUptime,
  formatUptime,
  statusColor,
  apiFetch,
} from '../lib/yamsShared'


function ServerTable({ servers: propServers, navigate, reordering, onReorder }) {
  const [hovered, setHovered] = React.useState(null)
  const [toggling, setToggling] = React.useState({})
  const [localOrder, setLocalOrder] = React.useState(null)
  const [dragIdx, setDragIdx] = React.useState(null)
  const [overIdx, setOverIdx] = React.useState(null)

  React.useEffect(() => {
    if (!reordering && localOrder) {
      onReorder && onReorder(localOrder)
      setLocalOrder(null)
    }
  }, [reordering, localOrder, onReorder])

  async function toggleServer(e, srv) {
    e.stopPropagation()
    if (srv.status === 'crashed') return
    if (toggling[srv.id]) return
    const isRunning = srv.status === 'running'
    setToggling(t => ({ ...t, [srv.id]: true }))
    try {
      await apiFetch(`/servers/${srv.id}/${isRunning ? 'stop' : 'start'}`, { method: 'POST' })
    } catch (err) {
      console.error('[YAMS] toggle server error:', err)
    } finally {
      setToggling(t => ({ ...t, [srv.id]: false }))
    }
  }

  function handleDrop(idx) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return }
    const base = localOrder
      ? propServers.slice().sort((a, b) => localOrder.indexOf(a.id) - localOrder.indexOf(b.id))
      : propServers
    const next = [...base]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    setLocalOrder(next.map(s => s.id))
    setDragIdx(null); setOverIdx(null)
  }

  let servers = propServers
  if (localOrder) {
    servers = localOrder.map(id => propServers.find(s => s.id === id)).filter(Boolean)
  }

  if (!servers || servers.length === 0) {
    return <EmptyState message="No servers configured" />
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.surface2 }}>
        {reordering && <div style={{ width: 28 }} />}
        {[
          { key: 'name', label: 'Name', w: '30%' },
          { key: 'status', label: 'Status', w: '16%' },
          { key: 'clients', label: 'Clients', w: '16%' },
          { key: 'uptime', label: 'Uptime', w: '18%' },
          { key: 'action', label: '', w: '20%' },
        ].map(col => (
          <div key={col.key} style={{ width: col.w, fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {col.label}
          </div>
        ))}
      </div>
      {servers.map((srv, i) => {
        const isHov = hovered === srv.id
        const isOver = reordering && overIdx === i
        const isDragged = reordering && dragIdx === i
        const isTogg = !!toggling[srv.id]
        const isRunning = srv.status === 'running'
        const isCrashed = srv.status === 'crashed'
        const isInstalling = srv.status === 'installing'
        const isInstallFailed = srv.status === 'install_failed'

        return (
          <div
            key={srv.id}
            draggable={reordering}
            onDragStart={reordering ? () => setDragIdx(i) : undefined}
            onDragOver={reordering ? e => { e.preventDefault(); setOverIdx(i) } : undefined}
            onDrop={reordering ? () => handleDrop(i) : undefined}
            onDragEnd={reordering ? () => { setDragIdx(null); setOverIdx(null) } : undefined}
            onClick={reordering ? undefined : () => navigate(`#/console/${srv.id}`)}
            onMouseEnter={() => setHovered(srv.id)}
            onMouseLeave={() => setHovered(null)}
            style={{
              display: 'flex', alignItems: 'center',
              padding: '12px 16px', cursor: reordering ? 'grab' : 'pointer',
              borderBottom: i < servers.length - 1 ? `1px solid ${C.borderLight}` : 'none',
              background: isOver ? `${C.blue}0d` : isHov ? C.surface2 : 'transparent',
              borderLeft: isOver ? `2px solid ${C.blue}` : '2px solid transparent',
              opacity: isDragged ? 0.4 : 1,
              transition: 'background 150ms, opacity 150ms, border-color 150ms',
            }}
          >
            {reordering && (
              <div style={{ width: 20, marginRight: 8, color: C.dim, fontSize: 14, userSelect: 'none', flexShrink: 0 }}>⠿</div>
            )}
            <div style={{ width: '30%', fontWeight: 500, fontSize: 13, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>
              {srv.name}
            </div>
            <div style={{ width: '16%', display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={srv.status} />
              <span style={{ fontSize: 12, color: statusColor(srv.status), fontWeight: 500, textTransform: 'capitalize' }}>
                {srv.status === 'install_failed' ? 'Install Failed' : srv.status}
              </span>
            </div>
            <div style={{ width: '16%', fontSize: 13, color: srv.clients > 0 ? C.text : C.dim, fontVariantNumeric: 'tabular-nums' }}>
              {srv.status === 'running' ? `${srv.clients} / ${srv.maxClients}` : '—'}
            </div>
            <div style={{ width: '18%', fontSize: 13, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
              {formatUptime(srv.uptime)}
            </div>
            <div style={{ width: '20%', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
              {!reordering && (
                <button
                  onClick={e => { e.stopPropagation(); navigate(`#/server/${srv.id}`) }}
                  style={{
                    fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 4,
                    border: `1px solid ${C.border}`, background: 'transparent',
                    color: C.muted, cursor: 'pointer', transition: 'all 150ms',
                    opacity: isHov ? 1 : 0,
                  }}
                >Manage</button>
              )}
              {!reordering && isInstalling && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                  border: `1px solid ${C.blue}55`, background: `${C.blue}18`, color: C.blue, flexShrink: 0 }}>
                  Installing…
                </span>
              )}
              {!reordering && isInstallFailed && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                  border: `1px solid ${C.red}55`, background: `${C.red}18`, color: C.red, flexShrink: 0 }}>
                  Failed
                </span>
              )}
              {!reordering && !isInstalling && !isInstallFailed && (() => {
                const label = isTogg ? '…' : isRunning ? 'Stop' : 'Start'
                const bg = isRunning ? `${C.red}18` : `${C.green}18`
                const border = isRunning ? `${C.red}55` : `${C.green}55`
                const color = isRunning ? C.red : C.green
                return (
                  <button
                    onClick={e => toggleServer(e, srv)}
                    disabled={isCrashed || isTogg}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px',
                      borderRadius: 4, border: `1px solid ${isCrashed ? C.dim + '44' : border}`,
                      background: isCrashed ? 'transparent' : bg,
                      color: isCrashed ? C.dim : color,
                      cursor: isCrashed || isTogg ? 'default' : 'pointer',
                      transition: 'all 150ms', opacity: isTogg ? 0.6 : 1,
                      flexShrink: 0, minWidth: 44,
                    }}
                  >{label}</button>
                )
              })()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SystemPanel({ systemUptime, systemHealth, lastUpdated }) {
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - lastUpdated) / 1000)), 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  const healthPct = Math.round(systemHealth * 100)
  const healthColor = systemHealth > 0.85 ? C.green : systemHealth > 0.6 ? C.amber : C.red

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>System</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 11, color: C.dim }}>Uptime</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
          {formatSysUptime(systemUptime)}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: C.dim }}>Health</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: healthColor, fontVariantNumeric: 'tabular-nums' }}>{healthPct}%</span>
        </div>
        <div style={{ height: 4, background: C.surface2, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${healthPct}%`, background: healthColor, borderRadius: 2, transition: 'width 600ms ease, background 300ms' }} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 'auto' }}>
        {elapsed === 0 ? 'Updated just now' : `Updated ${elapsed}s ago`}
      </div>
    </div>
  )
}

function ActivityFeed({ logs }) {
  const listRef = React.useRef(null)
  const atBottomRef = React.useRef(true)
  const displayed = logs.slice(-20)

  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onScroll = () => { atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  React.useEffect(() => {
    if (atBottomRef.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [logs.length])

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.surface2, fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Activity
        <span style={{ fontSize: 10, color: C.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{logs.length} events</span>
      </div>
      <div ref={listRef} style={{ overflowY: 'auto', maxHeight: 260, padding: '8px 0' }}>
        {displayed.length === 0
          ? <div style={{ padding: '16px', color: C.dim, fontSize: 12 }}>No activity yet</div>
          : displayed.map((entry, idx) => (
            <div key={entry.id ?? idx} style={{ padding: '5px 16px', fontSize: 12, color: C.muted, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, display: 'flex', gap: 10 }}>
              <span style={{ color: C.dim, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span>{entry.msg}</span>
            </div>
          ))
        }
      </div>
    </div>
  )
}

export default function Dashboard({ navigate, extraServers = [] }) {
  const { data, error, lastUpdated } = useDashboard()
  const [reordering, setReordering] = React.useState(false)
  const [serverOrder, setServerOrder] = React.useState(null)

  const servers = React.useMemo(() => {
    const apiIds = new Set(data.servers.map(s => s.id))
    const merged = [...data.servers, ...extraServers.filter(s => !apiIds.has(s.id))]
    if (!serverOrder) return merged
    return serverOrder.map(id => merged.find(s => s.id === id)).filter(Boolean)
  }, [data.servers, extraServers, serverOrder])

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1200, margin: '0 auto' }}>
      <ErrorBanner message={error} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.text }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: C.muted }}>{servers.length} server{servers.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Servers</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => navigate('#/create-server')}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 4,
                    border: 'none', background: C.green, color: '#0d1117',
                    cursor: 'pointer',
                  }}
                >+ New</button>
                <button
                  onClick={() => setReordering(r => !r)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                    border: `1px solid ${reordering ? C.blue + '66' : C.border}`,
                    background: reordering ? `${C.blue}18` : 'transparent',
                    color: reordering ? C.blue : C.muted,
                    cursor: 'pointer', transition: 'all 150ms',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <span>⠿</span>
                  {reordering ? 'Done' : 'Reorder'}
                </button>
              </div>
            </div>
            {reordering && (
              <div style={{ fontSize: 11, color: C.blue, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                Drag rows to reorder · click Done to save
              </div>
            )}
            <ServerTable
              servers={servers}
              navigate={navigate}
              reordering={reordering}
              onReorder={async ids => {
                setServerOrder(ids)
                try {
                  await apiFetch('/servers/reorder', { method: 'POST', body: JSON.stringify({ order: ids }) })
                } catch (err) {
                  console.error('[YAMS] Failed to save server order:', err)
                }
              }}
            />
          </div>
          <ActivityFeed logs={data.logs} />
        </div>
        <SystemPanel systemUptime={data.systemUptime} systemHealth={data.systemHealth} lastUpdated={lastUpdated} />
      </div>
    </div>
  )
}
