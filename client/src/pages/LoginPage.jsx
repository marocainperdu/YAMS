import React from 'react'
import { C, apiUrl } from '../lib/yamsShared'

export default function LoginPage({ onLogin }) {
  const [tab, setTab] = React.useState('login')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [showPass, setShowPass] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [totpRequired, setTotpRequired] = React.useState(false)
  const [totpCode, setTotpCode] = React.useState('')

  async function submitLogin(totpCodeValue) {
    setError(null)
    setLoading(true)
    try {
      const body_req = { username, password }
      if (totpCodeValue) body_req.totpCode = totpCodeValue
      const res = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body_req),
      })
      const body = await res.json().catch(() => ({}))
      console.log('[YAMS] POST /auth/login →', res.status, body)
      if (!res.ok) { setError(body.error || 'Login failed. Check your credentials.'); return }

      if (body.data?.requiresTOTP) { setTotpRequired(true); return }

      const token = body.data?.token
      if (!token) { setError('Unexpected server response.'); return }

      const [, seg] = token.split('.')
      const payload = JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/')))
      onLogin({ id: payload.userId, role: payload.role, token, refreshToken: body.data?.refreshToken ?? null, forcePasswordChange: !!body.data?.forcePasswordChange, username: body.data?.username ?? username })
    } catch {
      setError('Could not reach the server. Is YAMS running?')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    if (!username || !password) { setError('Username and password are required.'); return }
    await submitLogin(null)
  }

  async function handleTotp(e) {
    e.preventDefault()
    if (totpCode.length !== 6) { setError('Enter the 6-digit code.'); return }
    await submitLogin(totpCode)
  }

  function handleForgot(e) {
    e.preventDefault()
    setSent(true)
  }

  const inputStyle = {
    width: '100%', background: C.surface2,
    border: `1px solid ${C.border}`, borderRadius: 7,
    padding: '10px 14px', fontSize: 14, color: C.text,
    outline: 'none', transition: 'border-color 150ms',
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
        <span style={{ color: C.green, fontSize: 28 }}>⬡</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>YAMS</span>
      </div>

      <div style={{ width: '100%', maxWidth: 380, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 40px #00000044' }}>
        {totpRequired ? (
          <div style={{ padding: '28px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Two-factor authentication</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>Enter the 6-digit code from your authenticator app.</div>
            {error && (
              <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '9px 12px', fontSize: 12, color: C.red, marginBottom: 16 }}>{error}</div>
            )}
            <form onSubmit={handleTotp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" maxLength={6} autoFocus
                style={{ ...inputStyle, fontSize: 22, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'monospace', paddingRight: 14 }}
                onFocus={e => { e.target.style.borderColor = C.blue }}
                onBlur={e => { e.target.style.borderColor = C.border }}
              />
              <button type="submit" disabled={loading || totpCode.length !== 6} style={{ padding: '10px', borderRadius: 7, border: 'none', background: loading ? C.surface2 : C.blue, color: loading ? C.muted : '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button type="button" onClick={() => { setTotpRequired(false); setTotpCode(''); setError(null) }} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer' }}>
                ← Back
              </button>
            </form>
          </div>
        ) : (<>
        <div style={{ padding: '24px 28px 0', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex' }}>
            {['login', 'forgot'].map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); setSent(false) }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? C.text : C.muted,
                  borderBottom: `2px solid ${tab === t ? C.blue : 'transparent'}`,
                  transition: 'color 150ms, border-color 150ms', marginBottom: -1,
                }}
              >{t === 'login' ? 'Sign in' : 'Reset password'}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: '24px 28px' }}>
          {error && (
            <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '9px 12px', fontSize: 12, color: C.red, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Username</label>
                <input
                  type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="admin" autoFocus autoComplete="username"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = C.blue }}
                  onBlur={e => { e.target.style.borderColor = C.border }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{ ...inputStyle, paddingRight: 48 }}
                    onFocus={e => { e.target.style.borderColor = C.blue }}
                    onBlur={e => { e.target.style.borderColor = C.border }}
                  />
                  <button
                    type="button" onClick={() => setShowPass(s => !s)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.dim, fontSize: 12, padding: 2 }}
                  >{showPass ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              <button
                type="submit" disabled={loading}
                style={{ marginTop: 4, padding: '10px', borderRadius: 7, border: 'none', background: loading ? C.surface2 : C.blue, color: loading ? C.muted : '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', transition: 'background 150ms' }}
              >{loading ? 'Signing in…' : 'Sign in'}</button>
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <button type="button" onClick={() => { setTab('forgot'); setError(null) }} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer' }}>
                  Forgot your password?
                </button>
              </div>
            </form>
          )}

          {tab === 'forgot' && (
            sent
              ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                <div style={{ fontSize: 28, color: C.amber }}>⚠</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Not available</div>
                <div style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>Password reset is not implemented on the backend. Contact your administrator.</div>
                <button onClick={() => { setTab('login'); setSent(false) }} style={{ marginTop: 8, fontSize: 12, color: C.blue, background: 'none', border: 'none', cursor: 'pointer' }}>← Back to sign in</button>
              </div>
              : <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Enter your username and contact your administrator for a reset.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Username</label>
                  <input
                    type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="admin" autoFocus autoComplete="username"
                    style={inputStyle}
                    onFocus={e => { e.target.style.borderColor = C.blue }}
                    onBlur={e => { e.target.style.borderColor = C.border }}
                  />
                </div>
                <button type="submit" disabled={loading} style={{ padding: '10px', borderRadius: 7, border: 'none', background: loading ? C.surface2 : C.blue, color: loading ? C.muted : '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
          )}
        </div>
        </>)}
      </div>

      <div style={{ marginTop: 24, fontSize: 11, color: C.dim }}>YAMS · Yet Another Minecraft Server manager</div>
    </div>
  )
}
