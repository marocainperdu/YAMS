# Backup Manager — Critical Production Bug Fixes

**Date:** 2026-04-26  
**Branch:** fix/rename-file-hardening  
**Status:** Implementation pending

---

## Problems Identified

### Bug 1 — Restore starts before JVM has exited (CRITICAL)

`restoreBackup()` calls `stopServer(serverId)` and then polls the database until
`server.status !== 'running'`. The assumption is that the DB reflects live process
state. It does not.

`stopServer()` is a synchronous function. It sends `stop\n` to the JVM's stdin (or
`child.kill()`), then immediately calls `serverModel.updateStatus(id, 'stopped', null)`,
then returns. The OS-level Java process is still alive at that point — it is saving
chunks, flushing players, and closing region files.

The polling loop in `restoreBackup()`:

```js
while (true) {
  const current = serverModel.findById(serverId);
  if (!current || current.status !== 'running') break; // breaks on iteration 1
  ...
}
```

breaks on its **first iteration** because the DB was already written to `'stopped'`
by `stopServer()` before it returned. The JVM has not exited.

`restoreBackup()` then proceeds to delete world directories and extract the backup
while the JVM holds open file descriptors over the same paths.

### Bug 2 — No concurrency lock on restore (HIGH)

`createBackup()` uses `activeBackups: Set` to reject concurrent backup requests
(409 Conflict). `restoreBackup()` has **no equivalent lock**.

Two simultaneous `POST /servers/:id/backups/:backupId/restore` requests both pass
all checks, both delete world directories, and both call
`zipDir.extract({ path: serverRoot, concurrency: 5 })` simultaneously — producing
up to 10 concurrent write streams over the same binary `.mca` region files.
`unzipper` uses plain `fs.createWriteStream` with no exclusive locking. The writes
interleave, producing a corrupted binary region format.

---

## Production Impact

**Bug 1:** World data corruption on any server that was running when a restore was
triggered. The JVM writes flushed chunks to region files that are simultaneously
being deleted and then overwritten by the backup extraction. Result: inodes written
by the JVM are mixed into the extracted backup content. The world is unreadable.

**Bug 2:** World data corruption when any two restore requests arrive
simultaneously (double-click in UI, retry on timeout, concurrent users). Both
concurrent extractions write the same `.mca` files with interleaved byte sequences
that are not valid region format.

Both bugs cause **permanent, unrecoverable world loss** without a separate backup.

---

## Root Causes

**Bug 1:** `stopServer()` updates the DB status synchronously as part of its own
bookkeeping (not as confirmation of process exit). The polling loop in
`restoreBackup()` was written under the assumption that DB status equals live
process state, which is only true after the `exit` event fires — not after
`stopServer()` returns.

**Bug 2:** `restoreBackup()` was implemented without a concurrency guard, unlike
`createBackup()` which correctly uses `activeBackups`.

---

## Solution Chosen

### Bug 1 Fix — Capture child reference, await real `exit` event

Before calling `stopServer()`, capture the `ChildProcess` reference from the
`processes` Map via a new `getChildProcess(id)` export on `serverService`.

After calling `stopServer()`, if a live child was captured, wait for the actual
OS-level `'exit'` event with a 30-second timeout. Only proceed to world deletion
and extraction after the event fires.

This sidesteps the DB-polling entirely. The `'exit'` event is emitted by Node's
internal libuv process handle; it fires when the OS process has fully exited and
all stdio streams are closed.

### Bug 2 Fix — `activeRestores` Set mirroring `activeBackups`

Add `const activeRestores = new Set()` at module level. In `restoreBackup()`,
check and add `serverId` **before the first `await`** (synchronous, eliminates
the race window). Remove in `finally`. Return 409 Conflict if already present.

### Bonus — `world.bak` rollback on extraction failure

Before deleting world directories, rename each existing one to
`${dir}.restore-bak`. On extraction success, remove the `.bak` dirs. On
extraction failure, rename them back. Protects against non-zip-corruption failures
(disk full, I/O error) that occur after world deletion but before extraction
completes.

---

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Poll the `processes` Map instead of DB | `stopServer()` already calls `processes.delete(id)` before the JVM exits — Map is empty immediately, same premature exit |
| Use a timeout (e.g. sleep 5s) instead of `exit` event | Non-deterministic; fails on slow servers, wastes time on fast ones |
| Modify `stopServer()` to be async and await exit | Breaks the synchronous contract used by existing callers; wider blast radius |
| Export the `processes` Map for direct access | Breaks encapsulation; Map contains WebSocket clients and other internal state |

---

## Invariants to Preserve

1. `stopServer()` remains synchronous — no async changes to its signature.
2. `activeBackups` behavior and API are unchanged.
3. No new npm dependencies.
4. No route changes.
5. No frontend changes.
6. The `processes` Map internal structure is not exposed; only a read accessor is added.
7. The `finally` block in `restoreBackup()` must always release the `activeRestores` lock — no throw path may bypass it.
8. The 30-second timeout must reject with an `internal()` error (503-like), not silently proceed.

---

## Files Impacted

| File | Change |
|---|---|
| `src/services/serverService.js` | Add `getChildProcess(id)` export |
| `src/services/backupService.js` | Add `activeRestores` Set; rewrite `restoreBackup()` stop/wait logic; add rollback |
| `test.js` | Add 4 new tests (unit + HTTP integration) |

---

## Implementation Plan

### Step 1 — Write failing tests (TDD RED)

In `test.js`, add before the existing restore HTTP tests:

1. **Unit: concurrent restores → 409** — `Promise.allSettled` of two simultaneous
   `restoreBackup()` calls; assert exactly one is rejected with 409.

2. **Unit: `getChildProcess` returns null for unknown server** — verifies the new
   export exists and handles the no-process case correctly.

3. **HTTP: successful restore → 200** — `POST .../restore` on a stopped server with
   a valid backup; assert 200 and `message`.

4. **HTTP: concurrent restore → 409** — `Promise.all` of two simultaneous HTTP
   restore requests; assert one gets 409.

Run `npm test` and confirm all four new tests fail for the right reasons.

### Step 2 — Add `getChildProcess` to serverService (minimal)

```js
function getChildProcess(serverId) {
  const entry = processes.get(serverId);
  return entry ? entry.child : null;
}
// add to module.exports
```

### Step 3 — Rewrite `restoreBackup` in backupService

```
const activeRestores = new Set();

restoreBackup(serverId, backupId, serverPathOrId):
  resolveServerRoot (sync, unchanged)
  if activeRestores.has(serverId) → throw conflict 409
  activeRestores.add(serverId)
  try:
    findBackup (await)
    serverModel.findById (sync, unchanged)
    if server not found → throw 404
    if server.status === 'running':
      const child = getChildProcess(serverId)   // capture before stop
      stopServer(serverId)                       // sync, mutates Map + DB
      if child:
        await new Promise(exit-event OR 30s timeout)
    validate zip integrity (unchanged)
    rename world dirs to .restore-bak (rollback save)
    extract zip
    on success: delete .restore-bak dirs
    on failure: rename .restore-bak back → throw
  finally:
    activeRestores.delete(serverId)
```

### Step 4 — Run tests, verify GREEN

`npm test` — all 4 new tests pass, no existing tests broken.

---

## Potential Risks

| Risk | Mitigation |
|---|---|
| `child.once('exit', ...)` listener not cleaned up on timeout | `clearTimeout` runs on both paths; no dangling reference |
| Server exits between `getChildProcess` call and `stopServer` call | If child exits naturally before `stopServer`, the `exit` event fires immediately on `child.once` — Promise resolves at once |
| `.restore-bak` dir already exists from previous failed restore | Explicit `fsp.rm(bakPath, { recursive, force })` before `fsp.rename` |
| `stopServer()` throws (server not found / not running) | The throw propagates through the try block; `finally` still releases the lock |
| `getChildProcess` called after `stopServer` removes Map entry | `getChildProcess` is called **before** `stopServer`; `child` variable holds reference to the ChildProcess object regardless of Map state |

---

## Validation / Test Plan

| Test | Method | Expected |
|---|---|---|
| Concurrent restores (unit) | `Promise.allSettled([restoreBackup, restoreBackup])` | One 409, one other |
| `getChildProcess` null path | Direct call with unknown ID | `null` returned |
| Successful restore (HTTP) | `POST /servers/:id/backups/:backupId/restore` | 200, correct message |
| Concurrent restore (HTTP) | `Promise.all([api restore, api restore])` | One 409, one 200 |
| JVM-still-running path | Manual / not testable without real JVM | Verified by code trace |
