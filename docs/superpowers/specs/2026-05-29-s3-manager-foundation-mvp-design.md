# S3 Manager — Foundation + File Manager MVP

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** First build cycle of a larger multi-cycle project.

## Overview

A cross-platform desktop S3 manager (Electron + React + Tailwind 4) that supports
multiple S3-compatible hosters — initially **Amazon S3** and **Hetzner Object
Storage**. This document specs the **first cycle only**: the application
foundation plus a usable File Manager MVP. Later cycles (own spec → plan →
build each) will add bucket↔bucket sync, sync-from-local, full presigned-URL
support, permission/ACL editing, move/rename, a CORS editor, object-lock
management, and a metrics dashboard.

This is intended to become public software, so security of stored credentials
and the renderer↔backend boundary are first-class concerns.

## Goals (this cycle)

- App shell with **section navigation** (Files, and placeholders for Dashboard /
  Object Lock / CORS / Settings) and a **three-pane Files view**
  (accounts → buckets → objects).
- Manage accounts for Amazon S3 and Hetzner (add / edit / remove / test
  connection).
- Browse buckets and objects with prefix-based folder navigation + breadcrumb.
- Drag-and-drop, multi-file upload with per-file progress.
- Download objects to local disk.
- Delete files and folders (with confirmation).
- Copy a presigned **GET** URL to the clipboard.
- Show a visibility (public/private) indicator for buckets/objects.
- Object metadata panel.

## Non-Goals (deferred to later cycles)

- Bucket↔bucket sync; sync from local.
- Presigned URLs for PUT / other methods.
- Changing permissions / ACLs.
- Moving / renaming files and folders.
- CORS configuration editor.
- Object-lock management.
- Metrics dashboard.

## Architecture

### Process model

Three layers with a strict security boundary:

1. **Renderer (React + Tailwind 4)** — pure UI. Talks only to `window.s3.*`,
   thin wrappers over IPC. No AWS SDK, no secret keys, no `fs`, no raw
   `ipcRenderer`.
2. **Preload bridge (`preload.ts`)** — declares the typed API surface via
   `contextBridge` and forwards each call over `ipcRenderer.invoke`. This is the
   single, auditable contract between UI and backend.
3. **Main process** — owns everything sensitive: the S3 clients (AWS SDK v3),
   the OS keychain (`safeStorage`), the SQLite DB, and the local filesystem for
   uploads/downloads. Split into focused service modules (see below), not one
   large file.

Electron hardening: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. Existing Electron Fuses (from the Forge starter) are kept.

### Main-process module layout (target)

```
src/main/
  index.ts                  // app lifecycle, window creation, registers IPC
  ipc/
    register.ts             // wires channel name -> handler
    channels.ts             // shared channel name constants + payload types
  s3/
    clientFactory.ts        // connection profile -> AWS SDK v3 S3Client
    providers.ts            // provider registry (endpoint/path-style defaults)
    objects.ts              // list/upload/download/delete/head/presign ops
    visibility.ts           // capability fns: read public/private state
  storage/
    db.ts                   // better-sqlite3 connection + migrations
    accountsRepo.ts         // CRUD for accounts (non-secret)
    settingsRepo.ts         // key/value app settings
    secrets.ts              // safeStorage get/set/delete secret by account id
  shared/
    result.ts               // Result<T> discriminated union helpers

src/preload.ts              // typed window.s3 bridge
src/renderer/               // React app (entry from index.html / renderer.ts)
  app shell, Files view, components, hooks (React Query)
```

Exact filenames may shift slightly during implementation, but the
responsibilities and boundaries above are the contract.

### Tech choices

- **AWS SDK v3** — `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`,
  `@aws-sdk/lib-storage` (multipart upload). One client, two providers via
  endpoint/path-style config.
- **better-sqlite3** — synchronous SQLite in the main process for non-secret
  config.
- **Electron `safeStorage`** — encrypted, OS-backed storage for secret access
  keys.
- **React 18 + Tailwind CSS 4** in the renderer.
- **TanStack Query (React Query)** — async listing/loading/cache state.
- **Vitest** + **aws-sdk-client-mock** for tests.

## Provider abstraction

Hetzner Object Storage is S3-compatible, so there are no divergent provider
classes. A single client factory takes a connection profile and returns a
configured AWS SDK v3 `S3Client`:

```
amazon-s3 → endpoint derived from region (s3.<region>.amazonaws.com),
            forcePathStyle: false
hetzner   → endpoint: <region>.your-objectstorage.com,
            forcePathStyle: true
```

A `providers` registry maps `provider id → defaults` (endpoint template,
path-style flag, region hints). Adding a future provider = one registry entry.
Provider-specific quirks (e.g. how public/private is determined) are isolated
behind small capability functions in `visibility.ts` so the rest of the app
stays generic.

## Data model

### SQLite (non-secret only)

```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,   -- uuid
  label         TEXT NOT NULL,      -- "AWS prod"
  provider      TEXT NOT NULL,      -- "amazon-s3" | "hetzner"
  endpoint      TEXT NOT NULL,      -- resolved or custom endpoint
  region        TEXT NOT NULL,
  access_key_id TEXT NOT NULL,      -- public half; safe to store
  created_at    INTEGER NOT NULL
);

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL               -- theme, last-opened account/bucket, etc.
);
```

A lightweight migration runner in `db.ts` applies versioned schema changes on
startup.

### Secret storage

The **secret access key** is stored via `safeStorage`, keyed by `account.id`.
SQLite never stores the secret. On startup, if
`safeStorage.isEncryptionAvailable()` is false (rare Linux setups), the app warns
the user clearly that secrets cannot be stored securely.

## S3 object / folder semantics

S3 has no real folders — only keys. The UI renders folders by listing with
`Delimiter: "/"` and a `Prefix`:

- `CommonPrefixes` → folders.
- `Contents` → files.
- Breadcrumb navigation adjusts the `Prefix`.

Listing uses `ListObjectsV2` and is **paginated** (1000 keys/page). The UI loads
page-by-page (infinite scroll / "load more") rather than fetching the entire
bucket, so very large buckets stay responsive.

Folder delete = delete all keys under the prefix in batched
`DeleteObjects` calls (1000 keys/batch).

## UI design

### App shell

Left rail = **section nav**: Files (active), Dashboard, Object Lock, CORS,
Settings. Non-Files sections are placeholders this cycle.

### Files view (three-pane)

- **Pane 1 — Accounts**: configured accounts with provider badge; "+ Add
  account" opens a form (label, provider, region/endpoint, access key, secret)
  with a **Test connection** action before saving.
- **Pane 2 — Buckets**: buckets for the selected account (`ListBuckets`); each
  row shows a **visibility badge**.
- **Pane 3 — File browser**: breadcrumb (prefix path) + a table of folders and
  objects.
  - Columns: name, size, last-modified, visibility. Folders sort first.
  - Selecting a row opens the **metadata panel** (right slide-over): full key,
    size, content-type, last-modified, storage class, ETag, custom metadata
    (`HeadObject`).
  - **Drag-and-drop upload**: dropping files onto the browser shows an overlay
    and uploads to the current prefix; multi-file with a per-file progress list;
    multipart via `@aws-sdk/lib-storage`.
  - Actions (per-row + toolbar): **Download** (native save dialog → streamed to
    disk), **Copy signed URL (GET)** (presigned, default 1h expiry, copied to
    clipboard with a toast), **Delete** (confirm; folders batch-delete).

### Empty / loading / error states (first-class)

- No accounts → onboarding card prompting to add the first account.
- Empty bucket/prefix → "drop files to upload" prompt.
- Failed list/op → inline error with retry.

## Error handling

Every IPC handler returns a discriminated result rather than throwing across the
boundary:

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

The renderer maps known S3 error codes (AccessDenied, NoSuchBucket,
network/timeout, invalid credentials) to friendly inline messages with retry.
**Secrets are never included in error payloads or logs.**

## Testing strategy (TDD)

Tests are written first throughout.

**Unit tests (Vitest), no network — covering the real-risk logic:**

- Provider registry / endpoint resolution (amazon-s3 + hetzner).
- Prefix ↔ breadcrumb mapping.
- `CommonPrefixes`/`Contents` → folder/file transform.
- Presign parameter building.
- SQLite repositories (`accountsRepo`, `settingsRepo`) against an in-memory DB.
- `Result<T>` mapping / error-code translation.

**S3 handler tests:** mocked via `aws-sdk-client-mock` so list/upload/download/
delete/head/presign handlers are deterministic without a real bucket.

**Manual smoke checklist** (things automated tests can't cover; run against a
real AWS account and a real Hetzner account before release):

1. Add an Amazon S3 account; Test connection succeeds.
2. Add a Hetzner account; Test connection succeeds.
3. List buckets; visibility badges render.
4. Navigate into a prefix and back via breadcrumb.
5. Drag-drop 3 files (incl. one large >100MB); progress completes; objects
   appear.
6. Download a file via save dialog; bytes match.
7. Copy presigned GET URL; opening it in a browser downloads the object.
8. Open metadata panel; fields populate from `HeadObject`.
9. Delete a file and a folder (with confirm); list refreshes.
10. Restart the app; accounts persist, secrets still work, no plaintext secret
    on disk.

## Dependencies to add

Runtime: `react`, `react-dom`, `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage`, `better-sqlite3`,
`@tanstack/react-query`, `uuid`.

Dev: `@vitejs/plugin-react`, `tailwindcss@4` (+ its Vite plugin), `vitest`,
`aws-sdk-client-mock`, `@types/react`, `@types/react-dom`,
`@types/better-sqlite3`, `@types/uuid`.

Note: `better-sqlite3` is a native module — Electron Forge's
`auto-unpack-natives` plugin (already configured) handles packaging.

## Open implementation notes

- TypeScript is currently at `~4.5.4` with `module: commonjs`; the
  implementation plan should bump TypeScript and adjust tsconfig for React/JSX
  and modern module resolution.
- Confirm the exact Hetzner endpoint host template during implementation
  (`<region>.your-objectstorage.com`) against current Hetzner docs.
