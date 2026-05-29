# S3 Manager — Object Visibility Editing (ACL)

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle: make an object's visibility editable (private ↔ public-read) via a canned ACL, surfaced as a toggle in the existing metadata panel. Builds on the File Manager (which already reads and displays object visibility).

## Overview

Today the metadata panel shows a **read-only** visibility badge (`public` / `private` / unavailable) derived from the object's ACL. This feature makes it **editable**: a toggle flips the object's canned ACL between `private` and `public-read` via `PutObjectAcl`. Making an object public requires a confirmation (it exposes the object to anyone); making it private again is immediate. The toggle is hidden when the bucket/provider doesn't support ACLs (the getter already reports `unknown` in that case).

This is the pragmatic, provider-aware slice of "change permissions": a binary visibility toggle that matches the existing badge. Full per-grantee ACL editing is explicitly out of scope.

## Goals

- Flip a single object's visibility between **private** and **public-read** from the metadata panel.
- Use S3 **canned ACLs** (`private` / `public-read`) via `PutObjectAcl`.
- **Confirm** before making an object public; make-private is immediate.
- Reflect the real ACL state after the change (refetch the visibility), with a success toast.
- Degrade gracefully where ACLs are unsupported (no toggle shown).

## Non-Goals (out of scope)

- **Per-grantee ACL grants** (specific grantees, `READ`/`WRITE`/`READ_ACP`/`WRITE_ACP`/`FULL_CONTROL`, owner/canonical-ID/group editing).
- **Bucket ACLs / bucket public-access** settings.
- Other canned ACLs (`public-read-write`, `authenticated-read`, `aws-exec-read`, etc.). Only `private` and `public-read`.
- **Bulk / folder-level** visibility changes (single selected object only).
- **Presigned PUT URLs** (a separate wishlist item).

## Why this approach

The codebase already has `getObjectVisibility` (`src/main/s3/visibility.ts`) returning `'public' | 'private' | 'unknown'` from `GetObjectAcl` (checking the AllUsers group for READ/FULL_CONTROL), and it already maps the ACL-unsupported errors (`AccessControlListNotSupported`, `NotImplemented`) to `'unknown'`. The metadata panel already renders that as a badge via `useObjectDetails`. Adding a `setObjectVisibility` op in the same module and making the existing badge editable is the smallest, most cohesive change — it reuses the `Visibility` type, the getter (for post-write refresh), and the badge UI. Canned ACLs keep the change safe and portable: `public-read` and `private` are the two universally meaningful states and map directly to the public/private badge.

## Architecture

```
src/main/s3/visibility.ts                 # MODIFY: add setObjectVisibility (PutObjectAclCommand, canned ACL)
src/main/ipc/channels.ts                  # MODIFY: CH.setObjectVisibility + ApiMap entry
src/main/ipc/register.ts                  # MODIFY: handler via h + clientFor
src/preload.ts                            # MODIFY: setObjectVisibility method
src/renderer/hooks/useObjectDetails.ts    # MODIFY: add setVisibility mutation (invalidate the visibility query)
src/renderer/components/files/MetadataPanel.tsx  # MODIFY: editable visibility control (toggle + confirm-on-public)
```

### Backend (`src/main/s3/visibility.ts`)

Add alongside `getObjectVisibility` (reusing the existing `Visibility` type, `ACL_UNSUPPORTED` set, `ok`/`toErr`):

```ts
export async function setObjectVisibility(
  client: S3Client,
  args: { bucket: string; key: string; visibility: 'public' | 'private' },
): Promise<Result<Visibility>> {
  try {
    await client.send(
      new PutObjectAclCommand({
        Bucket: args.bucket,
        Key: args.key,
        ACL: args.visibility === 'public' ? 'public-read' : 'private',
      }),
    );
    return ok(args.visibility);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (ACL_UNSUPPORTED.has(name)) {
      return err('AclUnsupported', 'This bucket does not support per-object ACLs');
    }
    return toErr(e);
  }
}
```

- `public` → canned `public-read` (owner full control + AllUsers READ); `private` → canned `private` (owner only).
- Returns the new `Visibility` (`'public'` or `'private'`) on success.
- ACL-unsupported errors map to a friendly `err('AclUnsupported', …)`; everything else goes through `toErr`. (`err` is imported from `../shared/result`; `PutObjectAclCommand` from `@aws-sdk/client-s3`.)

### IPC wiring

- `channels.ts`: `CH.setObjectVisibility = 's3:setObjectVisibility'`; `ApiMap`: `[CH.setObjectVisibility]: { args: [{ accountId: string; bucket: string; key: string; visibility: 'public' | 'private' }]; res: Result<Visibility> }`.
- `register.ts`: `h(CH.setObjectVisibility, (a) => setObjectVisibility(clientFor(a.accountId), { bucket: a.bucket, key: a.key, visibility: a.visibility }))`.
- `preload.ts`: `setObjectVisibility: (a) => invoke(CH.setObjectVisibility, a)`.

No secrets cross the boundary.

### Renderer

**`useObjectDetails`** — add a `setVisibility` mutation using `useQueryClient`:
- `mutationFn: (v: 'public' | 'private') => unwrap(await window.s3.setObjectVisibility({ accountId, bucket, key, visibility: v }))`.
- `onSuccess`: invalidate `['objectVisibility', accountId, bucket, key]` so the badge refetches the true state.
- Returns `{ metadata, visibility, setVisibility }`.

**`MetadataPanel`** — the existing Visibility row becomes editable. When `visibility.isSuccess` and the value is `'public'` or `'private'`, render the badge plus a toggle button:
- value `private` → button **"Make public"** → opens a `ConfirmDialog` ("Make this object publicly readable by anyone?", confirm label "Make public") → on confirm, `setVisibility.mutateAsync('public')`.
- value `public` → button **"Make private"** → immediately `setVisibility.mutateAsync('private')` (no confirm).
- The button is disabled while `setVisibility.isPending`.
- When the value is `'unknown'`, loading, or the query errored, no toggle is shown (unchanged from today — the badge shows the value or "unavailable").
- On success show a toast ("Made public" / "Made private"); on error show the error message via the existing toast.

## Data flow

1. User selects a file → metadata panel shows the visibility badge.
2. Click the toggle → if going public, a confirm dialog appears; otherwise proceed.
3. `setVisibility` → `PutObjectAcl` (canned `public-read`/`private`) → on success invalidate the visibility query → badge refetches and updates → success toast.

## States & error handling

- Toggle shown only for known visibility (`public`/`private`); hidden for `unknown`/loading/error.
- Toggle disabled while the mutation is pending (prevents double-submit).
- Make-public requires confirmation; make-private is immediate.
- No optimistic update — the badge reflects the real ACL after the post-write refetch, so a failed write leaves the displayed state correct.
- Errors (`AccessDenied`, `AclUnsupported`, network) → error toast with the message; the badge is unchanged.

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend).

- **`visibility.ts` `setObjectVisibility`**: `visibility: 'public'` sends `PutObjectAclCommand` with `ACL: 'public-read'` and returns `ok('public')`; `'private'` sends `ACL: 'private'` and returns `ok('private')`; an `AccessControlListNotSupported`/`NotImplemented` error returns `err('AclUnsupported', …)`; another error goes through `toErr`.
- **IPC `register.test.ts`**: `s3:setObjectVisibility` calls the op with `clientFor(accountId)` (create an account, mock `PutObjectAclCommand`, assert `ok('public')`).
- **`useObjectDetails`**: `setVisibility('public')` calls `window.s3.setObjectVisibility` with the right args and invalidates the `['objectVisibility', …]` query.
- **`MetadataPanel`**: with `visibility = 'private'`, a "Make public" button shows → clicking it opens the confirm → confirming calls `setObjectVisibility` with `visibility: 'public'`; with `visibility = 'public'`, a "Make private" button calls `setObjectVisibility` with `visibility: 'private'` immediately (no confirm); with `visibility = 'unknown'`, no toggle button is rendered.

## Dependencies

None new. Uses `@aws-sdk/client-s3` (`PutObjectAclCommand` — same client as the existing `GetObjectAclCommand`), the existing `visibility.ts` module + `Visibility` type, `useObjectDetails`, the existing `ConfirmDialog` and `ToastProvider`, and TanStack Query.
