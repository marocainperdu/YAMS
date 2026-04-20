# YAMS Dashboard — Design Spec

**Date:** 2026-04-16  
**Status:** Approved  
**Scope:** Real-time monitoring dashboard for the YAMS Minecraft server management panel

---

## 1. Problem

The existing YAMS frontend is a single-page console UI with no overview of system health. There is no way to see at a glance how many servers are running, how many clients are connected, or whether there are backpressure issues — without reading raw logs or hitting the API manually.

---

## 2. Goal

Add a production-quality monitoring dashboard that gives operators an instant read on system state, refreshes in real time, and navigates cleanly to per-server console views.

---

## 3. Architecture

### 3.1 Routing

Install `react-router-dom`. Two routes:

| Route | Component | Description |
|---|---|---|
| `/` | `Dashboard` | System overview — metrics, server table, activity feed |
| `/console/:id` | `ConsolePage` | Existing console UI, scoped to a single server |

`App.jsx` becomes the router shell (nav bar + `<Outlet>`). The existing console logic moves into `ConsolePage`.

### 3.2 Backend — new `/metrics` endpoint

`GET /metrics` — returns a JSON snapshot of system state. Composed from two sources:

- `src/utils/observability.js` → `getObservability()` for uptime, active clients, pending clients
- `src/models/serverModel.js` → `findAll()` for server list and status counts
- `src/websocket/wsServer.js` → exported `droppedMessages` counter

Response shape:
```json
{
  "uptime": 123456,
  "servers": {
    "total": 3,
    "running": 2,
    "stopped": 1,
    "crashed": 0,
    "list": [
      { "id": "...", "name": "survival-smp", "status": "running", "port": 25565, "clients": 5, "uptime": 54321 }
    ]
  },
  "clients": {
    "active": 12,
    "pending": 2
  },
  "backpressure": {
    "droppedMessages": 84
  }
}
```

Added to `src/routes/serverRoutes.js` (or a new `metricsRoutes.js`) and mounted in `app.js`.

### 3.3 Frontend component tree

```
App (RouterProvider)
├── NavBar                        — YAMS logo + Dashboard/Console nav links
├── / → Dashboard
│   ├── MetricCard × 5            — total, running, clients, pending, dropped
│   ├── ServerTable               — one row per server, clickable → /console/:id
│   ├── SystemPanel               — uptime, health bar, last refreshed
│   └── ActivityFeed              — last N log lines across all servers (optional)
└── /console/:id → ConsolePage
    ├── Sidebar                   — server list (existing)
    ├── Console                   — xterm output (existing)
    └── CommandInput              — command bar (existing)
```

---

## 4. Data Fetching

- Dashboard polls `GET /api/metrics` every **3 seconds** via `setInterval` inside a `useDashboard` hook.
- No WebSocket for metrics — polling is simpler and the data volume is tiny.
- `useDashboard` returns `{ data, loading, error }`. On error, retries automatically on next interval tick; shows an error banner but does not clear stale data.
- Server list for the console sidebar continues to poll `GET /api/servers` every 30s (unchanged).

---

## 5. Components

### MetricCard
Props: `icon`, `value`, `label`, `color` (`green` | `blue` | `amber` | `red` | `default`)  
Behaviour: value animates with a CSS `transition` on change (scale + color flash). No extra library needed.

### ServerTable
Props: `servers[]`, `clientsPerServer` (map from metrics), `onOpenConsole(id)`  
Columns: Name, Status badge, Clients, Uptime, Action button  
Status badge colors: `running` → green, `stopped` → gray, `crashed` → red  
Clicking "Open →" or the row navigates to `/console/:id`.

### SystemPanel
Props: `uptime`, `running`, `total`  
Shows: formatted uptime string, health ratio bar, "last refreshed" relative timestamp.

### ActivityFeed
Props: `logs[]` (last 20 lines, passed from `useDashboard`)  
Rendered as a monospace list. Optional — included in v1 since the backend already buffers 100 log lines per server in the `processes` Map; the `/metrics` endpoint can include the last 5 lines from each running server.

### NavBar
Static. `Dashboard` link → `/`, `Console` link → `/console` (redirects to last selected server or shows empty state).

---

## 6. State Management

No new state library. All dashboard state lives in `useDashboard`:

```js
const { data, loading, error } = useDashboard()   // polls /api/metrics
```

Console state stays in `useWebSocket` (unchanged). No global store needed.

---

## 7. Styling

- Extends existing Tailwind v4 dark palette (`gray-950` / `gray-900` / `gray-800`)
- Status colors reuse existing `STATUS_COLORS` pattern from `Sidebar.jsx`
- Metric card accent borders: left `3px solid` in the card's theme color
- Hover effects: `hover:bg-gray-800` on table rows, `hover:scale-[1.01]` on cards
- Responsive: metric cards grid collapses `5→3→2` at `md` and `sm` breakpoints

---

## 8. Error Handling

| Scenario | Behaviour |
|---|---|
| `/metrics` fetch fails | Show `ErrorBanner` above metric cards; keep stale data visible; retry on next interval |
| `/metrics` returns partial data | Graceful defaults (0 for counts, empty array for server list) |
| Server not found at `/console/:id` | Redirect to `/` with a toast |
| WebSocket disconnected | Existing reconnect logic unchanged |

---

## 9. Loading State

- First load: skeleton shimmer on each `MetricCard` and table rows (CSS `animate-pulse`)
- Subsequent refreshes: silent background update, no loading indicator

---

## 10. Files Changed / Created

### Backend
| File | Change |
|---|---|
| `src/routes/metricsRoutes.js` | New — `GET /metrics` handler |
| `src/websocket/wsServer.js` | Export `droppedMessages` counter |
| `app.js` | Mount `/metrics` route |

### Frontend
| File | Change |
|---|---|
| `client/package.json` | Add `react-router-dom` |
| `client/src/App.jsx` | Refactor into router shell with NavBar |
| `client/src/pages/Dashboard.jsx` | New — dashboard page |
| `client/src/pages/ConsolePage.jsx` | New — wraps existing console UI |
| `client/src/components/MetricCard.jsx` | New |
| `client/src/components/ServerTable.jsx` | New |
| `client/src/components/SystemPanel.jsx` | New |
| `client/src/components/ActivityFeed.jsx` | New |
| `client/src/components/NavBar.jsx` | New |
| `client/src/hooks/useDashboard.js` | New — polls `/api/metrics` |

---

## 11. Out of Scope

- Authentication
- Server create/delete from the dashboard
- Historical metrics / charting
- WebSocket-pushed metrics (polling is sufficient for this data volume)
