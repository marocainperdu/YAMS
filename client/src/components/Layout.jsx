import { Outlet } from 'react-router-dom'
import NavBar from './NavBar'
import { C } from '../styles/tokens'

export default function Layout() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', background: C.bg, color: C.text, overflow: 'hidden',
    }}>
      <NavBar />
      {/* 48px NavBar is fixed; push content below it */}
      <div style={{ flex: 1, overflow: 'hidden', paddingTop: 48 }}>
        <Outlet />
      </div>
    </div>
  )
}
