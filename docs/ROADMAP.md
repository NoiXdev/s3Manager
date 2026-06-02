# S3 Manager — Roadmap / Bucket List 🪣

Tracks what's shipped, what's queued, and known follow-ups. Each feature follows the
brainstorm → spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → build cycle.

_Last updated: 2026-06-02._

## ✅ Shipped (on `develop`)

- Backend foundation: accounts (Amazon S3 + Hetzner), OS-keychain secrets, SQLite storage
- UI shell + account management
- Files browsing (buckets, prefixes, objects, breadcrumb)
- Object operations: upload, download, delete, copy presigned URL
- Move / rename / create folders
- Presigned upload (PUT) URLs
- CORS configuration editor
- Object Lock: bucket default retention + per-object retention & legal hold
- Object visibility (public/private) + per-grantee ACL editor
- Dashboard (scan-free, click-through)
- Sync: bucket↔bucket, local↔bucket, global sidebar status indicator
- Settings screen + app settings plumbing
- Object **metadata editor** (Content-Type, Cache-Control, Content-Disposition, custom `x-amz-meta-*`)
- **Create bucket** (name + Object Lock + versioning, created in the account region)
- Feather-icon action buttons across the UI

## 🔜 Backlog — features

Deferred as "out of scope" in shipped specs; natural next steps.

- [ ] **Delete bucket** — natural complement to Create bucket
- [ ] **Rename bucket**
- [ ] **Bucket configuration**: default encryption, public-access-block, tags, lifecycle rules
- [ ] **Region picker** at bucket creation (currently uses the account's region)
- [ ] **Versioning-aware object browsing** — list/view/restore object versions
- [ ] **Bulk / folder metadata edits** (metadata editor is single-object only)

## 🛠️ Follow-ups / tech debt

Surfaced during code review; worth doing before or shortly after release.

- [ ] **Accessibility pass on dialogs** — add `aria-labelledby` + Escape-to-close, drop redundant
      `aria-label`s. Affects `MetadataDialog`, `CreateBucketDialog`, `PermissionsDialog`,
      `UploadLinkDialog`, `MoveDialog`. Best done in one cross-cutting pass.
- [ ] **Preserve `ServerSideEncryption` / `SSEKMSKeyId` on copy-to-self** — `updateObjectMetadata`
      (metadata editor) and the move ops in `transfer.ts` don't re-send encryption headers, so an
      object under a non-default KMS key is re-encrypted under the bucket default. Pre-existing
      gap across all copy-based operations.

## 💡 Ideas / maybe

- [ ] Object preview (text/image) in the metadata panel
- [ ] Multipart/large-file upload progress refinements
- [ ] Per-provider capability gating (e.g. hide Object Lock toggle where unsupported)
