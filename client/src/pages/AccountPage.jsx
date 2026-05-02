import { useState, useEffect } from 'react'
import { C } from '../styles/tokens'

const TOKEN_KEY = 'yams_token'

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const card = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: C.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle = {
  background: C.surface2,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 13,
  color: C.text,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const btnStyle = {
  alignSelf: 'flex-end',
  background: C.surface2,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '6px 18px',
  fontSize: 13,
  color: C.text,
  cursor: 'pointer',
  transition: 'border-color 150ms',
}

function StatusLine({ status }) {
  if (!status) return null
  return (
    <span style={{ fontSize: 12, color: status.type === 'success' ? C.green : C.red }}>
      {status.type === 'success' ? '✓ ' : '✕ '}{status.msg}
    </span>
  )
}

export default function AccountPage() {
  const [user, setUser]           = useState(null)
  const [loadError, setLoadError] = useState(null)

  const [username, setUsername]           = useState('')
  const [usernameStatus, setUsernameStatus] = useState(null)
  const [usernameLoading, setUsernameLoading] = useState(false)

  const [email, setEmail]           = useState('')
  const [emailStatus, setEmailStatus] = useState(null)
  const [emailLoading, setEmailLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me', { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setLoadError(data.error); return }
        setUser(data.data)
        setUsername(data.data.username ?? '')
        setEmail(data.data.email ?? '')
      })
      .catch(() => setLoadError('Impossible de charger le profil'))
  }, [])

  async function saveField(field, value, setStatus, setLoading) {
    setLoading(true)
    setStatus(null)
    try {
      const r = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ [field]: value }),
      })
      const data = await r.json()
      if (!r.ok) {
        setStatus({ type: 'error', msg: data.error || 'Erreur' })
      } else {
        setUser(prev => ({ ...prev, ...data.data }))
        setStatus({ type: 'success', msg: 'Mis à jour' })
      }
    } catch {
      setStatus({ type: 'error', msg: 'Erreur réseau' })
    } finally {
      setLoading(false)
    }
  }

  if (loadError) {
    return (
      <div style={{ padding: 40, color: C.red, fontSize: 13 }}>
        {loadError}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 8 }}>
        Mon compte
      </h1>
      {user && (
        <p style={{ fontSize: 12, color: C.muted, marginBottom: 28 }}>
          {user.email} · {user.role}
        </p>
      )}

      {/* Username */}
      <form
        onSubmit={e => { e.preventDefault(); saveField('username', username.trim(), setUsernameStatus, setUsernameLoading) }}
        style={card}
      >
        <label style={labelStyle}>Nom d'affichage</label>
        <input
          value={username}
          onChange={e => { setUsername(e.target.value); setUsernameStatus(null) }}
          placeholder="Votre nom"
          disabled={!user || usernameLoading}
          style={inputStyle}
        />
        <StatusLine status={usernameStatus} />
        <button type="submit" disabled={!user || usernameLoading} style={btnStyle}>
          {usernameLoading ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>

      {/* Email */}
      <form
        onSubmit={e => { e.preventDefault(); saveField('email', email.trim(), setEmailStatus, setEmailLoading) }}
        style={{ ...card, marginTop: 16 }}
      >
        <label style={labelStyle}>Adresse email</label>
        <input
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setEmailStatus(null) }}
          placeholder="email@exemple.com"
          disabled={!user || emailLoading}
          style={inputStyle}
        />
        <StatusLine status={emailStatus} />
        <button type="submit" disabled={!user || emailLoading} style={btnStyle}>
          {emailLoading ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </div>
  )
}
