import React from 'react'
import { apiFetch, C } from '../lib/yamsShared'

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function useDebounce(value, delay) {
  const [dv, setDv] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDv(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return dv
}

// Props:
//   selectedPack — { platform, projectId, title, iconUrl } or null
//   onSelectPack — called with the pack object when user clicks a result
//   platforms    — string[] (e.g. ['modrinth', 'curseforge'])

export default function ModpackBrowser({ selectedPack, onSelectPack, platforms }) {
  const [platform, setPlatform] = React.useState(platforms?.[0] ?? 'modrinth')
  const [query, setQuery]       = React.useState('')
  const debouncedQuery          = useDebounce(query, 300)
  const [results, setResults]   = React.useState([])
  const [total, setTotal]       = React.useState(0)
  const [offset, setOffset]     = React.useState(0)
  const [loading, setLoading]   = React.useState(false)
  const [error, setError]       = React.useState(null)

  const LIMIT = 20

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    apiFetch(`/modpacks/search?platform=${platform}&query=${encodeURIComponent(debouncedQuery)}&limit=${LIMIT}&offset=${offset}`)
      .then(res => {
        if (cancelled) return
        setResults(res.data ?? [])
        setTotal(res.total ?? res.data?.length ?? 0)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [platform, debouncedQuery, offset])

  React.useEffect(() => { setOffset(0) }, [platform, debouncedQuery])

  function normaliseResult(r) {
    if (platform === 'modrinth') {
      return {
        projectId:   r.project_id,
        title:       r.title,
        description: r.description,
        author:      r.author,
        downloads:   r.downloads,
        iconUrl:     r.icon_url,
        platform:    'modrinth',
      }
    }
    return {
      projectId:   String(r.id),
      title:       r.name,
      description: r.summary,
      author:      r.authors?.[0]?.name ?? '—',
      downloads:   r.downloadCount,
      iconUrl:     r.logo?.url,
      platform:    'curseforge',
    }
  }

  const normResults = results.map(normaliseResult)
  const pages       = Math.ceil(total / LIMIT)
  const currentPg   = Math.floor(offset / LIMIT)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {platforms?.length > 1 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {platforms.map(p => (
            <button key={p} onClick={() => { setPlatform(p); onSelectPack(null) }} style={{
              padding: '5px 16px', borderRadius: 6, border: `1px solid ${platform === p ? C.blue : C.border}`,
              background: platform === p ? `${C.blue}18` : 'transparent',
              color: platform === p ? C.blue : C.muted,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
            }}>{p}</button>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search modpacks…"
        style={{
          width: '100%', boxSizing: 'border-box',
          background: C.surface2, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '9px 14px', fontSize: 13, color: C.text,
          outline: 'none',
        }}
        onFocus={e => { e.target.style.borderColor = C.blue }}
        onBlur={e => { e.target.style.borderColor = C.border }}
      />

      {error && (
        <div style={{ color: C.red, fontSize: 12, padding: '10px 14px', background: `${C.red}12`, borderRadius: 6, border: `1px solid ${C.red}44` }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 24 }}>Searching…</div>
      )}

      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {normResults.map(pack => {
            const isSelected = selectedPack?.projectId === pack.projectId
            return (
              <button key={pack.projectId} onClick={() => onSelectPack(isSelected ? null : pack)} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                background: isSelected ? `${C.blue}28` : C.surface2,
                border: `2px solid ${isSelected ? C.blue : C.border}`,
                boxShadow: isSelected ? `0 0 0 1px ${C.blue}60, inset 3px 0 0 ${C.blue}` : 'none',
                transition: 'border-color 150ms, background 150ms, box-shadow 150ms',
              }}>
                {pack.iconUrl
                  ? <img src={pack.iconUrl} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'contain', flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 6, background: C.border, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📦</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? C.blue : C.text, marginBottom: 2 }}>{pack.title}</div>
                  <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>{pack.description}</div>
                  <div style={{ fontSize: 10, color: C.dim }}>by {pack.author} · {fmt(pack.downloads ?? 0)} downloads</div>
                </div>
                {isSelected && (
                  <div style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700, marginLeft: 4 }}>✓</div>
                )}
              </button>
            )
          })}

          {normResults.length === 0 && (
            <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 32 }}>
              No modpacks found{query ? ` for "${query}"` : ''}.
            </div>
          )}
        </div>
      )}

      {pages > 1 && !loading && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} style={pageBtn(offset === 0)}>← Prev</button>
          <span style={{ fontSize: 12, color: C.muted, padding: '5px 0' }}>Page {currentPg + 1} / {pages}</span>
          <button onClick={() => setOffset(offset + LIMIT)} disabled={currentPg >= pages - 1} style={pageBtn(currentPg >= pages - 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}

function pageBtn(disabled) {
  return {
    padding: '5px 14px', borderRadius: 6, border: `1px solid ${C.border}`,
    background: 'transparent', color: disabled ? C.dim : C.muted,
    fontSize: 12, cursor: disabled ? 'default' : 'pointer',
  }
}
