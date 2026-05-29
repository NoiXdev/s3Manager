# S3 Manager — Move / Rename / Create Folders

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle (new backend transfer ops + rename/move/new-folder UI), built on the completed File Manager MVP, Dashboard, CORS, and Object Lock (all merged to `develop`).

## Overview

Add folder creation and rename/move for both files and folders, **within a single bucket**. S3 has no native move/rename (it's Copy + Delete) and no native folders (a "folder" is a key prefix; creating one is a zero-byte `…/` object). New main-process operations wrap those mechanics; the renderer adds a New-folder button, Rename/Move actions for files (in the metadata panel) and folders (row buttons), a reusable name dialog, and a folder-picker move dialog.

## Goals

- **Create a folder** under the current prefix.
- **Rename a file** (change its name in place) and **move a file** (to another folder in the bucket).
- **Rename a folder** and **move a folder** (recursively copy all contained objects to the new prefix, then delete the originals).
- Friendly UX: a simple Rename (name only) and a Move dialog with a folder picker that browses the bucket.

## Non-Goals (out of scope)

- **Cross-bucket move** — that is the Sync feature.
- Transactional rollback of a partially-completed folder move (a mid-move failure may leave some objects copied; surfaced via error).
- Drag-and-drop move.
- Overwrite-confirmation prompts (S3 copy overwrites silently; we don't pre-check).

## Why copy+delete / prefix markers

S3 keys are immutable: "renaming" or "moving" an object means `CopyObject` to the new key then `DeleteObject` of the old one. A "folder" is just a shared key prefix, so renaming/moving a folder means doing that for **every** object under the prefix (paginated, like `deleteFolder`). Creating a folder means putting a single empty object whose key ends in `/`, so the prefix appears in listings even when empty.

## Architecture

Renderer UI on top of three new main-process operations in a **new `src/main/s3/transfer.ts`** module (multi-step copy/delete operations, distinct from the single-shot ops in the large `objects.ts`).

### Backend operations (`src/main/s3/transfer.ts`)

Each takes an `S3Client` and returns a `Result` (from `../shared/result`), catching errors via `toErr` (from `./objects`).

- `createFolder(client, { bucket, prefix, name }): Promise<Result<{ key: string }>>` — rejects an empty `name` or one containing `/` (`err('InvalidName', …)`); otherwise `PutObjectCommand` with `Key: \`${prefix}${name}/\``, empty `Body`. Returns the created key.
- `moveObject(client, { bucket, sourceKey, destKey }): Promise<Result<{ key: string }>>` — rejects empty `destKey` or `destKey === sourceKey` (`err('InvalidDestination', …)`); otherwise `CopyObjectCommand` (`CopySource: \`${bucket}/${encodeCopyKey(sourceKey)}\``, `Key: destKey`) then `DeleteObjectCommand` (`Key: sourceKey`). Returns `{ key: destKey }`.
- `moveFolder(client, { bucket, sourcePrefix, destPrefix }): Promise<Result<{ count: number }>>` — rejects empty/`/`-only `sourcePrefix` or `destPrefix`, and rejects when `destPrefix` starts with `sourcePrefix` (moving a folder into itself) (`err('InvalidDestination', …)`). Otherwise paginates `ListObjectsV2` under `sourcePrefix`; for each key, `CopyObjectCommand` to `destPrefix + key.slice(sourcePrefix.length)`; after copying a page's keys, batch-`DeleteObjectsCommand` the originals (1000/batch). Returns `{ count }` (objects moved).

**CopySource encoding** (`encodeCopyKey`): `encodeURIComponent(sourceKey).replace(/%2F/g, '/')` — encodes spaces and special characters but preserves the `/` path separators (the AWS SDK v3 does not auto-encode `CopySource`).

How UI operations map:
- Rename file → `moveObject(key → parentPrefix(key) + newName)`.
- Move file → `moveObject(key → destPrefix + name)`.
- Rename folder → `moveFolder(prefix → parentPrefix(prefix) + newName + "/")`.
- Move folder → `moveFolder(prefix → destPrefix + name + "/")`.

(`parentPrefix` for a key/prefix = substring up to and including the last `/` before the final segment; for a top-level item it's `""`.)

### Wiring

- `channels.ts`: `CH.createFolder` (`'s3:createFolder'`), `CH.moveObject` (`'s3:moveObject'`), `CH.moveFolder` (`'s3:moveFolder'`), with `ApiMap` entries:
  - `createFolder`: args `[{ accountId, bucket, prefix, name }]`, res `Result<{ key: string }>`.
  - `moveObject`: args `[{ accountId, bucket, sourceKey, destKey }]`, res `Result<{ key: string }>`.
  - `moveFolder`: args `[{ accountId, bucket, sourcePrefix, destPrefix }]`, res `Result<{ count: number }>`.
- `register.ts`: three handlers via `h` + `clientFor(accountId)`.
- `preload.ts`: three `window.s3` methods forwarding to `invoke`.

No secrets cross the boundary.

## UI

### File structure

```
src/renderer/
  hooks/useTransfer.ts                              # createFolder / moveObject / moveFolder mutations
  lib/keys.ts                                       # parentPrefix(keyOrPrefix), baseName helpers (pure) + test
  components/transfer/NameDialog.tsx                # generic name prompt (new folder / rename)
  components/transfer/FolderPicker.tsx              # in-dialog bucket folder browser
  components/transfer/MoveDialog.tsx                # wraps FolderPicker; resolves a destination prefix
  components/files/FileBrowser.tsx                  # MODIFY: New-folder button; folder-row Rename/Move
  components/files/MetadataPanel.tsx                # MODIFY: file Rename/Move actions
```

`src/renderer/lib/keys.ts` holds pure helpers (`parentPrefix`, `baseName`) used by the rename/move wiring; tested in isolation. (Renderer-local; the main process already has prefix helpers in `listTransform.ts`, but those aren't bundled for this renderer logic — a tiny renderer util avoids a cross-process import for two one-liners.)

### Components & behavior

- **`NameDialog`** (`{ title, initialValue, confirmLabel, onConfirm(name), onCancel }`) — modal with a text input prefilled with `initialValue`; Confirm calls `onConfirm(trimmedName)`. Confirm disabled when the name is empty or contains `/`.
- **`FolderPicker`** (`{ accountId, bucket, onPick(prefix), disabledPrefix? }`) — browses the bucket's folders using the existing `useObjects(accountId, bucket, pickerPrefix)`: shows subfolders as a navigable list (click to descend), a breadcrumb to ascend, the current destination prefix, and a "Move here" button calling `onPick(pickerPrefix)`. `disabledPrefix` (the source folder's prefix, for folder moves) disables navigating into / picking that prefix or its descendants.
- **`MoveDialog`** (`{ accountId, bucket, item, onClose }`) — hosts `FolderPicker`; `item` is the file/folder being moved (carries its current parent + name + kind). On "Move here": file → `moveObject(item.key → dest + item.name)`; folder → `moveFolder(item.prefix → dest + item.name + "/")`. Disables a destination equal to the item's current parent (no-op).
- **`useTransfer(accountId, bucket)`** — returns `createFolder`, `moveObject`, `moveFolder` mutations; each invalidates `['objects', accountId, bucket]` on success.

### Where the actions live

- **New folder** — a button in the FileBrowser toolbar (next to the breadcrumb) → `NameDialog` (blank) → `createFolder({ bucket, prefix: currentPrefix, name })`.
- **Files** — in the **MetadataPanel** (a file is selected), alongside Download / Copy URL / Delete: **Rename** (→ `NameDialog` prefilled with the file name → `moveObject`) and **Move** (→ `MoveDialog` → `moveObject`). After a successful rename/move the panel closes (the selected key no longer exists).
- **Folders** — folder rows (which already have a Delete ✕) gain small **Rename** (✎) and **Move** (➜) buttons, each calling `e.stopPropagation()` so they don't navigate into the folder. Rename → `NameDialog` prefilled with the folder name → `moveFolder` (rename). Move → `MoveDialog` → `moveFolder`.

## Data flow

1. **New folder:** toolbar button → NameDialog → `useTransfer.createFolder` → toast + listing refetch.
2. **Rename file:** panel Rename → NameDialog (file name) → `moveObject(key → parent + newName)` → toast + refetch + close panel.
3. **Move file:** panel Move → MoveDialog/FolderPicker → pick dest → `moveObject(key → dest + name)` → toast + refetch + close panel.
4. **Rename folder:** row ✎ → NameDialog (folder name) → `moveFolder(prefix → parent + newName + "/")` → toast + refetch.
5. **Move folder:** row ➜ → MoveDialog/FolderPicker (source prefix disabled) → pick dest → `moveFolder(prefix → dest + name + "/")` → toast + refetch.

## States & error handling

- **Pending:** rename/move/create actions show a pending state (disabled button / "…") while in flight; folder operations may be slow (recursive).
- **Validation:** NameDialog Confirm disabled on empty / contains `/`. MoveDialog "Move here" disabled when destination equals the current parent (no-op) or is the source folder/a descendant (for folder moves). Backend re-validates `destKey !== sourceKey` and `destPrefix` not inside `sourcePrefix`.
- **Success:** toasts — "Folder created", "Renamed", "Moved"; listing refetches; metadata panel closes for a renamed/moved file.
- **Errors** (`AccessDenied`, network, partial folder move) → error toast with code+message; the dialog stays open. A folder move that fails midway may leave some objects copied (no rollback — out of scope).

## Testing

Vitest + React Testing Library against a mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend ops), consistent with the existing codebase.

- **`transfer.ts`** — `createFolder` puts an empty object at `prefix+name+"/"`; rejects empty/`/`-containing name. `moveObject` issues `CopyObjectCommand` with the correctly-encoded `CopySource` then `DeleteObjectCommand`; rejects `destKey === sourceKey`/empty. `moveFolder` paginates, copies each key rebased onto `destPrefix`, batch-deletes the originals, returns the count; rejects empty/root prefix and dest-inside-source.
- **`lib/keys.ts`** — `parentPrefix` and `baseName` for files (`images/logo.png` → `images/` + `logo.png`), folders (`images/old/` → `images/` + `old`), and top-level items (`""` + name).
- **IPC register** — the three channels are registered and call the ops with `clientFor(accountId)`.
- **`NameDialog`** — Confirm emits the trimmed name; disabled on empty / contains `/`.
- **`FolderPicker`** — lists folders, navigates in/up, "Move here" emits the current prefix; disables the source folder's prefix.
- **`useTransfer`** — create/move mutations call the right `window.s3` method and invalidate the listing.
- **`MetadataPanel`** — Rename opens NameDialog → `moveObject(key → parent+newName)`; Move opens MoveDialog → `moveObject`.
- **`FileBrowser`** — New folder → NameDialog → `createFolder`; folder-row Rename → `moveFolder` rename; folder-row Move → MoveDialog → `moveFolder`.

## Dependencies

None new. Uses the installed `@aws-sdk/client-s3` (`CopyObjectCommand`, `PutObjectCommand`, `DeleteObjectCommand`, `DeleteObjectsCommand`, `ListObjectsV2Command` — all present), the existing `useObjects` hook (for the folder picker), `ToastProvider`, and the existing dialog patterns.
