# YAMS Client — Minecraft Server Manager UI

Professional real-time web console for managing Minecraft servers.

## Features

- **Real-time console** with xterm.js terminal emulation
- **WebSocket integration** with auto-reconnection
- **Server management** UI with status indicators
- **Live log streaming** (stdout/stderr differentiation)
- **Command input** with history
- **Error handling** and toast notifications
- **Dark terminal theme** for production use

## Quick Start

```bash
npm install
npm run dev
# Opens at http://localhost:5173
```

## Environment

Create `.env.local`:

```
VITE_WS_URL=ws://localhost:3001
VITE_API_URL=http://localhost:3000
VITE_LOG_LINES=1000
```

## Build

```bash
npm run build
npm run preview
```

## Architecture

- **Hooks**: useWebSocket (connection state), useXTerm (terminal lifecycle)
- **Components**: Sidebar, Console, CommandInput, StatusBar, Toast
- **Services**: Low-level WebSocket wrapper
- **Styling**: TailwindCSS v4 + custom xterm.js theming

## Backend Integration

Connects to backend on:
- REST: http://localhost:3000
- WebSocket: ws://localhost:3001

No changes needed to backend — frontend is plug-and-play.
