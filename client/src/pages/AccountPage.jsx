import React from 'react'
import { apiFetch, C } from '../lib/yamsShared'

export default function AccountPage({ currentUser, onUpdate }) {
  const [tab, setTab] = React.useState('profile')

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'password', label: 'Password' },
    { id: 'twofa', label: 'Two-Factor Auth' },
    { id: 'tokens', label: 'API Tokens' },
  ]

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 24px' }}>Account Settings</h1>

      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 28 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '9px 18px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            color: tab === t.id ? C.text : C.muted,
            borderBottom: `2px solid ${tab === t.id ? C.blue : 'transparent'}`,
            marginBottom: -1, transition: 'color 150ms, border-color 150ms',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab currentUser={currentUser} onUpdate={onUpdate} />}
      {tab === 'password' && <PasswordTab />}
      {tab === 'twofa' && <TwoFATab currentUser={currentUser} />}
      {tab === 'tokens' && <APITokenTab />}
    </div>
  )
}

function ProfileTab({ currentUser, onUpdate }) {
  const [name, setName] = React.useState(currentUser?.username || '')
  const [email, setEmail] = React.useState(currentUser?.email || '')
  const [saved, setSaved] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  async function handleSave(e) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setLoading(true)
    try {
      const updated = await apiFetch('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ username: name, email }),
      })
      setSaved(true)
      onUpdate && onUpdate({ ...currentUser, username: updated.data.username, email: updated.data.email })
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inp = {
    width: '100%', background: C.surface2, border: `1px solid ${C.border}`,
    borderRadius: 7, padding: '9px 13px', fontSize: 14, color: C.text,
    outline: 'none', boxSizing: 'border-box',
  }
  const Label = ({ children }) => (
    <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>{children}</label>
  )

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '9px 12px', fontSize: 12, color: C.red }}>{error}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 4 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', background: C.surface2,
          border: `2px solid ${C.border}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 24, color: C.muted, flexShrink: 0,
        }}>
          {currentUser?.avatar
            ? <img src={currentUser.avatar} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : (name || currentUser?.username || '?')[0].toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Profile picture</div>
          <div style={{ fontSize: 12, color: C.muted }}>Avatar upload — coming soon</div>
        </div>
      </div>

      <div>
        <Label>Display name</Label>
        <input value={name} onChange={e => setName(e.target.value)} style={inp}
          onFocus={e => { e.target.style.borderColor = C.blue }}
          onBlur={e => { e.target.style.borderColor = C.border }}
          placeholder="Your name" />
      </div>

      <div>
        <Label>Email address</Label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp}
          onFocus={e => { e.target.style.borderColor = C.blue }}
          onBlur={e => { e.target.style.borderColor = C.border }}
          placeholder="you@example.com" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="submit" disabled={loading} style={{
          padding: '9px 22px', borderRadius: 7, border: 'none',
          background: loading ? C.surface2 : C.blue, color: loading ? C.muted : '#fff',
          fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
        }}>{loading ? 'Saving…' : 'Save changes'}</button>
        {saved && <span style={{ fontSize: 12, color: C.green }}>✓ Saved</span>}
      </div>
    </form>
  )
}

function EyeIcon({ open }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

function PasswordField({ value, onChange, placeholder }) {
  const [show, setShow] = React.useState(false)
  const inp = {
    flex: 1, background: C.surface2, border: 'none',
    padding: '9px 13px', fontSize: 14, color: C.text,
    outline: 'none', minWidth: 0,
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: C.surface2, border: `1px solid ${C.border}`,
      borderRadius: 7, overflow: 'hidden',
    }}
      onFocusCapture={e => e.currentTarget.style.borderColor = C.blue}
      onBlurCapture={e => e.currentTarget.style.borderColor = C.border}
    >
      <input
        type={show ? 'text' : 'password'}
        value={value} onChange={onChange}
        placeholder={placeholder}
        style={inp}
      />
      <button type="button" onClick={() => setShow(s => !s)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '0 12px', color: show ? C.blue : C.muted,
        display: 'flex', alignItems: 'center', flexShrink: 0,
      }} tabIndex={-1}>
        <EyeIcon open={show} />
      </button>
    </div>
  )
}

function PasswordTab() {
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState(null)

  function strength(pw) {
    let s = 0
    if (pw.length >= 8) s++
    if (/[A-Z]/.test(pw)) s++
    if (/[0-9]/.test(pw)) s++
    if (/[^A-Za-z0-9]/.test(pw)) s++
    return s
  }

  const s = strength(next)
  const strengthColors = ['', C.red, C.amber, C.blue, C.green]
  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong']

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    if (!current) return setError('Current password is required.')
    if (next.length < 8) return setError('New password must be at least 8 characters.')
    if (next !== confirm) return setError('Passwords do not match.')
    setLoading(true)
    try {
      await apiFetch('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      setSaved(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const Label = ({ children }) => (
    <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>{children}</label>
  )

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '9px 12px', fontSize: 12, color: C.red }}>{error}</div>
      )}

      <div>
        <Label>Current password</Label>
        <PasswordField value={current} onChange={e => setCurrent(e.target.value)} />
      </div>

      <div>
        <Label>New password</Label>
        <PasswordField value={next} onChange={e => setNext(e.target.value)} />
        {next.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 3, 4].map(i => (
                <div key={i} style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: i <= s ? strengthColors[s] : C.surface2,
                  transition: 'background 200ms',
                }} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: strengthColors[s] || C.dim, marginTop: 4 }}>{strengthLabels[s] || ''}</div>
          </div>
        )}
      </div>

      <div>
        <Label>Confirm new password</Label>
        <PasswordField value={confirm} onChange={e => setConfirm(e.target.value)} />
        {confirm && next && (
          <div style={{ fontSize: 11, marginTop: 4, color: confirm === next ? C.green : C.red }}>
            {confirm === next ? '✓ Passwords match' : '✗ Passwords do not match'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="submit" disabled={loading} style={{
          padding: '9px 22px', borderRadius: 7, border: 'none',
          background: loading ? C.surface2 : C.blue, color: loading ? C.muted : '#fff',
          fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
        }}>{loading ? 'Updating…' : 'Update password'}</button>
        {saved && <span style={{ fontSize: 12, color: C.green }}>✓ Password updated</span>}
      </div>
    </form>
  )
}

function TwoFATab({ currentUser }) {
  // phase: 'loading' | 'idle' | 'setup' | 'disabling' | 'enabled'
  const [phase, setPhase] = React.useState('loading')
  const [setupData, setSetupData] = React.useState(null) // { secret, otpauthUri }
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    apiFetch('/auth/me').then(res => {
      setPhase(res.data?.totpEnabled ? 'enabled' : 'idle')
    }).catch(() => setPhase('idle'))
  }, [])

  async function handleSetup() {
    setError(null)
    setLoading(true)
    try {
      const res = await apiFetch('/auth/2fa/setup', { method: 'POST' })
      setSetupData(res.data)
      setPhase('setup')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleEnable(e) {
    e.preventDefault()
    setError(null)
    if (code.length !== 6) { setError('Enter the 6-digit code.'); return }
    setLoading(true)
    try {
      await apiFetch('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) })
      setPhase('enabled')
      setCode('')
      setSetupData(null)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleDisable(e) {
    e.preventDefault()
    setError(null)
    if (code.length !== 6) { setError('Enter the 6-digit code to confirm.'); return }
    setLoading(true)
    try {
      await apiFetch('/auth/2fa', { method: 'DELETE', body: JSON.stringify({ code }) })
      setPhase('idle')
      setCode('')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const sectionStyle = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }
  const codeInput = {
    width: 140, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7,
    padding: '9px 13px', fontSize: 20, letterSpacing: '0.25em', color: C.text,
    outline: 'none', fontFamily: 'monospace', textAlign: 'center',
  }

  if (phase === 'loading') return (
    <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>
  )

  if (phase === 'enabled') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${C.green}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.green, fontSize: 16 }}>✓</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Two-factor authentication is enabled</div>
            <div style={{ fontSize: 12, color: C.muted }}>Your account is protected with TOTP.</div>
          </div>
        </div>
        <button onClick={() => { setPhase('disabling'); setCode(''); setError(null) }}
          style={{ padding: '8px 18px', borderRadius: 7, border: `1px solid ${C.red}66`, background: 'none', color: C.red, fontSize: 13, cursor: 'pointer' }}>
          Disable 2FA
        </button>
      </div>
    </div>
  )

  if (phase === 'disabling') return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Disable two-factor authentication</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Enter the 6-digit code from your authenticator app to confirm.</div>
      {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{error}</div>}
      <form onSubmit={handleDisable} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000" maxLength={6} autoFocus style={codeInput}
          onFocus={e => { e.target.style.borderColor = C.red }}
          onBlur={e => { e.target.style.borderColor = C.border }} />
        <button type="submit" disabled={loading} style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: loading ? C.surface2 : C.red, color: loading ? C.muted : '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Disabling…' : 'Disable 2FA'}
        </button>
        <button type="button" onClick={() => { setPhase('enabled'); setCode(''); setError(null) }}
          style={{ padding: '9px 14px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'none', color: C.muted, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </form>
    </div>
  )

  if (phase === 'setup' && setupData) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setupData.otpauthUri)}`
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={sectionStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>1. Scan QR code</div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <img src={qrUrl} alt="TOTP QR" style={{ width: 180, height: 180, borderRadius: 8, background: '#fff', padding: 4 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Or enter this key manually in your app:</div>
              <div style={{ fontFamily: 'monospace', fontSize: 13, color: C.text, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', letterSpacing: '0.1em', wordBreak: 'break-all' }}>
                {setupData.secret}
              </div>
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>2. Verify & activate</div>
          {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{error}</div>}
          <form onSubmit={handleEnable} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" maxLength={6} autoFocus style={codeInput}
              onFocus={e => { e.target.style.borderColor = C.blue }}
              onBlur={e => { e.target.style.borderColor = C.border }} />
            <button type="submit" disabled={loading || code.length !== 6} style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: loading ? C.surface2 : C.green, color: loading ? C.muted : '#0d1117', fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'Verifying…' : 'Verify & enable'}
            </button>
            <button type="button" onClick={() => { setPhase('idle'); setSetupData(null); setError(null); setCode('') }}
              style={{ padding: '9px 14px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'none', color: C.muted, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </form>
        </div>
      </div>
    )
  }

  // idle
  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>Two-factor authentication</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
        Add an extra layer of security. Once enabled, you'll need a code from your authenticator app each time you sign in.
      </div>
      {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{error}</div>}
      <button onClick={handleSetup} disabled={loading}
        style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: loading ? C.surface2 : C.blue, color: loading ? C.muted : '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
        {loading ? 'Loading…' : 'Set up 2FA'}
      </button>
    </div>
  )
}

function APITokenTab() {
  const [tokens, setTokens] = React.useState([
    { id: 1, name: 'CLI access', created: '2026-04-01', lastUsed: '2026-04-30' },
    { id: 2, name: 'Grafana exporter', created: '2026-03-12', lastUsed: '2026-04-29' },
  ])
  const [newName, setNewName] = React.useState('')
  const [generated, setGenerated] = React.useState(null)
  const [copied, setCopied] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [showForm, setShowForm] = React.useState(false)

  function handleGenerate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setLoading(true)
    setTimeout(() => {
      const token = 'yams_' + Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('')
      const entry = { id: Date.now(), name: newName.trim(), created: new Date().toISOString().slice(0, 10), lastUsed: 'Never' }
      setTokens(t => [...t, entry])
      setGenerated(token)
      setNewName('')
      setLoading(false)
      setShowForm(false)
    }, 600)
  }

  function handleRevoke(id) {
    setTokens(t => t.filter(x => x.id !== id))
  }

  function handleCopy() {
    navigator.clipboard.writeText(generated).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const rowStyle = { display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${C.border}` }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: `${C.amber}10`, border: `1px solid ${C.amber}44`, borderRadius: 6, padding: '9px 12px', fontSize: 12, color: C.amber }}>
        ⚠ FRONTEND MOCK — API token management is not implemented on the backend. Tokens shown here are not real.
      </div>
      {generated && (
        <div style={{ background: `${C.green}10`, border: `1px solid ${C.green}44`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.green, marginBottom: 8 }}>Token generated — copy it now. It won't be shown again.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.text, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', wordBreak: 'break-all' }}>{generated}</code>
            <button onClick={handleCopy} style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'none', color: copied ? C.green : C.muted, fontSize: 12, cursor: 'pointer' }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button onClick={() => setGenerated(null)} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: 'none', color: C.dim, fontSize: 12, cursor: 'pointer' }}>✕</button>
          </div>
        </div>
      )}

      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>API Tokens ({tokens.length})</span>
          {!showForm && (
            <button onClick={() => setShowForm(true)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: C.blue, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ New token</button>
          )}
        </div>

        {showForm && (
          <form onSubmit={handleGenerate} style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'center', background: C.bg, flexWrap: 'wrap' }}>
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Token name (e.g. CLI access)"
              style={{ flex: 1, minWidth: 180, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none' }}
              onFocus={e => { e.target.style.borderColor = C.blue }}
              onBlur={e => { e.target.style.borderColor = C.border }}
              autoFocus
            />
            <button type="submit" disabled={loading || !newName.trim()} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: C.blue, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {loading ? 'Generating…' : 'Generate'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setNewName('') }} style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'none', color: C.muted, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </form>
        )}

        <div style={{ padding: '0 18px' }}>
          {tokens.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: C.muted }}>No tokens yet.</div>
          )}
          {tokens.map((tk, i) => (
            <div key={tk.id} style={{ ...rowStyle, borderBottom: i < tokens.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{tk.name}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Created {tk.created} · Last used {tk.lastUsed}</div>
              </div>
              <button onClick={() => handleRevoke(tk.id)} style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.red}66`, background: 'none', color: C.red, fontSize: 12, cursor: 'pointer' }}>Revoke</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
