# Bucket versioning management & per-object versions — design

## Summary

Add S3 object-versioning support to the app in two cohesive parts on the
`feat/bucket-versioning` branch:

1. **Bucket versioning management** — a new "Versioning" navigation section
   (alongside CORS and Object Lock) that shows a bucket's current versioning
   status and lets the user enable or suspend versioning.
2. **Per-object versions** — a "Versions" action in the file details panel that
   opens a dialog listing every version (and delete marker) of the selected
   object, with per-row actions: download a version, restore an older version as
   the current one, permanently delete a version, and remove a delete marker
   ("undelete").

Both parts mirror the existing bucket-config pattern (`cors`, `objectLock`):
a focused main-process module, typed IPC channels, a renderer query/mutation
hook, and a component — plus i18n across all six locales.

## Decisions made

- **Placement — bucket management:** its own `versioning` nav section, driven by
  the sidebar account/bucket selectors, consistent with `cors` and `objectLock`.
- **Placement — per-object versions:** a toolbar button in `MetadataPanel` opens
  a dismissible `VersionsDialog` (shared `Modal`: Esc + backdrop), consistent
  with the existing Permissions/Metadata dialogs.
- **Versioning status model:** three states — `Unversioned`, `Enabled`,
  `Suspended`. Once enabled, S3 versioning can only be **suspended**, never fully
  disabled; existing versions are retained while suspended and no new versions
  are created. The toggle is Enable/Suspend and the UI states this explicitly.
- **Per-object actions (all four):** download/presign a specific version, restore
  an older version (non-destructive copy-to-latest), permanently delete a version
  (destructive, confirmed), and remove a delete marker (undelete).
- **Version download:** the existing `presignGet` / `downloadObject` IPC gain an
  **optional** `versionId`, reusing the existing save-dialog and presign flow
  rather than duplicating it. Backward compatible — omitting it is today's
  behaviour.
- **Both parts land on `feat/bucket-versioning`.**

## Part A — bucket versioning management

### Backend — `src/main/s3/versioning.ts`

```ts
export type VersioningStatus = 'Unversioned' | 'Enabled' | 'Suspended';

export function getBucketVersioning(
  client: S3Client,
  bucket: string,
): Promise<Result<{ status: VersioningStatus }>>;

export function putBucketVersioning(
  client: S3Client,
  bucket: string,
  enabled: boolean,
): Promise<Result<true>>;
```

- `getBucketVersioning` → `GetBucketVersioningCommand`. Map the SDK `Status`
  field: `'Enabled'` → `Enabled`, `'Suspended'` → `Suspended`, missing/undefined
  → `Unversioned`. Errors go through `toErr` (from `./objects`).
- `putBucketVersioning` → `PutBucketVersioningCommand` with
  `VersioningConfiguration: { Status: enabled ? 'Enabled' : 'Suspended' }`.
- MFA-delete is intentionally never set (out of scope).

### IPC

- `CH.getBucketVersioning` = `'s3:getBucketVersioning'`,
  args `[{ accountId; bucket }]`, res `Result<{ status: VersioningStatus }>`.
- `CH.putBucketVersioning` = `'s3:putBucketVersioning'`,
  args `[{ accountId; bucket; enabled: boolean }]`, res `Result<true>`.
- Handlers in `register.ts` resolve a client from `accountId` via the existing
  account-client helper (same shape as `getBucketCors` / `getObjectLockConfig`).

### Renderer

- `src/renderer/hooks/useBucketVersioning.ts` — a `useQuery` for the status keyed
  on `['bucketVersioning', accountId, bucket]` (enabled only when both are set)
  plus a `useMutation` for enable/suspend that invalidates the status query.
- `src/renderer/components/versioning/VersioningEditor.tsx` — the section body:
  - Shows the current status as a badge (`Unversioned` / `Enabled` / `Suspended`).
  - A primary button: **Enable** when not enabled; **Suspend** when enabled.
  - An explanatory note that suspend keeps existing versions and only stops new
    ones, and that versioning cannot be fully removed once enabled.
  - Loading / error / "pick an account and bucket" empty states matching the
    other selector sections.

### Navigation wiring

- `SectionNav`: add `'versioning'` to the `Section` union and a nav entry with an
  icon (e.g. `FiLayers` / `FiClock` from `react-icons/fi`), placed next to CORS
  and Object Lock.
- `App.tsx`: add `'versioning'` to `SELECTOR_SECTIONS` and render
  `<VersioningEditor accountId={…} bucket={…} />` in the section switch.
- i18n label under `nav.versioning`.

## Part B — per-object versions

### Backend — `src/main/s3/objectVersions.ts`

```ts
export interface ObjectVersion {
  versionId: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
  lastModified: string | null;
  size: number | null;   // null for delete markers
  etag: string | null;   // null for delete markers
}

export function listObjectVersions(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectVersion[]>>;

export function restoreObjectVersion(
  client: S3Client,
  args: { bucket: string; key: string; versionId: string },
): Promise<Result<true>>;

export function deleteObjectVersion(
  client: S3Client,
  args: { bucket: string; key: string; versionId: string },
): Promise<Result<true>>;

export function removeDeleteMarker(
  client: S3Client,
  args: { bucket: string; key: string; versionId: string },
): Promise<Result<true>>;
```

- `listObjectVersions` → `ListObjectVersionsCommand` with `Prefix: key`. Because
  a prefix can match sibling keys, keep only entries whose `Key === key`. Merge
  `Versions` (→ `isDeleteMarker: false`) and `DeleteMarkers`
  (→ `isDeleteMarker: true`, `size: null`, `etag: null`). Paginate while
  `IsTruncated`, carrying `KeyMarker` / `VersionIdMarker`. Sort by
  `lastModified` descending (latest first); within equal timestamps the
  `IsLatest` entry sorts first.
- `restoreObjectVersion` → `CopyObjectCommand` with
  `CopySource` = URL-encoded `${bucket}/${key}?versionId=${versionId}` and
  `Key: key` (same bucket). Default `MetadataDirective` (COPY) preserves
  metadata. This writes a new current version — non-destructive.
- `deleteObjectVersion` / `removeDeleteMarker` → `DeleteObjectCommand` with
  `Bucket`, `Key`, `VersionId`. (Same SDK call; two names for intent/clarity and
  independent i18n/confirmation. `removeDeleteMarker` targets a delete marker's
  version id, which makes the prior version current again.)
- All functions return through `toErr` on failure. Providers that do not support
  versioning surface their native error (e.g. `NotImplemented`) via
  `humanErrorMessage` in the renderer.

### Version-aware download / presign

- Extend the existing `objects.ts` `presignGetUrl` and `downloadObject` to accept
  an **optional** `versionId`, threaded into `GetObjectCommand`. Omitting it is
  unchanged behaviour.
- `ApiMap[CH.presignGet].args` and `ApiMap[CH.downloadObject].args` gain an
  optional `versionId?: string`. `preload` forwards the whole arg object — no
  change there.

### IPC

- `CH.listObjectVersions` = `'s3:listObjectVersions'`,
  args `[{ accountId; bucket; key }]`, res `Result<ObjectVersion[]>`.
- `CH.restoreObjectVersion` = `'s3:restoreObjectVersion'`,
  args `[{ accountId; bucket; key; versionId }]`, res `Result<true>`.
- `CH.deleteObjectVersion` = `'s3:deleteObjectVersion'`,
  args `[{ accountId; bucket; key; versionId }]`, res `Result<true>`.
- `CH.removeDeleteMarker` = `'s3:removeDeleteMarker'`,
  args `[{ accountId; bucket; key; versionId }]`, res `Result<true>`.

### Renderer

- `src/renderer/hooks/useObjectVersions.ts` — a `useQuery` keyed on
  `['objectVersions', accountId, bucket, key]` plus mutations `restore`,
  `remove` (permanent delete), and `removeMarker`, each invalidating the versions
  query (and `remove`/`removeMarker`/`restore` also invalidating the object
  listing so the file browser reflects a changed current version).
- `src/renderer/components/files/VersionsDialog.tsx` — a `Modal`-wrapped dialog:
  - A header with the object key and a close button.
  - A list of versions, newest first. Each row shows: a short version id, last
    modified timestamp, size (`formatBytes`, blank for markers), a **"latest"**
    badge on the current version, and a **"deleted"** badge on delete markers.
  - Per-row actions:
    - Normal version: **Download** (calls the version-aware download), **Restore**
      (if not the latest), **Delete** (permanent, via `ConfirmDialog`).
    - Delete marker: **Remove** (undelete, via `ConfirmDialog`).
  - Loading / error / empty ("no versions / versioning not enabled") states.
- `MetadataPanel`: add a **Versions** button to the action toolbar (e.g.
  `FiClock`) that opens `VersionsDialog` for the selected `objectKey`. Shown
  always; the dialog itself explains when there is only one version.

### i18n

A `versioning.*` namespace across all six locales (en/de/fr/pl/nl/ro):
status labels (`unversioned` / `enabled` / `suspended`), the enable/suspend
buttons and their confirmations, the suspend-keeps-versions note, the nav label,
the dialog title, column headers, the latest/deleted badges, the per-row action
labels, and the permanent-delete / remove-marker confirmation messages.

## Error handling & edge cases

- **Unsupported provider:** versioning / list-versions calls may fail with
  `NotImplemented`, `MethodNotAllowed`, or similar — surfaced as a readable error
  in the section / dialog, not a crash.
- **Suspended bucket:** still lists existing versions; the status badge shows
  `Suspended`.
- **Restore under object lock / retention:** the copy may be rejected by the
  provider; the error is surfaced.
- **Permanent delete under retention / legal hold:** the delete may be rejected;
  the error is surfaced (no optimistic removal before the call resolves).
- **Prefix collision:** `listObjectVersions` filters to exact `Key === key`, so
  sibling keys sharing the prefix are excluded.
- **Delete marker as latest:** the object appears "deleted" in a normal listing;
  the dialog still shows its versions and offers "remove marker" to undelete.

## Testing (TDD)

- `versioning.test.ts`: `getBucketVersioning` maps `Enabled` / `Suspended` /
  missing→`Unversioned`; `putBucketVersioning(true|false)` sends the right
  `Status`; error mapping via mocked client.
- `objectVersions.test.ts`: `listObjectVersions` merges versions + delete markers,
  filters by exact key, sorts latest-first, maps fields (null size/etag for
  markers), paginates; `restoreObjectVersion` sends a `CopyObjectCommand` with a
  correctly encoded `CopySource` + version id; `deleteObjectVersion` /
  `removeDeleteMarker` send `DeleteObjectCommand` with the version id; error
  mapping.
- `objects.test.ts`: `presignGetUrl` / `downloadObject` include `VersionId` when
  given and omit it otherwise.
- `register.test.ts`: the six new handlers resolve a client and delegate; the
  extended presign/download handlers forward `versionId`.
- Hook tests: `useBucketVersioning` (query + enable/suspend invalidation),
  `useObjectVersions` (query + restore/remove/removeMarker invalidation).
- Component tests: `VersioningEditor` renders status and toggles with
  confirmation; `VersionsDialog` renders rows with badges, wires per-row actions
  to mutations, and gates permanent delete / remove-marker behind `ConfirmDialog`;
  `MetadataPanel` shows the Versions button and opens the dialog.

## Out of scope

- MFA-delete (requires account root + an MFA serial).
- Version diff / preview or side-by-side comparison.
- A bucket-wide version listing (versions are viewed per object).
- Lifecycle rules for expiring noncurrent versions.
- Bulk version operations across many objects at once.

## Open questions

None.
