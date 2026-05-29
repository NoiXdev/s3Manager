# S3 Manager — Local ↔ Bucket Sync

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle (a local↔bucket sync engine + a Local Sync screen behind a mode toggle), built on the merged bucket→bucket Sync feature and the rest of the app (all on `develop`).

## Overview

Add one-way synchronization between a **local directory** and a **bucket/prefix**, in either direction:

- **Upload** — local folder → bucket/prefix.
- **Download** — bucket/prefix → local folder.

It reuses the bucket-sync engine's pure diff core and result/progress types. Sync is **additive** (never deletes on either side) and copies an object only when it is **missing on the destination or differs in byte size**. The user picks a direction, a local folder (native dialog) and a remote endpoint (account + bucket + prefix), **previews** a plan (what will be copied, how many bytes), then runs the transfer with live progress and a cancel button.

## Goals

- Diff a local directory against a bucket/prefix (by relative path + byte size) and copy what is missing or size-different on the destination side.
- Support both directions via a toggle (Upload / Download).
- **Preview** the plan before transferring; **live progress**, **cancel**, and **per-object error isolation** during the run — identical semantics to bucket→bucket sync.
- Live in the existing **Sync** section behind a mode toggle (`Bucket → Bucket` | `Local ↔ Bucket`).

## Non-Goals (out of scope)

- **Deleting destination extras** (mirror / `--delete`) on either side. Additive-only.
- **Two-way / simultaneous** sync. One direction per run.
- **mtime / checksum comparison.** Size only (consistent with bucket sync; mtime is unreliable across local FS and S3 `LastModified`).
- **Symlinks / special files.** Regular files only; symlinks and non-regular entries are skipped.
- **Resumable / persistent jobs**, history, scheduling.
- **Concurrent runs.** One sync at a time across the whole Sync section (local and bucket share the cancel/active-run controller).
- **Very large trees / listings.** Both sides are held in memory as `relKey → size` maps (a noted scale limitation, same as bucket sync).

## Why this approach

The bucket-sync engine already factored the comparison into a pure `diffListings(source, dest)` over `SyncObject[]` (`{ relKey, size }`). A local directory walk produces exactly that shape, so the diff core, the concurrency pool, and every result/progress type are reused unchanged. Only two things are new: enumerating a local directory (`walkDir`) and the per-object transfer for each direction (`uploadObject` for upload; `mkdir -p` + `downloadObject` for download). Keeping this in a separate `localSync.ts` leaves the merged, reviewed bucket engine untouched while sharing all the proven pieces.

## Architecture

```
src/main/s3/pool.ts            # CREATE: runPool<T> (extracted verbatim from sync.ts; shared)
src/main/s3/sync.ts            # MODIFY: import runPool from ./pool (delete the local copy; no behavior change)
src/main/s3/localSync.ts       # CREATE: walkDir, contentTypeFor, planLocalSync, runLocalSync, uploadOne/downloadOne
src/main/ipc/channels.ts       # MODIFY: 3 channels + ApiMap + LocalSyncArgs type import
src/main/ipc/register.ts       # MODIFY: 3 handlers + selectDirectory dep
src/main.ts                    # MODIFY: provide selectDirectory (dialog openDirectory)
src/preload.ts                 # MODIFY: localSyncPlan / localSyncRun / selectSyncDirectory
src/renderer/hooks/useLocalSync.ts                  # CREATE
src/renderer/components/sync/LocalFolderPicker.tsx  # CREATE
src/renderer/components/sync/LocalSyncScreen.tsx     # CREATE
src/renderer/components/sync/SyncSection.tsx         # CREATE (mode toggle wrapping bucket + local screens)
src/renderer/App.tsx           # MODIFY: sync branch renders <SyncSection>
```

### Shared pool (`src/main/s3/pool.ts`)

Move the existing private helper out of `sync.ts` verbatim and export it:

```ts
/** Run `worker` over `items` with at most `limit` in flight at once. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}
```

`sync.ts` deletes its local copy and imports `runPool` from `./pool` (no behavior change; the existing `sync.test.ts` continues to pass).

### Engine (`src/main/s3/localSync.ts`)

Reuses `Endpoint`, `SyncPlan`, `SyncResult`, `SyncFailure`, `SyncProgress` from `./sync`, `SyncObject`/`SyncOp` from `./syncDiff`, `diffListings` from `./syncDiff`, `listAll` from `./sync`, `uploadObject`/`downloadObject`/`toErr` from `./objects`, and `runPool` from `./pool`.

```ts
export interface LocalSyncArgs {
  direction: 'upload' | 'download';
  localPath: string;
  remote: Endpoint;          // { accountId, bucket, prefix }
}
```

- `walkDir(root: string): Promise<SyncObject[]>` — recursive `readdir(dir, { withFileTypes: true })`; recurse into directories; include **only regular files** (`entry.isFile()`; symlinks and special files skipped); `relKey` = path relative to `root` with the OS separator normalized to `/`; `size` from `stat().size`. Returns all files under the tree.
- `contentTypeFor(name: string): string | undefined` — lowercase-extension lookup over a small map (`.html`,`.htm`,`.css`,`.js`,`.mjs`,`.json`,`.txt`,`.csv`,`.xml`,`.pdf`,`.png`,`.jpg`,`.jpeg`,`.gif`,`.webp`,`.svg`,`.mp4`,`.webm`,`.mp3`,`.zip`); `undefined` if unknown.
- `planLocalSync(client, args): Promise<Result<SyncPlan>>` — `walkDir(localPath)` and `listAll(client, remote.bucket, remote.prefix)` in parallel; `source`/`dest` chosen by direction (upload → source=local, dest=remote; download → source=remote, dest=local); `diffListings(source, dest)`; return the same `SyncPlan` summary (`toCopy`, `upToDate = source.length - ops.length`, `bytesToCopy`, `sample` ≤100). Errors via `toErr`.
- `runLocalSync(client, args, opts): Promise<Result<SyncResult>>` where `opts = { onProgress?, signal? }` — emit `listing`, walk+list, diff, transfer each op via `runPool(ops, 6, …)`; per-op success increments `copied`/`bytesCopied` and emits `copying`; per-op error pushes `{ key, code, message }` to `failed` and continues; `signal?.aborted` between ops stops scheduling and sets `canceled: true`; emit `done`; return `SyncResult`. Listing/walk errors → `toErr` (whole run fails).
- `uploadOne(client, args, op)` — `uploadObject(client, { bucket: remote.bucket, key: remote.prefix + op.relKey, filePath: join(localPath, ...op.relKey.split('/')), contentType: contentTypeFor(op.relKey) })`.
- `downloadOne(client, args, op)` — `destPath = join(localPath, ...op.relKey.split('/'))`; `await mkdir(dirname(destPath), { recursive: true })`; `downloadObject(client, { bucket: remote.bucket, key: remote.prefix + op.relKey, destPath })`.

The per-op transfer chosen by `args.direction` (`upload` → `uploadOne`, `download` → `downloadOne`). The `SyncFailure.key` is `op.relKey`.

### IPC wiring

`channels.ts`:
- `CH.localSyncPlan = 'sync:localPlan'`, `CH.localSyncRun = 'sync:localRun'`, `CH.selectDirectory = 'sync:selectDirectory'`.
- `ApiMap`:
  - `[CH.localSyncPlan]: { args: [LocalSyncArgs]; res: Result<SyncPlan> }`
  - `[CH.localSyncRun]: { args: [LocalSyncArgs]; res: Result<SyncResult> }`
  - `[CH.selectDirectory]: { args: []; res: Result<string | null> }`
- Imports `LocalSyncArgs` (type) from `../s3/localSync`. **Reuses** `SYNC_PROGRESS_CHANNEL`/`SyncProgress` and the `sync:cancel` channel (no new progress/cancel channel).

`register.ts`:
- Import `planLocalSync`, `runLocalSync` from `../s3/localSync`.
- `RegisterDeps` gains `selectDirectory: () => Promise<string | null>`.
- `h(CH.localSyncPlan, (a: LocalSyncArgs) => planLocalSync(clientFor(a.remote.accountId), a))`.
- `localSyncRun` registered DIRECTLY via `ipcMain.handle` (for `event.sender`), setting the SAME module-scoped `activeSync` AbortController (with the supersede-prior-run + `finally` cleanup pattern already used by `sync:run`), forwarding progress to `SYNC_PROGRESS_CHANNEL`.
- `h(CH.selectDirectory, async () => ok(await deps.selectDirectory()))`.
- `sync:cancel` already aborts `activeSync`, so it cancels a local run too — no change needed.

`main.ts`:
- Implement `selectDirectory` with `dialog.showOpenDialog(win, { properties: ['openDirectory'] })` → return `result.canceled || !result.filePaths[0] ? null : result.filePaths[0]`; pass it into `registerIpc` deps.

`preload.ts`:
- `localSyncPlan: (a) => invoke(CH.localSyncPlan, a)`, `localSyncRun: (a) => invoke(CH.localSyncRun, a)`, `selectSyncDirectory: () => invoke(CH.selectDirectory)`. Reuses `onSyncProgress`/`cancelSync`.

No secrets cross the boundary; the renderer passes only the account id, the chosen local path, and the direction.

### Renderer

- **`useLocalSync()`** mirrors `useSync`: a `plan` mutation (`window.s3.localSyncPlan`), a `run(args)` that subscribes `onSyncProgress` for its duration and resolves with the `SyncResult`, a `cancel()` (`window.s3.cancelSync`), `progress`, and `resetProgress`.
- **`LocalFolderPicker`** (`{ path: string | null; onPick: (p: string) => void }`) — a "Choose folder…" button calling `window.s3.selectSyncDirectory()` (ignores a null/cancelled result) and a read-only display of the chosen path.
- **`LocalSyncScreen`** (`{ initialAccountId, initialBucket }`) — a direction toggle (Upload local→bucket / Download bucket→local), a `LocalFolderPicker`, a remote `EndpointPicker` (reused), Preview → plan summary (reusing the bucket screen's summary layout), Run/Cancel → progress panel, final summary with failures list. Preview enabled once a folder is chosen and the remote has account + bucket.
- **`SyncSection`** (`{ initialAccountId, initialBucket }`) — holds `mode: 'bucket' | 'local'`; renders a toggle (`Bucket → Bucket` | `Local ↔ Bucket`) and the matching screen (`SyncScreen` or `LocalSyncScreen`).
- **`App.tsx`** — the `sync` branch renders `<SyncSection initialAccountId={accountId} initialBucket={bucket} />` instead of `<SyncScreen>` directly.

## Data flow

1. In **Sync**, switch to **Local ↔ Bucket**. Choose a **direction**, a **local folder** (native dialog), and a **remote** endpoint (account + bucket + optional prefix).
2. **Preview** → `localSyncPlan` → summary ("N to copy · M up-to-date · X to transfer" + sample). Empty plan → "Already in sync", Run disabled.
3. **Run** → `localSyncRun` (subscribes `onSyncProgress`): progress on bytes + object count + current key, with **Cancel** (`cancelSync`).
4. **Done** → summary: copied count, bytes, and failures (`relKey — code: message`) if any. Canceled runs show "Canceled" with partial counts.

## States & validation

- `idle → planning → planned(plan) → running(progress) → done(result) | canceled | error`.
- Preview disabled until a local folder is chosen AND the remote endpoint has account + bucket.
- No identical/overlap guard (local and bucket are distinct namespaces).
- One run at a time across the Sync section (local + bucket share `activeSync`/`cancel`); while running, Preview is disabled and Cancel is shown.

## Error handling

- **walkDir error** (missing directory, `EACCES`) → `planLocalSync`/`runLocalSync` returns an error `Result` → error toast; no transfer.
- **Listing failure** (remote `AccessDenied`) → error `Result` → toast.
- **Per-file failure** (one upload/download errors) → recorded in `failed[]`; the run continues; summary lists each with code + message.
- **Download** creates parent directories (`mkdir -p`) before writing; a mkdir/write failure fails just that file.
- **Cancel** → partial `SyncResult` with `canceled: true`. Additive-only ⇒ no destructive risk at any point.
- **Empty plan** → "Already in sync"; Run disabled.

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and `aws-sdk-client-mock` + real temp directories (backend), consistent with the codebase.

- **`pool.ts`**: `runPool` processes every item with `> limit` items (refill), and bounds concurrency. (The existing `sync.test.ts` continues to cover it indirectly; one direct test confirms the extraction.)
- **`localSync.ts` `walkDir`** (real temp dir via `mkdtemp`): nested files → correct `relKey`s (`/`-normalized) + sizes; directories recursed; symlinks/non-files skipped.
- **`localSync.ts` upload** (temp dir + mocked S3): empty bucket → `planLocalSync` `toCopy` = file count; `runLocalSync` issues an upload per file (assert `PutObject`/`Upload` calls and keys); a per-file error is collected and the run still completes; an aborted signal stops further uploads → `canceled: true`.
- **`localSync.ts` download** (mocked `listAll` + `GetObject` body, temp dest dir): `runLocalSync` writes each object to disk under the right `relKey`, creating parent directories; a per-file error is collected.
- **`contentTypeFor`**: known extensions map correctly; unknown → `undefined`.
- **IPC `register.test.ts`**: `sync:localPlan`/`sync:localRun` resolve the remote account client; `sync:selectDirectory` returns the injected dep's value.
- **`useLocalSync`**: `plan` calls `window.s3.localSyncPlan`; `run` subscribes to progress and resolves with the result; `cancel` calls `window.s3.cancelSync`.
- **`LocalFolderPicker`**: clicking the button calls `selectSyncDirectory` and reports the chosen path via `onPick`.
- **`LocalSyncScreen`**: direction toggle switches mode; Preview shows the plan summary; empty plan disables Run; Run renders progress then the final summary including failures.
- **`SyncSection`**: the mode toggle renders the bucket screen vs the local screen.

## Dependencies

None new. Uses `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` (existing `uploadObject`/`downloadObject`), Node `fs`/`path` (main process), the bucket-sync engine's pure `diffListings` + types, the reused `EndpointPicker`, `ToastProvider`, TanStack Query, Electron `dialog` (already used for `saveDialog`), and the existing `sync:cancel` + `SYNC_PROGRESS_CHANNEL` IPC.
