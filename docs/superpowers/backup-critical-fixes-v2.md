# Backup Manager — Critical Fixes v2 (spec corrigé)

**Date:** 2026-04-26  
**Remplace:** `backup-critical-fixes-v1.md`  
**Status:** Prêt à implémenter

---

## Faits vérifiés avant implémentation

### `internal()` existe-t-il ?

**OUI.** `src/utils/errors.js` ligne 33 :

```js
const internal = (msg) => new AppError(msg || 'Internal server error', 500);
```

Exporté, opérationnel, statusCode 500. Aucun remplacement nécessaire.

---

### `processes.delete()` — Cas A ou Cas B ?

**Cas A confirmé.** Dans `stopServer()` (serverService.js ligne 452) :

```js
processes.delete(id);          // ligne 452 — Map vidée ici
// ...
child.stdin.write('stop\n');   // ligne 458 — signal envoyé APRÈS
```

Le `child.on('exit', ...)` (ligne 328) possède lui aussi un `processes.delete(id)` (ligne 352),
mais le commentaire ligne 325-327 le confirme explicitement : ce handler ne s'exécute que
pour les crashs naturels. Un stop API-driven passe par `stopServer()` qui vide la Map
avant d'envoyer le signal — l'exit handler trouve `processes.get(id) === undefined` et
n'exécute rien.

**Conséquence :** `getChildProcess(serverId)` doit être appelé AVANT `stopServer()`.
Cette contrainte est identique au spec v1. Aucun changement ici.

---

## Bug critique identifié dans le spec v1 — Race condition sur `child.once('exit')`

### Ce que le spec v1 proposait

```js
const child = getChildProcess(serverId)
stopServer(serverId)               // ← signal envoyé ici
                                   // ← FENÊTRE CRITIQUE
await new Promise((resolve, reject) => {
  child.once('exit', () => { ... }) // ← listener attaché ici
})
```

### Pourquoi c'est incorrect

**En Node.js standard :** le Promise constructor est synchrone. `child.once()` s'exécute
dans le même frame synchrone que le `new Promise()`, avant le premier yield de l'`await`.
Entre deux instructions synchrones, l'event loop ne peut pas délivrer un événement OS.
La race est techniquement improbable dans l'état actuel.

**Mais le pattern est faux pour trois raisons :**

1. **Futur :** Si `stopServer()` devient async un jour (ajout d'un `await` interne),
   le yield intervient entre le signal et l'enregistrement du listener. La race
   devient réelle et silencieuse — aucun compilateur ne l'attrape.

2. **Tests :** Des mocks de `ChildProcess` basés sur `EventEmitter` peuvent émettre
   `'exit'` synchroniquement. Le listener enregistré après l'émission ne se déclenche
   jamais. Les tests du chemin "serveur running" deviendraient impossibles à écrire
   correctement avec le pattern v1.

3. **Invariant de correction :** Le contrat "attacher le listener avant de déclencher
   l'action" est un invariant de programmation événementielle. Le violer même sans
   conséquence immédiate rend le code incorrect par construction.

---

## Fix obligatoire — Listener avant `stopServer()`

### Pattern correct

```js
const child = getChildProcess(serverId)

let waitForExit = Promise.resolve()
if (child) {
  waitForExit = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(internal('Server did not stop within 30 s; restore aborted')),
      30_000
    )
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

stopServer(serverId)   // signal envoyé APRÈS l'enregistrement du listener
await waitForExit
```

### Pourquoi ça fonctionne

1. `new Promise(executor)` s'exécute synchroniquement → `child.once('exit')` est enregistré.
2. `stopServer()` envoie le signal au JVM.
3. `await waitForExit` cède le contrôle à l'event loop.
4. L'event `'exit'` est délivré → listener déclenché → Promise résolue.

L'événement `'exit'` ne peut pas se perdre : il est soit déjà dans la queue de l'event
loop (le listener le consomme dès le premier yield), soit pas encore émis (le listener
attend). Les deux cas sont couverts.

---

## Alternatives rejetées

| Alternative | Raison du rejet |
|---|---|
| Garder listener-after-stop avec commentaire | Pattern incorrect par construction ; les tests avec mocks échoueront |
| Utiliser `child.exitCode !== null` après stopServer | Polling, non-déterministe, ignore les signaux |
| Exporter `processes` Map | Brise l'encapsulation ; Map contient clients WS et état interne |
| Modifier `stopServer()` pour être async | Change la signature synchrone ; blast radius élevé sur les appelants existants |

---

## Invariants préservés (inchangés depuis v1)

1. `stopServer()` reste synchrone.
2. `activeRestores` check/add avant le premier `await`.
3. `finally` libère toujours `activeRestores`, sans exception.
4. Rollback `.restore-bak` en cas d'échec d'extraction.
5. Aucune nouvelle dépendance.
6. Aucun changement de routes.
7. Backend uniquement.

---

## Fichiers impactés

| Fichier | Changement |
|---|---|
| `src/services/serverService.js` | `getChildProcess()` déjà ajouté en v1 — inchangé |
| `src/services/backupService.js` | Inverser l'ordre : `waitForExit = new Promise(...)` avant `stopServer()` |
| `test.js` | Ajouter le test anti-race |

---

## Plan d'implémentation

### Étape 1 — Test anti-race (TDD RED)

Écrire un test qui :

1. Crée un `EventEmitter` comme mock de `ChildProcess`.
2. Enregistre le listener **avant** d'émettre `'exit'`.
3. Émet `'exit'` synchroniquement (simule un process qui sort instantanément).
4. Vérifie que la Promise se résout sans timeout.

Ce test échoue si le code revient au pattern listener-after-stop et que quelqu'un
utilise un mock qui émet synchroniquement.

```js
test('wait-for-exit resolves when exit fires before await (anti-race)', async () => {
  const { EventEmitter } = require('events')
  const mock = new EventEmitter()

  // Pattern correct : listener AVANT le déclenchement de l'action
  const waitForExit = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('phantom timeout')), 1_000)
    mock.once('exit', () => { clearTimeout(t); resolve() })
  })

  // Simule stopServer() : émet exit synchroniquement
  mock.emit('exit', 0, null)

  // Doit résoudre immédiatement, sans timeout
  await waitForExit
})
```

**Vérification RED :** ce test passe déjà avec le code actuel (le pattern en v1 est
borderline-correct en Node.js). Il sert de régression — il échouerait si quelqu'un
réorganise le code pour émettre 'exit' avant de créer le Promise.

Ajouter en complément un test de résilience avec vrai process rapide :

```js
test('wait-for-exit resolves without phantom timeout for fast-exiting real process', async () => {
  const { spawn } = require('child_process')
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'])

  const waitForExit = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('phantom 5s timeout')), 5_000)
    child.once('exit', () => { clearTimeout(t); resolve() })
  })

  await waitForExit  // must resolve, not timeout
})
```

### Étape 2 — Fix `backupService.js`

Inverser l'ordre dans `restoreBackup()` : construire `waitForExit` avant `stopServer()`.

### Étape 3 — Vérification GREEN

`npm test` → 77+ tests pass, 0 failures.

---

## Risques potentiels

| Risque | Mitigation |
|---|---|
| `child` est null mais `waitForExit = Promise.resolve()` → `stopServer()` lance une exception | L'exception remonte dans le `try`, `finally` libère le lock |
| `stopServer()` lance une exception (serveur pas trouvé) | Identique : exception remonte, `finally` libère |
| Le process sort avant `stopServer()` (mort naturelle entre `getChildProcess` et `stopServer`) | `child.once('exit')` est déjà enregistré → Promise résolue immédiatement quand on `await` |
| Stale `.restore-bak` d'un restore précédent échoué | `fsp.rm(bakPath, force)` avant `fsp.rename` — géré |

---

## Plan de validation / tests

| Test | Méthode | Attendu |
|---|---|---|
| Anti-race avec mock synchrone | `EventEmitter` mock + `emit('exit')` synchrone | Promise résolue, pas de timeout |
| Anti-race avec vrai process rapide | `spawn(node, ['-e', 'process.exit(0)'])` | Promise résolue < 5s |
| Restore concurrent → 409 (unit) | `Promise.allSettled([restore, restore])` | Exactement un 409 |
| Restore concurrent → 409 (HTTP) | `Promise.all([api restore, api restore])` | Un 409, un 200 |
| Restore réussi (HTTP) | `POST .../restore` serveur stopped | 200, message correct |
| `getChildProcess` null | Appel direct avec ID inconnu | `null` |
| Chemin JVM running | Manuel uniquement — impossible sans JVM | Vérifié par trace logique |
