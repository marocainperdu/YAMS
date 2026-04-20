import { NavLink } from 'react-router-dom'

export default function NavBar() {
  return (
    <nav className="flex items-center justify-between px-5 py-3 bg-gray-950 border-b border-gray-800 shrink-0">
      <span className="text-sm font-bold text-white tracking-widest">⬡ YAMS</span>
      <div className="flex gap-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `text-xs px-3 py-1.5 rounded transition-colors duration-150 ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`
          }
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/console"
          className={({ isActive }) =>
            `text-xs px-3 py-1.5 rounded transition-colors duration-150 ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`
          }
        >
          Console
        </NavLink>
      </div>
    </nav>
  )
}
