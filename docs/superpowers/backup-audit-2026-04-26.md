# Backup Manager — Audit de conformité post-correctifs
**Date :** 2026-04-26  
**Mise à jour :** 2026-04-26 (intégration Finding HIGH officiel)  
**Branch :** fix/rename-file-hardening  
**Périmètre :** backupService.js · serverService.js · backupController.js · backupRoutes.js · test.js  
**Objectif :** Confirmer que les deux vecteurs originaux sont éteints et détecter tout nouveau chemin équivalent.

---

## 1. Validation du code actuel

### 1.1 `activeRestores` — placement exact

| Élément | Ligne | Verdict |
|---|---|---|
| Déclaration module-level | backupService.js:25 | ✅ |
| `if (activeRestores.has(serverId))` | backupService.js:215 | ✅ avant premier `await` |
| `activeRestores.add(serverId)` | backupService.js:218 | ✅ avant premier `await` |
| Premier `await` réel | backupService.js:221 — `await findBackup(...)` | ✅ après les deux lignes précédentes |
| `activeRestores.delete(serverId)` | backupService.js:308 — bloc `finally` | ✅ |

**Le `finally` protège-t-il tous les chemins ?**  
Le `try` englobe les lignes 220–309. Le `finally` s'exécute pour toute sortie de ce bloc : retour normal, throw synchrone, rejet de Promise, timeout. Aucun chemin ne peut bypasser `activeRestores.delete`. ✅

---

### 1.2 `child.once('exit')` — ordre relatif à `stopServer()`

Séquence exacte dans `restoreBackup()` (lignes 235–257) :

```
L235 — if (server.status === 'running') {
L236 —   const { stopServer, getChildProcess } = require('./serverService');
L237 —   const child = getChildProcess(serverId);     ← (A) capture du ChildProcess
L242 —   let waitForExit = Promise.resolve();
L243 —   if (child) {
L244 —     waitForExit = new Promise((resolve, reject) => {
L245 —       const timeout = setTimeout(() => reject(...), 30_000);
L249 —       child.once('exit', () => {                ← (B) listener ATTACHÉ ICI
L250 —         clearTimeout(timeout);
L251 —         resolve();
L252 —       });
L253 —     });
L254 —   }
L256 —   stopServer(serverId);                         ← (C) signal envoyé APRÈS (B)
L257 —   await waitForExit;
L258 — }
```

**Invariant vérifié :** (B) s'exécute avant (C). Le `new Promise(executor)` est synchrone — `child.once('exit')` est enregistré dans le même tour synchrone, avant le premier yield. L'événement `'exit'` ne peut pas se perdre entre (B) et (C) car il n'y a aucun `await` entre eux. ✅

---

### 1.3 `processes.delete(id)` — emplacement dans `stopServer()`

`stopServer()` (serverService.js) :

```
L452 — processes.delete(id);          ← Map vidée ICI (avant le signal)
L458 — child.stdin.write('stop\n');   ← signal envoyé APRÈS
L469 — child.kill();                  ← fallback APRÈS
L476 — serverModel.updateStatus(id, 'stopped', null);
```

**Conséquence sur la capture du child :**  
`getChildProcess(serverId)` (A, ligne 237) est appelé AVANT `stopServer(serverId)` (C, ligne 256). À l'instant de (A), la Map contient encore l'entrée → le ChildProcess est capturé. À l'instant de (C), `stopServer` fait `processes.delete(id)` mais la variable `child` en ligne 237 détient déjà la référence directe à l'objet ChildProcess — indépendamment de l'état de la Map. ✅

---

### 1.4 `getChildProcess()` — comportement réel

serverService.js:641–643 :
```js
function getChildProcess(serverId) {
  const entry = processes.get(serverId);
  return entry ? entry.child : null;
}
```
Exporté à la ligne 649. Retourne `ChildProcess | null`. ✅

---

### 1.5 Timeout — pattern AppError

Lines 245–247 :
```js
const timeout = setTimeout(
  () => reject(internal('Server did not stop within 30 s; restore aborted')),
  30_000
);
```

`internal()` déclaré dans `src/utils/errors.js:33` : `new AppError(msg, 500)` avec `isOperational: true`.  
Le `clearTimeout(timeout)` est dans le listener `exit` → pas de fuite si le process sort normalement. ✅

**Cas edge — timeout expire avant l'exit :**  
`waitForExit` rejette → `finally` libère `activeRestores`. Le listener `child.once('exit')` est encore enregistré. Quand le process finit par sortir, le handler appelle `clearTimeout(timeout)` (no-op) et `resolve()` (no-op, Promise déjà settled). Pas de fuite, pas de double effet. ✅

---

### 1.6 Rollback `.restore-bak`

```
L277–288 — pour chaque worldDir :
  rm(bakPath, { force })         ← élimine un bak obsolète d'un restore précédent raté
  rename(worldPath, bakPath)     ← sauvegarde atomique sur même FS
  push({ worldPath, bakPath })

L291–295 — si extraction réussit :
  rm(bakPath, { recursive, force }) pour chaque entrée sauvegardée

L297–305 — si extraction échoue :
  rm(worldPath, { force })       ← supprime ce qui a déjà été extrait
  rename(bakPath, worldPath)     ← restaure le bak
```

**Stale bak géré ?** Oui : `fsp.rm(bakPath, { force: true })` avant `fsp.rename` (ligne 284). ✅  
**Extraction partielle ?** Les dirs world sont rollbackés. Les fichiers non-world partiellement extraits ne le sont pas (limitation connue et acceptée). ✅

---

### 1.7 Tests anti-race existants

| Test | Ligne | Ce qu'il vérifie |
|---|---|---|
| `wait-for-exit` (mock synchrone) | test.js:955 | Listener avant stop → Promise résolue même si exit émet synchronement |
| `wait-for-exit` (vrai process) | test.js:972 | Process fast-exit réel, pas de phantom timeout 5s |
| `getChildProcess null` | test.js:983 | Export présent et retourne null pour un ID inconnu |
| `concurrent restore → 409` (unit) | test.js:988 | activeRestores bloque le 2e appel simultané |
| `200 restore stopped server` (HTTP) | test.js:1112 | Chemin nominal end-to-end |
| `concurrent restore → 409` (HTTP) | test.js:1121 | HTTP : verrou visible depuis le réseau |

Tous présents. ✅

---

## 2. Findings de sécurité

---

### Finding F-001 — HIGH : `startServer()` autorisé pendant `restoreBackup()`

**Sévérité :** HIGH  
**Statut :** OUVERT — non corrigé  
**Impact :** Corruption binaire des fichiers `.mca` (world irrécouvrable sans backup séparé)

#### Preuve code-level

`startServer()` (serverService.js:237–244) — seuls guards présents :

```js
// serverService.js:237
function startServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound(`Server '${id}' not found`);

  // serverService.js:242 — SEULE vérification de concurrence
  if (processes.has(id) || server.status === 'running') {
    throw conflict(`Server '${server.name}' is already running`);
  }
  // ... spawn JVM
}
```

**`activeRestores` n'est pas consulté.** La fonction ne connaît pas l'existence du Set.

#### Pourquoi les deux guards (ligne 242) échouent-ils pendant un restore ?

Pendant `restoreBackup()`, après l'appel à `stopServer()` :

| État observable | Valeur | Raison |
|---|---|---|
| `processes.has(id)` | `false` | `stopServer()` appelle `processes.delete(id)` à la ligne 452 |
| `server.status` (DB) | `'stopped'` | `stopServer()` appelle `updateStatus(id, 'stopped')` à la ligne 476 |

Les deux conditions du guard sont `false`. `startServer()` **laisse passer**.

#### Scénario de corruption exact

```
t=0  POST /servers/A/backups/X/restore
       activeRestores.add('A')
       stopServer('A')
         → processes.delete('A')   [Map vidée]
         → updateStatus('A', 'stopped')   [DB mise à jour]
       await waitForExit  →  JVM A terminé

t=1  zipDir.extract({ path: serverRootA, concurrency: 5 })
       [5 streams d'écriture ouverts sur les fichiers .mca de world/]

t=1  POST /servers/A/start   (concurrent — double-clic UI, retry auto, second utilisateur)
       processes.has('A')      → false   ✓ guard passe
       server.status === 'running' → false  ✓ guard passe
       spawn(java [...])
       JVM A démarre, ouvre et lit les fichiers .mca

t=1+ε  JVM A écrit les chunks initiaux dans world/region/*.mca
        ↕ concurrent avec
        zipDir.extract() écrase les mêmes fichiers .mca

       → Entrelacement de bytes JVM et bytes ZIP dans les fichiers région
       → Format binaire .mca invalide
       → World irrécouvrable
```

#### Fenêtre d'exploitation

La fenêtre dure du début de `zipDir.extract()` jusqu'à la fin. Pour une world typique de Minecraft (plusieurs centaines de MB), cette fenêtre est de l'ordre de **plusieurs secondes à plusieurs dizaines de secondes**. Suffisant pour un double-clic ou un retry automatique.

#### Exploitabilité

- **Réaliste** : aucun accès spécial requis. Tout client API ou utilisateur du frontend peut déclencher `POST /servers/:id/start` pendant qu'un restore est en cours.
- **Non-hypothétique** : le chemin de code est linéaire et reproductible.
- **Impact maximal** : la world corrompue n'est pas récupérable sans backup séparé préexistant.

---

### Finding F-002 — MEDIUM : `createBackup()` et `restoreBackup()` ne se bloquent pas mutuellement

**Sévérité :** MEDIUM  
**Statut :** OUVERT — non corrigé  
**Impact :** Backup invalide créé silencieusement pendant un restore

`createBackup()` vérifie `activeBackups.has(serverId)` mais pas `activeRestores.has(serverId)`.  
`restoreBackup()` vérifie `activeRestores.has(serverId)` mais pas `activeBackups.has(serverId)`.

Si les deux opérations tournent simultanément : `archiver` scanne et archive des fichiers world en cours d'écrasement par `zipDir.extract`. Le backup produit contient des chunks incohérents. Restaurer ce backup corrompt la world. L'erreur est silencieuse (pas d'exception retournée au client).

---

### Finding F-003 — LOW : Symlinks dans une archive non validés post-extraction

**Sévérité :** LOW  
**Statut :** OUVERT — hors scope immédiat

Le zip-slip check (backupService.js:268–273) valide les chemins dans l'archive mais ne détecte pas les entrées de type symlink pointant hors sandbox. Condition d'exploitation : placer un `.zip` malicieux dans `backups/` par un vecteur externe. Dans le contexte YAMS (outil local), risque faible.

---

### Autres vecteurs examinés — non-risques

| Vecteur | Analyse | Verdict |
|---|---|---|
| Process meurt entre `findBackup` et DB check | Exit handler met DB à 'stopped' → `server.status === 'running'` est false → bloc stop skippé → restore sûr | ✅ SAFE |
| Process meurt entre `getChildProcess` et `stopServer` | Impossible : séquence entièrement synchrone, aucun `await` entre elles | ✅ SAFE |
| `stopServer()` throw quand entry null | Si entry=null → getChildProcess retourne null → `waitForExit = Promise.resolve()` → pas de timeout orphelin | ✅ SAFE |
| `.restore-bak` existe déjà | `fsp.rm(bakPath, { force })` ligne 284 l'élimine | ✅ SAFE |
| Timeout expire puis process exit ensuite | `clearTimeout` no-op + `resolve()` no-op sur Promise settled | ✅ SAFE |
| restore concurrent + delete backup | `findBackup` échoue (404) ou extract échoue (internal), rollback s'exécute | ✅ SAFE |
| extract échoue après suppression partielle des world dirs | Rollback `.restore-bak` couvre les world dirs | ✅ SAFE (hors world : limitation connue) |

---

## 3. État des deux vecteurs originaux

| Vecteur | Status | Preuve code |
|---|---|---|
| Restore lancé avant vraie fin du JVM | **ÉTEINT** ✅ | Listener L249 avant stopServer L256 ; await real 'exit' event ; 30s timeout |
| Restore concurrent | **ÉTEINT** ✅ | activeRestores.add L218 avant premier await L221 ; finally libère toujours |

---

## 4. Verdict strict

```
APPROVED WITH CHANGES
```

Les deux vecteurs originaux sont correctement éteints. Le Finding F-001 (HIGH) est un nouveau vecteur de corruption introduit implicitement par le fait que `startServer()` n'a pas connaissance du cycle de vie de `restoreBackup()`.

---

## 5. Plan de correction minimal

### Required Change — Finding F-001 (HIGH)

**Objectif :** Bloquer `startServer()` pendant un restore actif.  
**Contraintes :** Backend-only · pas de nouvelle dépendance · pas de changement route · lazy-require obligatoire (dépendance circulaire backupService ↔ serverService).

#### Étape A — `backupService.js` : exporter `isRestoring()`

Ajouter la fonction et l'exporter :

```js
// backupService.js
function isRestoring(serverId) {
  return activeRestores.has(serverId);
}

module.exports = {
  createBackup, listBackups, findBackup, deleteBackup, streamBackup, restoreBackup,
  isRestoring,   // ← ajout
};
```

#### Étape B — `serverService.js` : guard dans `startServer()`

Après le check `processes.has(id) || server.status === 'running'` (ligne 242), ajouter :

```js
// serverService.js — dans startServer(), après le guard ligne 242
const { isRestoring } = require('./backupService'); // lazy-require — évite la dépendance circulaire
if (isRestoring(id)) {
  throw conflict(`Server '${server.name}' has a restore in progress`);
}
```

#### Aucun autre changement requis pour F-001.

---

### Required Change — Finding F-002 (MEDIUM)

**Dans `createBackup()` (backupService.js), avant `activeBackups.add` :**

```js
if (activeRestores.has(serverId)) {
  throw conflict('A restore is in progress for this server; cannot create backup');
}
```

**Dans `restoreBackup()` (backupService.js), avant `activeRestores.add` :**

```js
if (activeBackups.has(serverId)) {
  throw conflict('A backup is in progress for this server; cannot restore');
}
```

Les deux Sets sont dans le même fichier → pas de dépendance circulaire. Changement de 4 lignes.

---

## 6. Tests à écrire (TDD RED avant toute implémentation)

### Test prioritaire — Finding F-001 (HIGH)

```js
test('startServer rejects with 409 when a restore is in progress', async () => {
  // Déclencher un restore et intercepter la fenêtre d'extraction
  // pour appeler startServer pendant que activeRestores.has(id) === true
  //
  // Méthode : monkeypatch zipDir.extract pour qu'il appelle startServer
  // pendant son exécution et vérifie que 409 est levé.
  //
  // Alternative : vérifier directement que isRestoring() bloque startServer()
  // via une injection de l'état (appel isRestoring depuis un test de state machine).
});
```

**Vérification RED obligatoire :** le test doit échouer avant l'implémentation (startServer réussit au lieu de 409).  
**Vérification GREEN obligatoire :** le test passe après les changements des étapes A et B.

### Tests complémentaires — Finding F-002 (MEDIUM)

```js
test('createBackup rejects with 409 when a restore is in progress for the same server');
test('restoreBackup rejects with 409 when a backup is in progress for the same server');
```

---

## 7. Résumé des actions requises

| Priorité | Finding | Fichier | Action |
|---|---|---|---|
| 1 — HIGH | F-001 | backupService.js | Ajouter `isRestoring()` + export |
| 1 — HIGH | F-001 | serverService.js | Guard lazy-require dans `startServer()` |
| 2 — MEDIUM | F-002 | backupService.js | 4 lignes de guard croisé backup/restore |
| — | — | test.js | 3 nouveaux tests TDD (RED avant code) |
