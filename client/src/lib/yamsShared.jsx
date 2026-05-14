import { useEffect, useState } from 'react'
import { C, statusColor } from '../styles/tokens'

const API_PREFIX = '/api'

export { C, statusColor }

export function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatSysUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatBytes(bytes) {
  if (bytes == null) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

export function formatRelTime(ts) {
  if (!ts) return '—'
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime()
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function useGravatar(email, size = 80) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    // Only compute once the user has typed a plausible email address.
    if (!email || !email.includes('@')) { setUrl(null); return }

    let cancelled = false

    if (!crypto?.subtle) {
      // Non-HTTPS / non-localhost context — crypto.subtle unavailable, skip silently.
      return
    }

    const encoded = new TextEncoder().encode(email.trim().toLowerCase())
    crypto.subtle.digest('SHA-256', encoded)
      .then(buf => {
        if (cancelled) return
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
        setUrl(`https://gravatar.com/avatar/${hash}?s=${size}&d=identicon`)
      })
      .catch(() => { if (!cancelled) setUrl(null) })

    // Cancel the in-flight promise result when email changes or component unmounts,
    // so rapid typing never applies a stale hash from an earlier keystroke.
    return () => { cancelled = true }
  }, [email, size])
  return url
}

export function apiUrl(path) {
  if (!path) return path
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith(`${API_PREFIX}/`)) return path
  return `${API_PREFIX}${path.startsWith('/') ? '' : '/'}${path}`
}

// Singleton promise: if a refresh is already in-flight, callers share it.
let _refreshing = null

async function doRefresh() {
  const rt = sessionStorage.getItem('yams_refresh_token')
  if (!rt) throw new Error('no_refresh_token')
  const res = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  })
  if (!res.ok) throw new Error('refresh_failed')
  const body = await res.json()
  sessionStorage.setItem('yams_token', body.data.token)
  if (body.data.refreshToken) sessionStorage.setItem('yams_refresh_token', body.data.refreshToken)
}

function forceLogout() {
  sessionStorage.removeItem('yams_token')
  sessionStorage.removeItem('yams_refresh_token')
  sessionStorage.removeItem('yams_user')
  window.dispatchEvent(new CustomEvent('yams-auth-logout'))
}

export async function apiFetch(path, opts = {}) {
  const token = sessionStorage.getItem('yams_token')
  const method = opts.method || 'GET'
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  }

  const url = apiUrl(path)
  console.log(`[YAMS] → ${method} ${url}`)

  const res = await fetch(url, { ...opts, headers })
  let body
  try { body = await res.json() } catch { body = {} }

  console.log(`[YAMS] ← ${res.status} ${url}`, body)

  if (res.status === 401) {
    // Attempt a silent token refresh, then replay the original request once.
    try {
      if (!_refreshing) _refreshing = doRefresh().finally(() => { _refreshing = null })
      await _refreshing
    } catch {
      forceLogout()
      throw new Error('Session expired. Please sign in again.')
    }

    const newToken = sessionStorage.getItem('yams_token')
    const retryRes = await fetch(url, { ...opts, headers: { ...headers, Authorization: `Bearer ${newToken}` } })
    let retryBody
    try { retryBody = await retryRes.json() } catch { retryBody = {} }

    if (retryRes.status === 401) {
      forceLogout()
      throw new Error('Session expired. Please sign in again.')
    }
    if (retryRes.status === 403) throw new Error(retryBody.error || 'Access denied')
    if (!retryRes.ok) throw new Error(retryBody.error || `HTTP ${retryRes.status}`)
    return retryBody
  }

  if (res.status === 403) {
    throw new Error(body.error || 'Access denied')
  }

  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`)
  }

  return body
}

export function useHashRouter() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const path = hash.replace(/^#/, '') || '/'
  const consoleMatch = path.match(/^\/console\/(.+)$/)
  const serverMatch = path.match(/^\/server\/(.+)$/)
  return {
    path,
    serverId: consoleMatch ? consoleMatch[1] : null,
    serverPageId: serverMatch ? serverMatch[1] : null,
    navigate: (to) => { window.location.hash = to },
  }
}

export function StatusDot({ status }) {
  const color = statusColor(status)
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: status === 'running' ? `0 0 6px ${color}88` : 'none',
    }} />
  )
}

export function ErrorBanner({ message }) {
  if (!message) return null
  return (
    <div style={{
      position: 'fixed', top: 48, left: 0, right: 0, zIndex: 200,
      background: `${C.red}18`, borderBottom: `1px solid ${C.red}44`,
      color: C.red, fontSize: 13, fontWeight: 500,
      padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ fontSize: 10 }}>●</span>
      {message}
    </div>
  )
}

export function EmptyState({ message }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '64px 24px', color: C.dim, gap: 8,
    }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>▣</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{message || 'No data'}</div>
    </div>
  )
}
