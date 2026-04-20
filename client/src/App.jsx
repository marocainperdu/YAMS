import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ConsolePage from './pages/ConsolePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          {/* /console with no id shows the empty-state sidebar */}
          <Route path="console" element={<ConsolePage />} />
          <Route path="console/:id" element={<ConsolePage />} />
          {/* Catch-all → back to dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
