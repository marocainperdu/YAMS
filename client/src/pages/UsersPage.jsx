import React from 'react'
import { apiFetch, C, EmptyState } from '../lib/yamsShared'

const ROLES = {
  admin: { label: 'Admin', color: '#a371f7', desc: 'Full access to everything' },
  operator: { label: 'Operator', color: '#388bfd', desc: 'Can manage servers & consoles' },
  moderator: { label: 'Moderator', color: '#d29922', desc: 'Can manage worlds & files' },
  viewer: { label: 'Viewer', color: '#8b949e', desc: 'Read-only access' },
}

const PERMISSIONS = [
  { id: 'start_stop', label: 'Start / Stop servers' },
  { id: 'console', label: 'Access console' },
  { id: 'worlds', label: 'Manage worlds & files' },
  { id: 'create_delete', label: 'Create / delete servers' },
  { id: 'manage_users', label: 'Manage other users' },
  { id: 'view_only', label: 'View-only mode' },
]

const ROLE_PERMS = {
  admin: ['start_stop', 'console', 'worlds', 'create_delete', 'manage_users'],
  operator: ['start_stop', 'console', 'worlds'],
  moderator: ['console', 'worlds'],
  viewer: ['view_only'],
}


function RoleBadge({ role }) {
  const r = ROLES[role] || { label: role, color: C.dim }
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: r.color + '18', border: `1px solid ${r.color}44`, color: r.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {r.label}
    </span>
  )
}

function UserAvatar({ user, size = 32 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: C.surface2, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 600, color: C.muted }}>
      {user.avatar}
    </div>
  )
}

function RolePicker({ value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {Object.entries(ROLES).map(([key, r]) => (
        <div
          key={key}
          onClick={() => onChange(key)}
          style={{ padding: '8px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${value === key ? r.color : C.border}`, background: value === key ? r.color + '12' : 'transparent', transition: 'all 150ms' }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: value === key ? r.color : C.text }}>{r.label}</div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{r.desc}</div>
        </div>
      ))}
    </div>
  )
}

function PermissionPreview({ role }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Permissions</div>
      <div style={{ background: C.surface2, borderRadius: 6, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {PERMISSIONS.map(p => {
          const has = ROLE_PERMS[role]?.includes(p.id)
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: has ? C.text : C.dim }}>
              <span style={{ color: has ? C.green : C.dim, fontSize: 11 }}>{has ? '✓' : '✗'}</span>
              {p.label}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Modal({ onClose, children }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#00000077', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px #00000066' }}>
        {children}
      </div>
    </div>
  )
}

function InviteModal({ onClose, onInvite }) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [role, setRole] = React.useState('user')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [done, setDone] = React.useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    setLoading(true); setError(null)
    try {
      const backendRole = role === 'admin' ? 'admin' : 'user'
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, role: backendRole }),
      })
      setDone(true)
      setTimeout(() => { onInvite(res.data); onClose() }, 900)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inp = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none', width: '100%' }

  return (
    <Modal onClose={onClose}>
      <div style={{ width: 400 }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Create User</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {done
          ? <div style={{ padding: '32px 24px', textAlign: 'center', color: C.green }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>User created: {email}</div>
          </div>
          : <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: C.red }}>{error}</div>}
            <div style={{ background: `${C.amber}10`, border: `1px solid ${C.amber}44`, borderRadius: 6, padding: '8px 12px', fontSize: 11, color: C.amber }}>
              Backend supports <strong>admin</strong> and <strong>user</strong> roles only. Operator/moderator/viewer map to "user".
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" autoFocus style={inp}
                onFocus={e => { e.target.style.borderColor = C.blue }}
                onBlur={e => { e.target.style.borderColor = C.border }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Initial password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" style={inp}
                onFocus={e => { e.target.style.borderColor = C.blue }}
                onBlur={e => { e.target.style.borderColor = C.border }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Role</label>
              <RolePicker value={role} onChange={setRole} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={loading || !email.trim() || !password} style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 6, border: `1px solid ${C.blue}55`, background: `${C.blue}18`, color: C.blue, cursor: (loading || !email.trim() || !password) ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </form>
        }
      </div>
    </Modal>
  )
}

function EditRoleModal({ user, onClose, onSave }) {
  const [role, setRole] = React.useState(user.role)

  return (
    <Modal onClose={onClose}>
      <div style={{ width: 420 }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <UserAvatar user={user} size={36} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{user.email}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{user.email}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Role</div>
            <RolePicker value={role} onChange={setRole} />
          </div>
          <PermissionPreview role={role} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => { onSave(user.id, role); onClose() }} style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 6, border: `1px solid ${C.green}55`, background: `${C.green}18`, color: C.green, cursor: 'pointer' }}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function UsersPage({ currentUser }) {
  const [users, setUsers] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [apiError, setApiError] = React.useState(null)
  const [showInvite, setShowInvite] = React.useState(false)
  const [editUser, setEditUser] = React.useState(null)
  const [search, setSearch] = React.useState('')
  const [hov, setHov] = React.useState(null)
  const [notice, setNotice] = React.useState(null)

  React.useEffect(() => {
    apiFetch('/users')
      .then(res => { setUsers((res.data || []).map(adaptUser)); setLoading(false) })
      .catch(e => { setApiError(e.message); setLoading(false) })
  }, [])

  function adaptUser(u) {
    return {
      id: u.id,
      username: u.username || null,
      email: u.email,
      role: u.role,
      avatar: u.email[0].toUpperCase(),
    }
  }

  function showNotice(msg) { setNotice(msg); setTimeout(() => setNotice(null), 3000) }

  function handleInvite(newUser) {
    setUsers(u => [...u, adaptUser(newUser)])
  }

  function handleRoleSave(id, role) {
    showNotice('Role update is not implemented on the backend (local display only).')
    setUsers(u => u.map(usr => usr.id === id ? { ...usr, role } : usr))
  }

  function handleRemove(id) {
    if (!confirm('Remove this user? (Note: not implemented on backend — local display only)')) return
    setUsers(u => u.filter(usr => usr.id !== id))
  }

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.username && u.username.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onInvite={handleInvite} />}
      {editUser && <EditRoleModal user={editUser} onClose={() => setEditUser(null)} onSave={handleRoleSave} />}

      {apiError && (
        <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.red }}>
          {apiError === 'Access denied' ? 'Access denied — admin role required to manage users.' : apiError}
        </div>
      )}
      {notice && (
        <div style={{ background: `${C.amber}10`, border: `1px solid ${C.amber}44`, borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.amber }}>{notice}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.text }}>Users</h1>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowInvite(true)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.blue}55`, background: `${C.blue}18`, color: C.blue, cursor: 'pointer' }}>+ Create User</button>
      </div>

      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search users…"
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 14px', fontSize: 13, color: C.text, outline: 'none', width: 280 }}
        onFocus={e => { e.target.style.borderColor = C.blue }}
        onBlur={e => { e.target.style.borderColor = C.border }}
      />

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', padding: '10px 16px', background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
          {[['User', '55%'], ['Role', '25%'], ['', '20%']].map(([label, w]) => (
            <div key={label} style={{ width: w, fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
          ))}
        </div>

        {loading
          ? <EmptyState message="Loading users…" />
          : filtered.length === 0
            ? <EmptyState message="No users found" />
            : filtered.map((user, i) => {
              const isHov = hov === user.id
              const isMe = currentUser?.email === user.email
              return (
                <div
                  key={user.id}
                  onMouseEnter={() => setHov(user.id)}
                  onMouseLeave={() => setHov(null)}
                  style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: i < filtered.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: isHov ? C.surface2 : 'transparent', transition: 'background 150ms' }}
                >
                  <div style={{ width: '55%', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <UserAvatar user={user} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {user.username || <span style={{ color: C.dim, fontStyle: 'italic' }}>no username</span>}
                        {isMe && <span style={{ fontSize: 9, color: C.blue, fontWeight: 600, background: `${C.blue}18`, border: `1px solid ${C.blue}44`, borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>you</span>}
                      </div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{user.email}</div>
                    </div>
                  </div>
                  <div style={{ width: '25%' }}><RoleBadge role={user.role} /></div>
                  <div style={{ width: '20%', display: 'flex', gap: 6, justifyContent: 'flex-end', opacity: isHov ? 1 : 0, transition: 'opacity 150ms' }}>
                    <button onClick={() => setEditUser(user)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Edit</button>
                    {!isMe && (
                      <button onClick={() => handleRemove(user.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, cursor: 'pointer' }}>Remove</button>
                    )}
                  </div>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}
