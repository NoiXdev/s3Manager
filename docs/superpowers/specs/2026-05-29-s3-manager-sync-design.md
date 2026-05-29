# S3 Manager — Bucket-to-Bucket Sync

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle (one-way bucket→bucket sync engine + a Sync screen), built on the completed File Manager, Dashboard, CORS, Object Lock, and Move/Rename/Folders features (all merged to `develop`).

## Overview

Add one-way **bucket → bucket** synchronization: make a destination bucket/prefix contain everything in a source bucket/prefix. Source and destination may belong to **different accounts or providers** (e.g. migrate AWS → Hetzner). Sync is **additive** (it never deletes) and re-copies an object only when it is **missing on the destination or differs in byte size**. The user previews a **plan** (what will be copied, how many bytes) before any bytes move, then runs the transfer with live progress and a cancel button.

The transfer takes the efficient path per object: **same-account** pairs use server-side `CopyObject` (no data egress through the app); **cross-account/provider** pairs stream `GetObject` → `Upload` (lib-storage, multipart + progress).

## Goals

- Diff a source and destination bucket/prefix and copy objects that are **missing** or **size-different** on the destination.
- Support **any** source/destination account or provider pairing.
- **Preview** the plan (objects to copy, objects already up-to-date, total bytes) before transferring.
- **Live progress** during the run (bytes transferred, object count, current key) with a **cancel** button.
- Per-object error isolation: one failing object does not abort the run; failures are summarized at the end.

## Non-Goals (out of scope)

- **Two-way sync** / conflict resolution. (One-way, source → destination only.)
- **Deleting destination extras** (mirror / `--delete`). Sync is additive-only.
- **Local ↔ bucket** sync. (A separate future cycle.)
- **Resumable / persistent jobs**, sync history, scheduling, background queue.
- **ETag / checksum comparison.** ETags are not portable across providers (multipart + provider differences produce different ETags for identical bytes), so comparison is by **size only**.
- **Multiple concurrent sync runs.** One run at a time.
- **Streaming diff for very large buckets.** Both full listings are held in memory as `relKey → size` maps; multi-million-object buckets are a known scale limitation (noted, not handled).

## Why this approach

S3 has no native cross-bucket sync. The engine lists both sides fully, diffs them in memory by relative key + size, and transfers the difference. Splitting **plan** (diff + summary) from **run** (diff + transfer) satisfies the preview-then-run requirement and keeps the diff logic a pure, unit-testable function. The run re-runs the diff at execution time so it acts on current state, not a possibly-stale preview.

Cross-account/provider copies cannot use `CopyObject` (its `CopySource` is resolved by the *destination* client's credentials, which can't read another account's/provider's bucket), so those objects are streamed through the app: `GetObject` on the source client produces a body that is piped into a lib-storage `Upload` on the destination client. Same-account copies use server-side `CopyObject`, which is far cheaper (no egress through the app).

## Architecture

```
src/main/s3/syncDiff.ts          # PURE: diffListings(source[], dest[]) -> SyncOp[]  (+ types)
src/main/s3/sync.ts              # listAll, planSync, runSync, copyOne  (uses two S3 clients)
src/main/ipc/channels.ts         # MODIFY: sync:plan, sync:run, sync:cancel + SYNC_PROGRESS_CHANNEL/SyncProgress
src/main/ipc/register.ts         # MODIFY: 3 handlers (resolve two clients + sameAccount), active-run AbortController
src/preload.ts                   # MODIFY: planSync / runSync / cancelSync / onSyncProgress
src/renderer/hooks/useSync.ts    # plan + run + progress subscription + cancel
src/renderer/components/sync/EndpointPicker.tsx   # account + bucket dropdowns + prefix input
src/renderer/components/sync/SyncScreen.tsx       # source/dest pickers, preview, run, progress, summary
src/renderer/<nav>               # MODIFY: add a "Sync" section to the section nav
```

### Pure diff core (`src/main/s3/syncDiff.ts`)

```ts
export interface SyncObject { relKey: string; size: number }   // key with the endpoint prefix stripped
export interface SyncOp { relKey: string; size: number; reason: 'missing' | 'size' }

export function diffListings(source: SyncObject[], dest: SyncObject[]): SyncOp[];
```

Build a `Map<relKey, size>` from `dest`. For each `source` object: if the dest map has no entry → op `{ reason: 'missing' }`; else if the dest size differs → op `{ reason: 'size' }`; else skip. Destination-only keys are ignored (additive). Returns the ops to copy, in source order.

### Engine (`src/main/s3/sync.ts`)

```ts
export interface Endpoint { accountId: string; bucket: string; prefix: string }

export interface SyncPlan {
  toCopy: number;
  upToDate: number;        // source objects already present with matching size
  bytesToCopy: number;     // sum of op.size
  sample: SyncOp[];        // first N (e.g. 100) ops, for display
}

export interface SyncFailure { key: string; code: string; message: string }
export interface SyncResult {
  copied: number;
  bytesCopied: number;
  failed: SyncFailure[];
  canceled: boolean;
}

export interface SyncProgress {           // defined here in sync.ts; channels.ts imports it as a type
  phase: 'listing' | 'copying' | 'done';
  copied: number;
  total: number;
  bytesCopied: number;
  bytesTotal: number;
  failed: number;
  currentKey?: string;
}
```

- `listAll(client, bucket, prefix): Promise<SyncObject[]>` — paginate `ListObjectsV2Command` with **no `Delimiter`** (fully recursive), `Prefix: prefix || undefined`; map each `Contents` entry to `{ relKey: key.slice(prefix.length), size: Size ?? 0 }`. (A folder marker whose key equals the prefix yields `relKey === ''`; skip empty `relKey`.)
- `planSync(srcClient, dstClient, source, dest): Promise<Result<SyncPlan>>` — `listAll` both sides, `diffListings`, compute `toCopy = ops.length`, `bytesToCopy = Σ op.size`, `upToDate = sourceList.length - ops.length`, `sample = ops.slice(0, 100)`. Errors via `toErr`.
- `runSync(srcClient, dstClient, source, dest, opts): Promise<Result<SyncResult>>` where `opts = { sameAccount: boolean; onProgress?: (p: SyncProgress) => void; signal?: AbortSignal }`:
  - Emit `{ phase: 'listing' }`. `listAll` both sides, `diffListings`. `bytesTotal = Σ op.size`, `total = ops.length`.
  - Transfer ops through a **concurrency pool of ~6**. For each completed op: increment `copied`/`bytesCopied`, emit `{ phase: 'copying', currentKey, ... }`. On per-op error: push to `failed`, continue.
  - Between scheduling, check `signal?.aborted`; if aborted, stop scheduling new transfers, let in-flight ones settle, return `{ ..., canceled: true }`.
  - Emit `{ phase: 'done' }`. Return `ok(SyncResult)`. Listing errors → `toErr` (whole run fails).
- `copyOne(srcClient, dstClient, source, dest, op, sameAccount): Promise<void>` (throws on failure, caught by the pool):
  - **sameAccount:** `dstClient.send(new CopyObjectCommand({ Bucket: dest.bucket, CopySource: \`${source.bucket}/${encodeCopyKey(source.prefix + op.relKey)}\`, Key: dest.prefix + op.relKey }))`. Reuse `encodeCopyKey` (already exported from `src/main/s3/transfer.ts`).
  - **cross-account/provider:** `const out = await srcClient.send(new GetObjectCommand({ Bucket: source.bucket, Key: source.prefix + op.relKey }));` then `await new Upload({ client: dstClient, params: { Bucket: dest.bucket, Key: dest.prefix + op.relKey, Body: out.Body as Readable, ContentType: out.ContentType } }).done();`

The engine takes `sameAccount` as a parameter and never touches the account store or Electron — the IPC layer computes it (`source.accountId === dest.accountId`) and resolves both clients.

### IPC wiring

`channels.ts`:
- `CH.syncPlan = 'sync:plan'`, `CH.syncRun = 'sync:run'`, `CH.syncCancel = 'sync:cancel'`.
- `ApiMap`:
  - `[CH.syncPlan]: { args: [{ source: Endpoint; dest: Endpoint }]; res: Result<SyncPlan> }`
  - `[CH.syncRun]: { args: [{ source: Endpoint; dest: Endpoint }]; res: Result<SyncResult> }`
  - `[CH.syncCancel]: { args: []; res: Result<true> }`
- One-way progress channel mirroring uploads: `export const SYNC_PROGRESS_CHANNEL = 's3:syncProgress';`. To keep imports one-directional (no `channels ↔ sync` cycle), **all sync types live in `sync.ts`** (`Endpoint`, `SyncPlan`, `SyncResult`, `SyncFailure`, `SyncProgress`) and `syncDiff.ts` (`SyncObject`, `SyncOp`); `channels.ts` defines only the `SYNC_PROGRESS_CHANNEL` const and imports `Endpoint`/`SyncPlan`/`SyncResult` (and re-exports `SyncProgress` for the preload/renderer) as types from `sync.ts`. `preload.ts` imports the types it needs from `channels.ts`.

`register.ts`:
- Import `planSync`, `runSync` from `../s3/sync`. Keep a module-scoped `activeSync: AbortController | null`.
- `h(CH.syncPlan, (a) => planSync(clientFor(a.source.accountId), clientFor(a.dest.accountId), a.source, a.dest))`.
- `h(CH.syncRun, (a, event) => { const controller = new AbortController(); activeSync = controller; const sender = event.sender; return runSync(clientFor(a.source.accountId), clientFor(a.dest.accountId), a.source, a.dest, { sameAccount: a.source.accountId === a.dest.accountId, signal: controller.signal, onProgress: (p) => sender.send(SYNC_PROGRESS_CHANNEL, p) }).finally(() => { if (activeSync === controller) activeSync = null; }); })` — mirrors the existing upload handler's `event.sender.send(UPLOAD_PROGRESS_CHANNEL, …)` pattern.
- `h(CH.syncCancel, () => { activeSync?.abort(); return ok(true); })`.

`preload.ts`:
- `planSync`, `runSync`, `cancelSync` forwarding to `invoke(...)`.
- `onSyncProgress(cb)` using `ipcRenderer.on(SYNC_PROGRESS_CHANNEL, listener)` returning an unsubscribe, exactly like `onUploadProgress`.

No secrets cross the boundary; the renderer passes only account IDs.

### Renderer

- **Sync section** added to the section nav (alongside Files, Dashboard, CORS, Object Lock).
- **`EndpointPicker`** (`{ label, value: Endpoint-ish, onChange }`) — an account dropdown + bucket dropdown + prefix text input. Reuse the existing account/bucket dropdown components used by the CORS and Dashboard screens (verify the reusable picker during planning; otherwise compose the same `useAccounts` + bucket-list query those screens use).
- **`SyncScreen`** — two `EndpointPicker`s (Source, Destination), a **Preview** button, a plan summary panel, a **Run sync** button, a live progress panel, and a final summary.
- **`useSync()`** — exposes:
  - `plan` mutation → `window.s3.syncPlan({ source, dest })`.
  - `run` → calls `window.s3.syncRun({ source, dest })`, subscribes `onSyncProgress` for the duration, exposes `progress` state; resolves with the `SyncResult`.
  - `cancel` → `window.s3.cancelSync()`.

## Data flow

1. User selects **Source** and **Destination** endpoints (account + bucket + optional prefix).
2. **Preview** → `syncPlan` → summary panel: "*N to copy · M up-to-date · X to transfer*" plus the sample list (first 100, with `missing`/`size` reason). If `toCopy === 0` → "Already in sync", Run disabled.
3. **Run sync** → `syncRun` (subscribes `onSyncProgress`): progress bar on `bytesCopied / bytesTotal`, `copied / total` count, `currentKey`, and a **Cancel** button (`cancelSync`).
4. **Done** → summary: copied count, bytes copied, and a failures list (`key — code: message`) if any. Canceled runs show "Canceled" with the partial counts.

## States & validation

- `idle → planning → planned(plan) → running(progress) → done(result) | canceled | error`.
- **Preview** disabled until both endpoints have an account + bucket.
- **Identical endpoint** (same account + bucket + prefix) is refused (no-op) with an inline message.
- **Same-bucket overlapping prefixes** where the destination prefix is inside the source prefix (or equal) are refused — a self-feeding copy — reusing the `moveFolder` into-itself guard idea (`dest.prefix.startsWith(source.prefix)` when same account + bucket).
- One run at a time; while a run is active, Preview/Run are disabled and Cancel is shown.

## Error handling

- **Per-object failure** (e.g. a single `AccessDenied`/network error) → recorded in `failed[]`; the run continues. Final summary lists each failure with code + message.
- **Listing failure** on either side → `planSync`/`runSync` returns an error `Result` → error toast; no transfer occurs.
- **Cross-provider stream error** mid-object → that object's `copyOne` throws, is caught by the pool, recorded as a failure; other objects continue.
- **Cancel** → `runSync` stops scheduling, lets in-flight transfers settle, returns `{ canceled: true }` with partial counts. Additive-only ⇒ no destructive risk at any point.
- **Empty plan** → "Already in sync"; Run disabled.

## Testing

Vitest + React Testing Library against mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend), consistent with the existing codebase.

- **`syncDiff.ts`** (pure): missing key → `missing` op; differing size → `size` op; equal key+size → skipped; destination-only key → ignored; relative-key handling (prefix stripped) correct.
- **`sync.ts`** (two mocked `S3Client`s): `listAll` paginates and strips the prefix (skips the `relKey === ''` marker); `planSync` returns correct `toCopy`/`upToDate`/`bytesToCopy`/`sample`; `runSync` with `sameAccount: true` issues `CopyObjectCommand` (correct `CopySource`/`Key`); with `sameAccount: false` issues `GetObjectCommand` then a lib-storage `Upload` (mock `PutObject`/multipart); a per-object failure is collected in `failed[]` and the run still completes the rest; an already-aborted `signal` stops further copies and returns `canceled: true`.
- **IPC `register.test.ts`**: `sync:plan` and `sync:run` resolve `clientFor(source)` + `clientFor(dest)` and pass `sameAccount`; `sync:run` forwards progress via `event.sender.send`; `sync:cancel` aborts the active run.
- **`useSync`**: `plan` calls `window.s3.syncPlan`; `run` subscribes to progress and resolves with the result; `cancel` calls `window.s3.cancelSync`.
- **`SyncScreen`**: Preview shows the plan summary; empty plan disables Run; Run renders progress then the final summary including a failures list; identical/overlapping endpoints are refused.

## Dependencies

None new. Uses the installed `@aws-sdk/client-s3` (`ListObjectsV2Command`, `CopyObjectCommand`, `GetObjectCommand`), `@aws-sdk/lib-storage` (`Upload`, already used by uploads), `encodeCopyKey` from `transfer.ts`, the existing account/bucket selection components, `ToastProvider`, TanStack Query, and the upload-progress IPC pattern (one-way main→renderer event channel).
