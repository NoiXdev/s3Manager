# S3 Manager — Object Metadata Editor

**Date:** 2026-05-30
**Status:** Approved design
**Scope:** A single feature cycle: edit an object's editable metadata (Content-Type, Cache-Control, Content-Disposition, and custom user metadata) via an "Edit metadata…" dialog. S3 metadata is immutable in place, so edits apply through a copy-to-self with `MetadataDirective: 'REPLACE'`.

## Overview

The metadata panel currently shows object metadata read-only. This feature adds an **"Edit metadata…"** dialog that lets the user change the **Content-Type** (mime), **Cache-Control**, **Content-Disposition**, and the **custom user metadata** (`x-amz-meta-*`) key/value pairs. Because S3 object metadata can't be mutated in place, Save performs a **copy-to-self** (`CopyObject` with the same key and `MetadataDirective: 'REPLACE'`), applying the edited headers while **preserving** the object's storage class, content-encoding, and content-language. The panel's read-only metadata rows refresh after the save.

## Goals

- Edit an object's Content-Type, Cache-Control, Content-Disposition, and custom user metadata.
- Apply edits via a single server-side copy-to-self (`MetadataDirective: 'REPLACE'`), preserving non-edited system headers and storage class.
- Reflect the change in the panel afterward; surface errors clearly.

## Non-Goals (out of scope)

- **Bulk / folder** metadata edits (single object only).
- Editing **immutable** fields (size / ETag / last-modified — read-only; they change as a side effect of the copy).
- **Content-Encoding / Content-Language** as *editable* fields (preserved on save, not exposed for editing).
- Changing **storage class** (preserved).
- Versioning-aware editing (operates on the current version).

## Why this approach

S3 object metadata is immutable; the canonical way to change it is `CopyObject` onto the same key with `MetadataDirective: 'REPLACE'`. A naive REPLACE drops any system headers not re-specified, so the edit op first `HeadObject`s to capture the headers it must preserve (storage class, content-encoding, content-language) and re-sends them alongside the edits — no silent drops, and the data is untouched (server-side copy, same account). The editor's read of current values comes from a dedicated `getEditableMetadata` (a focused HeadObject mapping the editable fields), keeping the shared `headObject`/`ObjectMetadata` and the panel's read-only view unchanged. The dialog mirrors the existing Permissions…/Rename/Move dialog patterns. Saving rewrites the object (its ETag and last-modified change) — a documented, expected side effect.

## Architecture

```
src/main/s3/objectMetadata.ts                          # CREATE: EditableMetadata + getEditableMetadata + updateObjectMetadata
src/main/ipc/channels.ts                               # MODIFY: s3:getEditableMetadata / s3:updateObjectMetadata + ApiMap
src/main/ipc/register.ts                               # MODIFY: 2 handlers
src/preload.ts                                         # MODIFY: 2 methods
src/renderer/hooks/useObjectMetadataEditor.ts          # CREATE: editable query + update mutation
src/renderer/components/files/MetadataDialog.tsx       # CREATE: editor UI
src/renderer/components/files/MetadataPanel.tsx        # MODIFY: "Edit metadata…" button + dialog
```

### Backend (`src/main/s3/objectMetadata.ts`)

Reuses `ok`/`type Result` from `../shared/result`, `toErr` from `./objects`, and `encodeCopyKey` from `./transfer` (no circular import: `objectMetadata` imports from `objects` + `transfer`; neither imports `objectMetadata`).

```ts
export interface EditableMetadata {
  contentType: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  metadata: Record<string, string>;
}
```

- `getEditableMetadata(client, { bucket, key }): Promise<Result<EditableMetadata>>` — `HeadObjectCommand`; maps `{ contentType: out.ContentType ?? null, cacheControl: out.CacheControl ?? null, contentDisposition: out.ContentDisposition ?? null, metadata: out.Metadata ?? {} }`. Errors → `toErr`.
- `updateObjectMetadata(client, { bucket, key, contentType, cacheControl, contentDisposition, metadata }): Promise<Result<true>>`:
  - `const head = await client.send(new HeadObjectCommand({ Bucket, Key }))` — to read `StorageClass`, `ContentEncoding`, `ContentLanguage` (preserved).
  - `await client.send(new CopyObjectCommand({ Bucket, Key, CopySource: \`${bucket}/${encodeCopyKey(key)}\`, MetadataDirective: 'REPLACE', ContentType: contentType || undefined, CacheControl: cacheControl || undefined, ContentDisposition: contentDisposition || undefined, ContentEncoding: head.ContentEncoding, ContentLanguage: head.ContentLanguage, StorageClass: head.StorageClass, Metadata: metadata }))`.
  - Returns `ok(true)`; errors → `toErr`.

(Args type: `contentType`/`cacheControl`/`contentDisposition` are `string | null`; `metadata` is `Record<string, string>`.)

### IPC wiring

- `channels.ts`: `CH.getEditableMetadata = 's3:getEditableMetadata'`, `CH.updateObjectMetadata = 's3:updateObjectMetadata'`. `ApiMap`:
  - `[CH.getEditableMetadata]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<EditableMetadata> }`
  - `[CH.updateObjectMetadata]: { args: [{ accountId: string; bucket: string; key: string; contentType: string | null; cacheControl: string | null; contentDisposition: string | null; metadata: Record<string, string> }]; res: Result<true> }`
  - Imports `EditableMetadata` (type) from `../s3/objectMetadata`.
- `register.ts`: `h(CH.getEditableMetadata, (a) => getEditableMetadata(clientFor(a.accountId), { bucket: a.bucket, key: a.key }))`; `h(CH.updateObjectMetadata, (a) => updateObjectMetadata(clientFor(a.accountId), { bucket: a.bucket, key: a.key, contentType: a.contentType, cacheControl: a.cacheControl, contentDisposition: a.contentDisposition, metadata: a.metadata }))`.
- `preload.ts`: `getEditableMetadata`/`updateObjectMetadata` forwarding to `invoke`.

### Renderer

**`useObjectMetadataEditor(accountId, bucket, key)`**:
- `editable` query (`['editableMetadata', accountId, bucket, key]` → `window.s3.getEditableMetadata`; enabled when all non-null).
- `update` mutation (`{ contentType, cacheControl, contentDisposition, metadata }` → `window.s3.updateObjectMetadata`; `onSuccess` invalidates `['editableMetadata', …]` AND `['objectMetadata', accountId, bucket, key]` so the panel's read-only rows refresh).

**`MetadataDialog`** (`{ accountId, bucket, objectKey, onClose }`): mounts → fetches editable metadata.
- Loading → "Loading metadata…". Error → the error message + Close.
- On success: seed local state from the fetched values (an effect when the query data arrives): `contentType` (string), `cacheControl` (string), `contentDisposition` (string), and `pairs` = the metadata map as an array of `{ key, value }` rows.
- Fields: a **Content-Type** input (aria-label "Content-Type"), a **Cache-Control** input (aria-label "Cache-Control"), a **Content-Disposition** input (aria-label "Content-Disposition"), and a **custom metadata** table — each row a key input (aria-label "Metadata key N" or by index) + value input + a Remove button; an **Add field** button appends an empty `{ key: '', value: '' }` row.
- **Save** (disabled while `update.isPending`): builds `metadata` from rows with a non-empty trimmed key, then `update.mutateAsync({ contentType, cacheControl, contentDisposition, metadata })` → "Metadata saved" toast → `onClose`; **Cancel** → `onClose`. Errors → error toast (dialog stays open).
- A caption notes: "Saving rewrites the object’s metadata (its ETag and last-modified change)."

**MetadataPanel** — add an **"Edit metadata…"** button to the actions row; clicking sets `metadataOpen`; render `{metadataOpen && <MetadataDialog accountId={accountId ?? ''} bucket={bucket ?? ''} objectKey={objectKey} onClose={() => setMetadataOpen(false)} />}`.

## Data flow

1. Select an object → **Edit metadata…** → the dialog fetches the editable metadata.
2. Edit Content-Type / Cache-Control / Content-Disposition and the custom key/value pairs.
3. **Save** → `updateObjectMetadata` (HeadObject to capture preserved headers → CopyObject self `REPLACE`) → toast + close; the panel's metadata rows refetch and show the new values.

## States & error handling

- The dialog shows loading and error states; edits are on a local copy — **Cancel discards** them.
- Empty Content-Type / Cache-Control / Content-Disposition are sent as `undefined` (cleared). Metadata rows with an empty key are dropped from the saved map.
- `updateObjectMetadata` errors (`AccessDenied`; object under active retention/legal hold blocking overwrite; GLACIER objects that can't be copied directly) → error toast; the dialog stays open with the working edits.
- No optimistic update — the panel's read-only metadata refetches after a successful save.
- The copy-to-self preserves storage class, content-encoding, and content-language; only the four editable groups change (plus the unavoidable ETag/last-modified change).

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend).

- **`objectMetadata.ts`**: `getEditableMetadata` maps `ContentType`/`CacheControl`/`ContentDisposition`/`Metadata` (and nulls when absent). `updateObjectMetadata` issues a `HeadObjectCommand` then a `CopyObjectCommand` whose input has `MetadataDirective: 'REPLACE'`, the correct `CopySource` (`bucket/encoded-key`), the edited `ContentType`/`CacheControl`/`ContentDisposition`, the `Metadata` map, and the preserved `StorageClass`/`ContentEncoding`/`ContentLanguage` from the head response.
- **IPC `register.test.ts`**: `s3:getEditableMetadata` returns the mapped value via `clientFor`; `s3:updateObjectMetadata` returns `ok(true)`.
- **`useObjectMetadataEditor`**: `update` calls `window.s3.updateObjectMetadata` and invalidates both `['editableMetadata', …]` and `['objectMetadata', …]`.
- **`MetadataDialog`**: renders seeded Content-Type + a custom pair; editing the Content-Type and adding/removing a pair then Save calls `updateObjectMetadata` with the edited values and the rebuilt metadata map (empty-key rows dropped); a load error shows the message and no Save button.
- **MetadataPanel**: clicking "Edit metadata…" opens the dialog (shows "Loading metadata…" / the Content-Type field).

## Dependencies

None new. Uses `@aws-sdk/client-s3` (`HeadObjectCommand`, `CopyObjectCommand`), `encodeCopyKey` from `transfer.ts`, the existing `ToastProvider`, TanStack Query, and the existing IPC/`Result` conventions.
