# YAMS — État du projet : contexte pour démarrer le Worlds Backend

> Document destiné à l'agent IA de gestion de projet.
> Date de rédaction : 2026-04-26.

---

## 1. Ce qui est entièrement terminé

### Infrastructure de base
| Couche | Fichier | État |
|---|---|---|
| Base de données SQLite (better-sqlite3) | `src/db.js` | ✅ Stable |
| Modèle `servers` (CRUD + prepared stmts) | `src/models/serverModel.js` | ✅ Stable |
| Utilitaire d'erreurs (`AppError`) | `src/utils/errors.js` | ✅ Stable |
| Utilitaire fichiers (`fileManager.js`) | `src/utils/fileManager.js` | ✅ Stable |
| Log persistence vers disque | `src/utils/logPersist.js` | ✅ Stable |
| Observabilité système | `src/utils/observability.js` | ✅ Stable |
| Entry point Express | `app.js` | ✅ Stable |
| Swagger / OpenAPI | `src/swagger.js` | ✅ Stable |

### Features livrées

#### Gestion des serveurs (`/servers`)
- `POST /servers` — Créer un serveur (validation nom/port/ram, disk ops avant DB write)
- `GET /servers` — Lister tous les serveurs
- `GET /servers/:id` — Récupérer un serveur
- `POST /servers/:id/start` — Démarrer (spawn Java, WebSocket log streaming)
- `POST /servers/:id/stop` — Arrêter proprement via `stop\n` stdin puis fallback `kill()`
- Réconciliation au démarrage : les serveurs marqués `running` sont remis à `stopped`

#### File Manager (`/servers/:id/files`)
- `GET /files?path=` — Lister un répertoire (dirs en premier, alphabétique)
- `GET /files/download?path=` — Télécharger un fichier
- `POST /files/upload?path=&overwrite=` — Upload multipart avec flush garanti
- `POST /files/mkdir` — Créer un répertoire
- `PUT /files/rename` — Renommer (hardened : validation symlink profonde, fallback EXDEV cross-device)
- `DELETE /files?path=` — Supprimer fichier ou dossier
- Sécurité : path traversal bloqué, symlink chain validation, confinement dans `SERVERS_ROOT`

#### Backup Manager (`/servers/:id/backups`)
- `GET /backups` — Lister les backups (triés par date décroissante)
- `POST /backups` — Créer un backup (zip avec `archiver`, exclusion logs/crash-reports/backups, `.lock` ignorés, write atomique via tmp → rename)
- `GET /backups/:backupId/download` — Télécharger un backup
- `DELETE /backups/:backupId` — Supprimer un backup
- `POST /backups/:backupId/restore` — Restaurer (zip-slip guard, stop du serveur avec attente réelle du `exit` OS, rollback `.restore-bak` sur échec, mutex concurrent backup/restore)

#### Console WebSocket (`ws://localhost:PORT/ws`)
- Streaming stdout/stderr typé (`type: "stdout"` / `"stderr"`)
- Ring buffer de 100 lignes avec replay `type: "history"` pour les clients tardifs
- Pending subscriptions : un client peut souscrire à un serveur arrêté et être promu au démarrage
- Heartbeat 30 s ping/pong, terminaison des clients morts
- Backpressure : vérification `bufferedAmount` avant envoi, comptage des messages droppés
- Timeout des clients en attente (5 min par défaut)
- Shape de message unifiée : `{ type, serverId, timestamp, data }`

#### Métriques (`GET /metrics`)
- Snapshot temps réel : uptime, compteurs serveurs, clients WebSocket actifs/pending, logs récents
- Cache TTL 2 s, sert le cache périmé sur erreur

---

## 2. Architecture et conventions à respecter

### Structure de fichiers
```
src/
  controllers/   ← thin handlers: parse req → call service → JSON response (NO business logic)
  services/      ← toute la logique métier
  routes/        ← Router Express, mergeParams: true pour les sous-ressources
  models/        ← SQL pur, prepared statements, retourne plain JS objects
  utils/         ← utilitaires transverses (errors, fileManager, logPersist, observability)
  websocket/     ← wsServer.js
```

### Patterns établis
- **CommonJS** partout (`require` / `module.exports`), pas d'ESM
- **Pas d'ORM** — SQL brut via prepared statements dans `src/models/`
- **Opérations disk avant DB write** dans les créations (évite les orphelins DB)
- **`AppError` avec `isOperational`** pour les erreurs exposables au client
- **Mutex en mémoire** (`Set` actif) pour les opérations longues concurrentes (pattern établi dans `backupService.js`)
- **`SERVERS_ROOT`** overridable via env var pour les tests
- **Path safety** : `path.resolve()` + vérification `startsWith(root + sep)` avant toute opération FS
- Chaque route est montée dans `app.js` avec `app.use('/servers/:id/xxx', xxxRoutes)`

### Schéma DB actuel
```sql
CREATE TABLE servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  path       TEXT NOT NULL,
  port       INTEGER NOT NULL UNIQUE,
  ram        TEXT NOT NULL DEFAULT '1G',
  status     TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('stopped', 'running')),
  pid        INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Les backups sont 100 % filesystem (pas de table DB). Les fichiers sont 100 % filesystem.

---

## 3. Ce qui commence maintenant : Worlds Backend

### Contexte Minecraft
Un serveur Minecraft crée plusieurs répertoires de monde dans son dossier :
- `world/` — dimension overworld (obligatoire)
- `world_nether/` — dimension nether
- `world_the_end/` — dimension end

La configuration active se fait via `server.properties` (clé `level-name`).
Ces répertoires sont déjà connus du backup service (`WORLD_DIRS`).

### Périmètre attendu (à définir/valider avec le product owner)
Le Worlds Backend devra probablement couvrir :
1. **Lister les mondes** disponibles dans le répertoire d'un serveur
2. **Obtenir les métadonnées** d'un monde (taille, date, dimension active ou non)
3. **Changer de monde actif** (modifier `level-name` dans `server.properties`, nécessite restart)
4. **Supprimer un monde** (avec garde-fous si le serveur tourne)
5. **Importer un monde** (upload d'un zip ou d'un dossier)
6. **Exporter un monde** (téléchargement zip d'un monde spécifique)

### Route parent attendue
```
/servers/:id/worlds
```

### Fichiers à créer
```
src/services/worldService.js
src/controllers/worldController.js
src/routes/worldRoutes.js
```
Et montage dans `app.js` :
```js
app.use('/servers/:id/worlds', worldRoutes);
```

### Contraintes à respecter
- Vérifier si le serveur est `running` avant toute opération destructive (supprimer, importer)
- Réutiliser `resolveServerRoot` / pattern de confinement FS (voir `backupService.js:resolveServerRoot`)
- `server.properties` doit être lu/écrit de façon atomique (write tmp → rename)
- Ne pas casser les backups existants (les mondes sont inclus dans les backups)

---

## 4. État du dépôt Git au moment de ce document

```
Branche courante : fix/rename-file-hardening
Branche principale : main
```

**Fichiers modifiés (non commités) :**
- `src/services/backupService.js` (staged)
- `src/services/serverService.js` (unstaged)
- `test.js` (unstaged)

**Action recommandée avant de démarrer le Worlds Backend :**
Finir / commiter les changements en cours sur `fix/rename-file-hardening`, merger sur `main`, puis créer une nouvelle branche `feature/worlds-backend`.

---

## 5. Ce qui n'existe pas encore (hors Worlds)

- `DELETE /servers/:id` — suppression d'un serveur (modèle existe, pas d'endpoint)
- Authentification (volontairement absent, outil local)
- Téléchargement automatique des JARs Mojang
- Check OS du port en cours d'utilisation (seul le check DB existe)
- Plugin management
