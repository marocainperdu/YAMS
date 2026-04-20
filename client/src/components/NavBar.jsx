import { NavLink } from 'react-router-dom'
import { C } from '../styles/tokens'

const navLinkStyle = (isActive) => ({
  fontSize: 12,
  fontWeight: 500,
  padding: '4px 10px',
  borderRadius: 5,
  textDecoration: 'none',
  color: isActive ? C.text : C.muted,
  background: isActive ? C.surface2 : 'transparent',
  border: `1px solid ${isActive ? C.border : 'transparent'}`,
  transition: 'all 150ms',
})

export default function NavBar() {
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 48, zIndex: 100,
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: 24,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <a href="/" style={{
        color: C.text, textDecoration: 'none',
        fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: C.green, fontSize: 18, lineHeight: 1 }}>⬡</span>
        YAMS
      </a>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: 4 }}>
        <NavLink to="/" end style={({ isActive }) => navLinkStyle(isActive)}>
          Dashboard
        </NavLink>
        <NavLink to="/console" style={({ isActive }) => navLinkStyle(isActive)}>
          Console
        </NavLink>
      </div>

      <div style={{ flex: 1 }} />

      {/* Version badge */}
      <span style={{
        fontSize: 11, color: C.muted,
        background: C.surface2, border: `1px solid ${C.border}`,
        borderRadius: 4, padding: '2px 8px',
      }}>
        v0.1.0
      </span>

      {/* Avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: C.surface2, border: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: C.muted, cursor: 'default', flexShrink: 0,
      }}>
        A
      </div>
    </nav>
  )
}
