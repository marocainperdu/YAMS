# Graph Report - .  (2026-04-21)

## Corpus Check
- Corpus is ~23,154 words - fits in a single context window. You may not need a graph.

## Summary
- 220 nodes · 270 edges · 37 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 58 edges (avg confidence: 0.8)
- Token cost: 9,800 input · 4,200 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Error Handling & FS Utils|Error Handling & FS Utils]]
- [[_COMMUNITY_Docker & Storage Config|Docker & Storage Config]]
- [[_COMMUNITY_Core Backend Architecture|Core Backend Architecture]]
- [[_COMMUNITY_WebSocket Log Streaming|WebSocket Log Streaming]]
- [[_COMMUNITY_WebSocket Server & Observability|WebSocket Server & Observability]]
- [[_COMMUNITY_Client Setup & Tooling|Client Setup & Tooling]]
- [[_COMMUNITY_Database Layer|Database Layer]]
- [[_COMMUNITY_Console UI & WebSocket Hook|Console UI & WebSocket Hook]]
- [[_COMMUNITY_Server Table Component|Server Table Component]]
- [[_COMMUNITY_Terminal Console Component|Terminal Console Component]]
- [[_COMMUNITY_Dashboard Page|Dashboard Page]]
- [[_COMMUNITY_Log Persistence|Log Persistence]]
- [[_COMMUNITY_System Panel Component|System Panel Component]]
- [[_COMMUNITY_API Test Suite|API Test Suite]]
- [[_COMMUNITY_Navigation Bar|Navigation Bar]]
- [[_COMMUNITY_Metric Card Component|Metric Card Component]]
- [[_COMMUNITY_Activity Feed Component|Activity Feed Component]]
- [[_COMMUNITY_Application Root|Application Root]]
- [[_COMMUNITY_Command Input Component|Command Input Component]]
- [[_COMMUNITY_Sidebar Component|Sidebar Component]]
- [[_COMMUNITY_Toast Notification|Toast Notification]]
- [[_COMMUNITY_Status Bar Component|Status Bar Component]]
- [[_COMMUNITY_Layout Component|Layout Component]]
- [[_COMMUNITY_CommonJS Rationale|CommonJS Rationale]]
- [[_COMMUNITY_File Manager Plan|File Manager Plan]]
- [[_COMMUNITY_Server Entry Point|Server Entry Point]]
- [[_COMMUNITY_Swagger API Docs|Swagger API Docs]]
- [[_COMMUNITY_Server Routes|Server Routes]]
- [[_COMMUNITY_Metrics Routes|Metrics Routes]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_Tailwind Config|Tailwind Config]]
- [[_COMMUNITY_Vite Config|Vite Config]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_React Entry Point|React Entry Point]]
- [[_COMMUNITY_YAMS Project Overview|YAMS Project Overview]]
- [[_COMMUNITY_WebSocket Heartbeat|WebSocket Heartbeat]]
- [[_COMMUNITY_Dashboard Navbar Design|Dashboard Navbar Design]]

## God Nodes (most connected - your core abstractions)
1. `createServer()` - 13 edges
2. `startServer()` - 12 edges
3. `src/services/serverService.js` - 12 edges
4. `src/services/fileService.js — path resolution + fs ops` - 11 edges
5. `getStmts()` - 9 edges
6. `findById()` - 9 edges
7. `stopServer()` - 8 edges
8. `WSService` - 8 edges
9. `app.js — Express entry point` - 8 edges
10. `YAMS Client — React web UI` - 8 edges

## Surprising Connections (you probably didn't know these)
- `src/services/fileService.js — path resolution + fs ops` --semantically_similar_to--> `src/services/serverService.js`  [INFERRED] [semantically similar]
  docs/superpowers/specs/2026-04-20-file-manager-design.md → CLAUDE.md
- `GET /metrics — system state JSON snapshot` --semantically_similar_to--> `src/utils/observability.js — getObservability()`  [INFERRED] [semantically similar]
  docs/superpowers/specs/2026-04-16-dashboard-design.md → CLAUDE.md
- `pushLog()` --calls--> `queueLog()`  [INFERRED]
  src/services/serverService.js → src/utils/logPersist.js
- `YAMS Client — React web UI` --connects_to--> `app.js — Express entry point`  [EXTRACTED]
  client/README.md → CLAUDE.md
- `Static file serving in app.js — serves client/dist` --modifies--> `app.js — Express entry point`  [EXTRACTED]
  docs/superpowers/specs/2026-04-20-docker-design.md → CLAUDE.md

## Hyperedges (group relationships)
- **WebSocket log streaming pipeline: pushLog buffers, broadcasts, emits events** — claude_md_push_log, claude_md_log_buffer, claude_md_broadcast_to_clients, claude_md_stream_emitter, claude_md_ws_server [EXTRACTED 0.95]
- **File manager security: resolveSafePath + symlink rejection + root deletion guard** — file_manager_design_resolve_safe_path, file_manager_design_forbidden_factory, file_manager_design_delete_file, file_manager_design_rename_file [EXTRACTED 0.92]
- **Docker data persistence: named volume for SQLite + bind mount for server files** — docker_design_named_volume_yams_data, docker_design_bind_mount_servers, docker_design_yams_db_env, docker_design_yams_servers_root_env, docker_design_compose_yml [EXTRACTED 0.90]

## Communities

### Community 0 - "Error Handling & FS Utils"
Cohesion: 0.12
Nodes (27): AppError, badRequest(), conflict(), internal(), notFound(), createServerDirectory(), serverJarExists(), writeEula() (+19 more)

### Community 1 - "Docker & Storage Config"
Cohesion: 0.08
Nodes (30): src/utils/errors.js — AppError factory, Bind mount ./servers — user jar placement, compose.yml — Docker Compose config, Named volume yams_data — SQLite persistence, client/vite.config.js — VITE_API_URL proxy env var, YAMS_DB env var — SQLite path in container, YAMS_SERVERS_ROOT env var — server directories root, Atomic write — temp file then rename (+22 more)

### Community 2 - "Core Backend Architecture"
Cohesion: 0.12
Nodes (21): app.js — Express entry point, Crash classification — normal/crashed/startup, src/db.js — SQLite singleton, src/utils/fileManager.js — filesystem ops, src/utils/logPersist.js, node:sqlite — built-in Node 24 SQLite, src/utils/observability.js — getObservability(), Rationale: disk ops before DB write prevents orphaned DB records (+13 more)

### Community 3 - "WebSocket Log Streaming"
Cohesion: 0.11
Nodes (19): Backpressure protection — bufferedAmount guard, broadcastToClients() — WebSocket fan-out, Log ring buffer — cap 100, history replay, Pending client timeout — zombie client prevention, pushLog(id, type, data) — unified log write path, streamEmitter — event-driven architecture, CommandInput component, Console component (+11 more)

### Community 4 - "WebSocket Server & Observability"
Cohesion: 0.12
Nodes (7): getObservability(), createWsServer(), handleCommand(), handleSubscribe(), send(), updateObservabilityStats(), WSService

### Community 5 - "Client Setup & Tooling"
Cohesion: 0.13
Nodes (17): src/websocket/wsServer.js, client/src/main.jsx — React entry point, client/index.html — SPA root, TailwindCSS v4, useWebSocket hook — connection state, useXTerm hook — terminal lifecycle, Vite dev server — port 5173, xterm.js — terminal emulation (+9 more)

### Community 6 - "Database Layer"
Cohesion: 0.27
Nodes (10): getDb(), migrate(), create(), findAll(), findByName(), findByPort(), getStmts(), remove() (+2 more)

### Community 7 - "Console UI & WebSocket Hook"
Cohesion: 0.33
Nodes (2): ConsolePage(), useWebSocket()

### Community 8 - "Server Table Component"
Cohesion: 0.4
Nodes (0): 

### Community 9 - "Terminal Console Component"
Cohesion: 0.4
Nodes (2): Console(), useXTerm()

### Community 10 - "Dashboard Page"
Cohesion: 0.5
Nodes (3): buildCards(), Dashboard(), useDashboard()

### Community 11 - "Log Persistence"
Cohesion: 0.67
Nodes (3): flushLogs(), flushNow(), queueLog()

### Community 12 - "System Panel Component"
Cohesion: 0.83
Nodes (3): formatSysUptime(), SystemPanel(), useSecondsAgo()

### Community 13 - "API Test Suite"
Cohesion: 0.67
Nodes (0): 

### Community 14 - "Navigation Bar"
Cohesion: 0.67
Nodes (0): 

### Community 15 - "Metric Card Component"
Cohesion: 0.67
Nodes (0): 

### Community 16 - "Activity Feed Component"
Cohesion: 0.67
Nodes (0): 

### Community 17 - "Application Root"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Command Input Component"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Sidebar Component"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Toast Notification"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Status Bar Component"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Layout Component"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "CommonJS Rationale"
Cohesion: 1.0
Nodes (2): CommonJS module system, Rationale: CommonJS chosen for simplicity, no transpilation

### Community 24 - "File Manager Plan"
Cohesion: 1.0
Nodes (2): node:test + node:assert/strict — built-in test runner, Task 8: Security integration tests

### Community 25 - "Server Entry Point"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Swagger API Docs"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Server Routes"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Metrics Routes"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "PostCSS Config"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Tailwind Config"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Vite Config"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "ESLint Config"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "React Entry Point"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "YAMS Project Overview"
Cohesion: 1.0
Nodes (1): YAMS — Minecraft Server Manager

### Community 35 - "WebSocket Heartbeat"
Cohesion: 1.0
Nodes (1): WebSocket heartbeat — 30s ping/pong

### Community 36 - "Dashboard Navbar Design"
Cohesion: 1.0
Nodes (1): NavBar component

## Knowledge Gaps
- **40 isolated node(s):** `YAMS — Minecraft Server Manager`, `src/utils/logPersist.js`, `Crash classification — normal/crashed/startup`, `WebSocket heartbeat — 30s ping/pong`, `src/utils/fileManager.js — filesystem ops` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Application Root`** (2 nodes): `App()`, `App.jsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Command Input Component`** (2 nodes): `CommandInput.jsx`, `CommandInput()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Sidebar Component`** (2 nodes): `Sidebar.jsx`, `Sidebar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Toast Notification`** (2 nodes): `Toast.jsx`, `Toast()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Status Bar Component`** (2 nodes): `StatusBar.jsx`, `StatusBar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Layout Component`** (2 nodes): `Layout.jsx`, `Layout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `CommonJS Rationale`** (2 nodes): `CommonJS module system`, `Rationale: CommonJS chosen for simplicity, no transpilation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `File Manager Plan`** (2 nodes): `node:test + node:assert/strict — built-in test runner`, `Task 8: Security integration tests`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Server Entry Point`** (1 nodes): `app.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Swagger API Docs`** (1 nodes): `swagger.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Server Routes`** (1 nodes): `serverRoutes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Metrics Routes`** (1 nodes): `metricsRoutes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `PostCSS Config`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tailwind Config`** (1 nodes): `tailwind.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Config`** (1 nodes): `vite.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ESLint Config`** (1 nodes): `eslint.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React Entry Point`** (1 nodes): `main.jsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `YAMS Project Overview`** (1 nodes): `YAMS — Minecraft Server Manager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `WebSocket Heartbeat`** (1 nodes): `WebSocket heartbeat — 30s ping/pong`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Dashboard Navbar Design`** (1 nodes): `NavBar component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `src/services/serverService.js` connect `Core Backend Architecture` to `Docker & Storage Config`, `WebSocket Log Streaming`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `src/services/fileService.js — path resolution + fs ops` connect `Docker & Storage Config` to `Core Backend Architecture`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `app.js — Express entry point` connect `Core Backend Architecture` to `Client Setup & Tooling`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `createServer()` (e.g. with `create()` and `findByPort()`) actually correct?**
  _`createServer()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `startServer()` (e.g. with `start()` and `findById()`) actually correct?**
  _`startServer()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `src/services/serverService.js` (e.g. with `src/utils/observability.js — getObservability()` and `src/services/fileService.js — path resolution + fs ops`) actually correct?**
  _`src/services/serverService.js` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `YAMS — Minecraft Server Manager`, `src/utils/logPersist.js`, `Crash classification — normal/crashed/startup` to the rest of the system?**
  _40 weakly-connected nodes found - possible documentation gaps or missing edges._