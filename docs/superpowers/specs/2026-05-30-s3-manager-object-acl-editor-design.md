# S3 Manager — Per-Grantee Object ACL Editor

**Date:** 2026-05-30
**Status:** Approved design
**Scope:** A single feature cycle: view and edit a single object's full S3 ACL (owner + per-grantee grants) in a "Permissions…" dialog. The deeper half of permissions, beyond the existing public/private visibility toggle.

## Overview

The app already exposes a quick public/private **visibility toggle** (a canned-ACL special case for the AllUsers group). This feature adds the full **per-grantee ACL editor**: from the metadata panel, "Permissions…" opens a dialog showing the object's **owner** and its list of **grants** (grantee + permission), and lets the user add, remove, and re-permission grants, then **Save** (which replaces the object's ACL via `PutObjectAcl`). Grants can target a predefined **Group** (Everyone/AllUsers, Authenticated users, Log delivery) or a specific **Canonical User ID**; existing grants of other types (e.g. legacy email grants) are shown and preserved on save but can't be newly created.

## Goals

- View an object's ACL: owner + all grants (grantee + permission).
- Add a grant to a Group or a Canonical User ID, with any of the 5 S3 permissions (`FULL_CONTROL`/`WRITE`/`WRITE_ACP`/`READ`/`READ_ACP`).
- Remove a grant; change a grant's permission.
- Save → `PutObjectAcl` replacing the ACL (owner preserved; non-editable grant types round-tripped).
- Degrade clearly where ACLs are unsupported; keep the visibility badge in sync after a save.

## Non-Goals (out of scope)

- **Bucket ACLs.**
- **Creating** `AmazonCustomerByEmail` (email) grants — deprecated/region-limited. Existing email grants are displayed and re-sent on save, but the add-form offers only Group + Canonical User.
- **Bulk / folder** ACL changes (single object only).
- **Canned-ACL shortcuts** (the visibility toggle already covers public/private).
- **Lockout-prevention** guards — an over-restrictive ACL is recoverable by the owner re-saving.

## Why this approach

`visibility.ts` already calls `GetObjectAcl`/`PutObjectAcl` for the public/private special case and maps the ACL-unsupported errors (`AccessControlListNotSupported`, `NotImplemented`). The full editor needs the complete owner+grants shape, so it gets its own focused `objectAcl.ts` module rather than overloading the simple visibility concern. `PutObjectAcl` **replaces** the entire ACL and requires the owner, so the model captures the owner and every grant faithfully — including grant types the editor can't create (email/unknown) — and re-sends them on save so nothing is silently dropped. The editor lives in a dialog (not inline) because it's a detailed, occasional task with a multi-row table that would crowd the panel. Saving an ACL can change public access, so the save invalidates the visibility query to keep the panel's badge correct.

## Architecture

```
src/main/s3/objectAcl.ts                              # CREATE: types + getObjectAcl/putObjectAcl
src/main/ipc/channels.ts                              # MODIFY: s3:getObjectAcl / s3:putObjectAcl + ApiMap
src/main/ipc/register.ts                              # MODIFY: 2 handlers
src/preload.ts                                        # MODIFY: 2 methods
src/renderer/hooks/useObjectAcl.ts                    # CREATE: acl query + save mutation
src/renderer/components/files/PermissionsDialog.tsx   # CREATE: owner + grants editor
src/renderer/components/files/MetadataPanel.tsx       # MODIFY: "Permissions…" button + dialog
```

### Backend (`src/main/s3/objectAcl.ts`)

Reuses `ok`/`err`/`type Result` from `../shared/result` and `toErr` from `./objects`.

```ts
export type AclPermission = 'FULL_CONTROL' | 'WRITE' | 'WRITE_ACP' | 'READ' | 'READ_ACP';
export type GranteeType = 'CanonicalUser' | 'Group' | 'AmazonCustomerByEmail';

export interface AclGrant {
  granteeType: GranteeType;
  permission: AclPermission;
  id?: string;          // CanonicalUser
  displayName?: string; // CanonicalUser
  uri?: string;         // Group
  email?: string;       // AmazonCustomerByEmail
}

export interface ObjectAcl {
  owner: { id: string; displayName: string | null };
  grants: AclGrant[];
}

const ACL_UNSUPPORTED = new Set(['AccessControlListNotSupported', 'NotImplemented']);
```

- `getObjectAcl(client, { bucket, key }): Promise<Result<ObjectAcl>>` — `GetObjectAclCommand`; maps `out.Owner` → `{ id: Owner.ID ?? '', displayName: Owner.DisplayName ?? null }` and each `out.Grants[]` → `AclGrant` by `Grantee.Type` (`CanonicalUser` → `id`/`displayName`; `Group` → `uri`; `AmazonCustomerByEmail` → `email`), with `permission: Grant.Permission`. Catch: `ACL_UNSUPPORTED` → `err('AclUnsupported', 'This bucket does not support per-object ACLs')`; else `toErr`.
- `putObjectAcl(client, { bucket, key, acl }): Promise<Result<true>>` — `PutObjectAclCommand` with `AccessControlPolicy: { Owner: { ID: acl.owner.id, DisplayName: acl.owner.displayName ?? undefined }, Grants: acl.grants.map(toAwsGrant) }`, where `toAwsGrant` builds `{ Grantee: { Type, ID?/DisplayName?/URI?/EmailAddress? }, Permission }` from the grant's `granteeType`. Catch: `ACL_UNSUPPORTED` → `err('AclUnsupported', …)`; else `toErr`. Returns `ok(true)`.

### IPC wiring

- `channels.ts`: `CH.getObjectAcl = 's3:getObjectAcl'`, `CH.putObjectAcl = 's3:putObjectAcl'`. `ApiMap`:
  - `[CH.getObjectAcl]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<ObjectAcl> }`
  - `[CH.putObjectAcl]: { args: [{ accountId: string; bucket: string; key: string; acl: ObjectAcl }]; res: Result<true> }`
  - Imports `ObjectAcl` (type) from `../s3/objectAcl`.
- `register.ts`: `h(CH.getObjectAcl, (a) => getObjectAcl(clientFor(a.accountId), { bucket: a.bucket, key: a.key }))`; `h(CH.putObjectAcl, (a) => putObjectAcl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, acl: a.acl }))`.
- `preload.ts`: `getObjectAcl`/`putObjectAcl` forwarding to `invoke`.

### Renderer

**`useObjectAcl(accountId, bucket, key)`**:
- `acl` query (`['objectAcl', accountId, bucket, key]` → `window.s3.getObjectAcl`; enabled when all non-null).
- `save` mutation (`ObjectAcl` → `window.s3.putObjectAcl`; `onSuccess` invalidates `['objectAcl', …]` AND `['objectVisibility', accountId, bucket, key]`).

**`PermissionsDialog`** (`{ accountId, bucket, objectKey, onClose }`): mounts → `useObjectAcl` fetches.
- Loading → "Loading permissions…". Error → the error message (e.g. "This bucket does not support per-object ACLs") + Close.
- On success: seed local working `grants` state from `acl.data.grants` (in an effect when the query data arrives). Render:
  - **Owner** (read-only): `acl.data.owner.displayName || acl.data.owner.id || '—'`.
  - **Grants table**: each row → a grantee label + a permission `<select aria-label="Permission for <label>">` (the 5 values) that updates the row + a **Remove** button. Grantee labels: AllUsers URI → "Everyone (public)", AuthenticatedUsers URI → "Authenticated users", LogDelivery URI → "Log delivery", CanonicalUser → `displayName || id`, email → the email.
  - **Add grant** form: a grantee-type `<select aria-label="Grantee type">` (Group / Canonical User); if Group, a `<select aria-label="Group">` (Everyone / Authenticated users / Log delivery); if Canonical User, a text input (aria-label "Canonical user ID") + optional display name; a permission `<select aria-label="New grant permission">`; an **Add** button that appends the grant to the working state.
  - **Save** button (disabled while `save.isPending`) → `save.mutateAsync({ owner: acl.data.owner, grants })` → "Permissions saved" toast → `onClose`; **Cancel** → `onClose`. Errors → error toast (dialog stays open).
- Group URI constants: AllUsers `http://acs.amazonaws.com/groups/global/AllUsers`, AuthenticatedUsers `http://acs.amazonaws.com/groups/global/AuthenticatedUsers`, LogDelivery `http://acs.amazonaws.com/groups/s3/LogDelivery`.

**MetadataPanel** — add a **"Permissions…"** button to the actions row; clicking sets `permissionsOpen`; render `{permissionsOpen && <PermissionsDialog accountId={accountId ?? ''} bucket={bucket ?? ''} objectKey={objectKey} onClose={() => setPermissionsOpen(false)} />}`.

## Data flow

1. Select an object → **Permissions…** → the dialog fetches the ACL.
2. Edit grants — add (Group or Canonical User + permission), remove, or change a permission — all in local state.
3. **Save** → `PutObjectAcl` replaces the ACL (owner preserved; email/unknown grants re-sent) → toast + close; the panel's visibility badge refetches.

## States & error handling

- The dialog shows loading and error states; `AclUnsupported` → a clear "not supported" message, no editor.
- Edits are on a local working copy — **Cancel discards** them; only **Save** persists.
- `PutObjectAcl` errors (`AccessDenied`, malformed grant) → error toast; the dialog stays open with the working edits intact.
- No optimistic update — reopening the dialog refetches the real ACL.
- Saving **replaces** the entire ACL (owner preserved). Existing grant types the editor can't author (email) are preserved and re-sent so a save never silently drops them.

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend).

- **`objectAcl.ts`**: `getObjectAcl` maps owner + a canonical grant, a group grant, and an email grant; `AccessControlListNotSupported` → `err('AclUnsupported')`. `putObjectAcl` sends `AccessControlPolicy` with the owner and grants mapped back (Group→URI, CanonicalUser→ID, email→EmailAddress); an email grant in the input round-trips into `Grantee.Type: 'AmazonCustomerByEmail'`.
- **IPC `register.test.ts`**: `s3:getObjectAcl` returns the mapped ACL via `clientFor`; `s3:putObjectAcl` returns `ok(true)`.
- **`useObjectAcl`**: `save` calls `window.s3.putObjectAcl` and invalidates both `['objectAcl', …]` and `['objectVisibility', …]`.
- **`PermissionsDialog`**: renders the owner + grant rows; adding a Group grant (Everyone, READ) appends a row; removing a row drops it; changing a permission updates it; **Save** calls `putObjectAcl` with the edited grants; an `AclUnsupported` query error shows the message and no editor.
- **MetadataPanel**: clicking "Permissions…" opens the dialog (shows "Loading permissions…" / the owner).

## Dependencies

None new. Uses `@aws-sdk/client-s3` (`GetObjectAclCommand`, `PutObjectAclCommand` — already used by `visibility.ts`), the existing `ConfirmDialog`/`ToastProvider` patterns (toast only here), TanStack Query, and the existing IPC/`Result` conventions.
