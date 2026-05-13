import React from 'react'
import { C, apiFetch, useHashRouter } from './lib/yamsShared'
import Dashboard from './pages/Dashboard'
import ConsolePage from './pages/ConsolePage'
import AccountPage from './pages/AccountPage'
import UsersPage from './pages/UsersPage'
import LoginPage from './pages/LoginPage'
import CreateServerPage from './pages/CreateServerPage'
import ServerPage from './pages/ServerPage'

function ForcePasswordChangeOverlay({ onDone }) {
  const [currentPw, setCurrentPw] = React.useState('')
  const [newPw, setNewPw] = React.useState('')
  const [confirmPw, setConfirmPw] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  function strength(pw) {
    let s = 0
    if (pw.length >= 8) s++
    if (/[A-Z]/.test(pw)) s++
    if (/[0-9]/.test(pw)) s++
    if (/[^A-Za-z0-9]/.test(pw)) s++
    return s
  }
  const s = strength(newPw)
  const strengthColors = ['', C.red, C.amber, C.blue, C.green]
  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong']

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (newPw.length < 8) { setError('New password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      await apiFetch('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      sessionStorage.removeItem('yams_force_pw')
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inp = {
    width: '100%', background: C.surface2, border: `1px solid ${C.border}`,
    borderRadius: 7, padding: '10px 14px', fontSize: 14, color: C.text,
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: C.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 420, background: C.surface,
        border: `1px solid ${C.amber}55`, borderRadius: 12,
        boxShadow: `0 0 60px ${C.amber}18`,
      }}>
        <div style={{
          padding: '20px 24px 16px', background: `${C.amber}0d`,
          borderBottom: `1px solid ${C.amber}33`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22, color: C.amber, lineHeight: 1 }}>⚠</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Password change required</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>You must set a new password before continuing.</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '9px 12px', fontSize: 12, color: C.red }}>{error}</div>
          )}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>Current password <span style={{ color: C.dim }}>(printed in server console)</span></label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              placeholder="Enter the generated password" required autoFocus style={inp}
              onFocus={e => { e.target.style.borderColor = C.amber }}
              onBlur={e => { e.target.style.borderColor = C.border }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>New password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="Min 8 characters" required style={inp}
              onFocus={e => { e.target.style.borderColor = C.blue }}
              onBlur={e => { e.target.style.borderColor = C.border }} />
            {newPw.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= s ? strengthColors[s] : C.surface2, transition: 'background 200ms' }} />
                  ))}
                </div>
                <div style={{ fontSize: 11, color: strengthColors[s] || C.dim, marginTop: 4 }}>{strengthLabels[s] || ''}</div>
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>Confirm new password</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              placeholder="Repeat new password" required style={inp}
              onFocus={e => { e.target.style.borderColor = C.blue }}
              onBlur={e => { e.target.style.borderColor = C.border }} />
            {confirmPw && newPw && (
              <div style={{ fontSize: 11, marginTop: 4, color: confirmPw === newPw ? C.green : C.red }}>
                {confirmPw === newPw ? '✓ Passwords match' : '✗ Passwords do not match'}
              </div>
            )}
          </div>
          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '10px', borderRadius: 7, border: 'none',
            background: loading ? C.surface2 : C.amber,
            color: loading ? C.muted : '#0d1117',
            fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
          }}>{loading ? 'Updating…' : 'Set new password'}</button>
        </form>
      </div>
    </div>
  )
}

function AvatarDropdown({ currentUser, navigate, onLogout }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)

  React.useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const initial = (currentUser?.username || currentUser?.email || '?')[0].toUpperCase()

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: open ? C.blue : C.surface2,
          border: `2px solid ${open ? C.blue : C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: open ? '#fff' : C.muted, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', transition: 'all 150ms', overflow: 'hidden',
        }}
      >
        {currentUser?.avatar
          ? <img src={currentUser.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initial}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 40, width: 200,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 8, boxShadow: '0 8px 32px #00000055', zIndex: 200,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentUser?.username || currentUser?.email}
            </div>
            {currentUser?.username && (
              <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                {currentUser?.email}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                background: `${C.blue}22`, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>{currentUser?.role || 'viewer'}</span>
            </div>
          </div>
          <div style={{ padding: '4px 0' }}>
            {[
              { label: 'Account settings', action: () => { navigate('#/account'); setOpen(false) } },
              { label: 'Users', action: () => { navigate('#/users'); setOpen(false) }, show: currentUser?.role === 'admin' },
            ].filter(item => item.show !== false).map(item => (
              <button key={item.label} onClick={item.action} style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 14px', background: 'none', border: 'none',
                fontSize: 13, color: C.text, cursor: 'pointer',
                transition: 'background 100ms',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = C.surface2 }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >{item.label}</button>
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, padding: '4px 0' }}>
            <button onClick={() => { onLogout(); setOpen(false) }} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 14px', background: 'none', border: 'none',
              fontSize: 13, color: C.red, cursor: 'pointer',
              transition: 'background 100ms',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = `${C.red}10` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
            >Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}

function AppNavBar({ currentUser, navigate, onLogout }) {
  const path = window.location.hash
  const isActive = (prefix) => path === prefix || path.startsWith(prefix + '/')

  const navBtn = (label, href) => (
    <button
      key={href}
      onClick={() => navigate(href)}
      style={{
        border: 'none', cursor: 'pointer',
        padding: '4px 10px', borderRadius: 5, fontSize: 13, fontWeight: 500,
        color: isActive(href) ? C.text : C.muted,
        background: isActive(href) ? C.surface2 : 'none',
        transition: 'color 150ms, background 150ms',
      }}
      onMouseEnter={e => { if (!isActive(href)) { e.currentTarget.style.color = C.text } }}
      onMouseLeave={e => { if (!isActive(href)) { e.currentTarget.style.color = C.muted } }}
    >{label}</button>
  )

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 48,
      background: C.surface, borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', padding: '0 20px',
      zIndex: 100, gap: 4,
    }}>
      <button onClick={() => navigate('#/')} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', marginRight: 8, borderRadius: 5,
      }}>
        <span style={{ color: C.green, fontSize: 18, lineHeight: 1 }}>⬡</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>YAMS</span>
      </button>

      {navBtn('Dashboard', '#/')}
      {currentUser?.role === 'admin' && navBtn('Users', '#/users')}

      <div style={{ flex: 1 }} />

      <button
        onClick={() => navigate('#/create-server')}
        style={{
          padding: '5px 14px', borderRadius: 6, border: 'none',
          background: C.green, color: '#0d1117', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', marginRight: 12,
        }}
      >+ New server</button>

      <AvatarDropdown currentUser={currentUser} navigate={navigate} onLogout={onLogout} />
    </nav>
  )
}

export default function App() {
  const { path, serverId, serverPageId, navigate } = useHashRouter()

  const [currentUser, setCurrentUser] = React.useState(() => {
    try {
      const raw = sessionStorage.getItem('yams_user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  const [forcePasswordChange, setForcePasswordChange] = React.useState(
    () => sessionStorage.getItem('yams_force_pw') === 'true'
  )

  React.useEffect(() => {
    const onAutoLogout = () => {
      sessionStorage.removeItem('yams_token')
      sessionStorage.removeItem('yams_user')
      setCurrentUser(null)
    }
    window.addEventListener('yams-auth-logout', onAutoLogout)
    return () => window.removeEventListener('yams-auth-logout', onAutoLogout)
  }, [])

  function handleLogin({ email, userId, role, token, forcePasswordChange: fpc, username }) {
    sessionStorage.setItem('yams_token', token)
    const user = { email, userId, role, username: username ?? null }
    sessionStorage.setItem('yams_user', JSON.stringify(user))
    if (fpc) sessionStorage.setItem('yams_force_pw', 'true')
    else sessionStorage.removeItem('yams_force_pw')
    setCurrentUser(user)
    setForcePasswordChange(!!fpc)
    navigate('#/')
  }

  function handleLogout() {
    sessionStorage.removeItem('yams_token')
    sessionStorage.removeItem('yams_user')
    sessionStorage.removeItem('yams_force_pw')
    setCurrentUser(null)
    setForcePasswordChange(false)
    navigate('#/login')
  }

  function handleUpdateUser(updated) {
    sessionStorage.setItem('yams_user', JSON.stringify(updated))
    setCurrentUser(updated)
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />
  }

  if (forcePasswordChange) {
    return <ForcePasswordChangeOverlay onDone={() => setForcePasswordChange(false)} />
  }

  const isConsole = path.startsWith('/console/')
  const isServer = path.startsWith('/server/')
  const isCreate = path === '/create-server'
  const isUsers = path === '/users'
  const isAccount = path === '/account'
  const showNavBar = !isConsole

  let content
  if (isConsole) {
    content = <ConsolePage serverId={serverId} navigate={navigate} currentUser={currentUser} />
  } else if (isServer) {
    content = <ServerPage serverId={serverPageId} navigate={navigate} />
  } else if (isCreate) {
    content = (
      <CreateServerPage
        onCreated={() => navigate('#/')}
        onCancel={() => navigate('#/')}
      />
    )
  } else if (isUsers) {
    content = <UsersPage currentUser={currentUser} />
  } else if (isAccount) {
    content = <AccountPage currentUser={currentUser} onUpdate={handleUpdateUser} />
  } else {
    content = <Dashboard navigate={navigate} />
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      {showNavBar && (
        <AppNavBar currentUser={currentUser} navigate={navigate} onLogout={handleLogout} />
      )}
      {isConsole
        ? content
        : <div style={{ paddingTop: showNavBar ? 48 : 0 }}>{content}</div>
      }
    </div>
  )
}
