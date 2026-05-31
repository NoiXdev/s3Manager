# S3 Manager — Create Bucket

**Date:** 2026-05-31
**Status:** Approved design
**Scope:** A single feature cycle: create a new bucket in the selected account, with optional Object Lock and versioning, via a "+ Create bucket" dialog launched from the buckets pane.

## Overview

The buckets pane currently only lists buckets. This feature adds a **"+ Create bucket"** button to the pane header (mirroring the AccountsPane "+ Add account" affordance) that opens a **`CreateBucketDialog`**. The dialog has a bucket-name field, an **Enable Object Lock** checkbox, and an **Enable versioning** checkbox. The bucket is created in the **selected account's own region** (no region picker). Because Object Lock requires versioning, checking Object Lock auto-checks versioning and disables that checkbox. On success the bucket list refreshes, the new bucket is auto-selected, and a toast confirms.

## Goals

- Create a bucket in the selected account's region from within the app.
- Optionally enable Object Lock at creation (only possible at creation time on AWS) and/or versioning.
- Reflect the new bucket in the list and select it; surface errors clearly.

## Non-Goals (out of scope)

- **Region picker** — buckets are created in the account's configured region.
- **Delete / rename bucket.**
- **Public-access-block, default encryption, tags, lifecycle** configuration at creation.
- **Per-provider hiding of the Object Lock toggle** — if a provider rejects Object Lock, the server error surfaces as a toast.
- Versioning-aware object browsing (unchanged).

## Why this approach

Bucket creation in S3 is a single `CreateBucketCommand`, with two provider-specific wrinkles handled deliberately:

1. **Region / `LocationConstraint`.** AWS requires `CreateBucketConfiguration.LocationConstraint` to equal the target region for every region **except `us-east-1`**, where sending it at all is an error. Hetzner's endpoint already targets its region, so no `LocationConstraint` is sent. This rule is isolated in a small, tested helper `bucketLocationConstraint(providerId, region)` in `providers.ts`, keeping the create op provider-agnostic.
2. **Object Lock ⇒ versioning.** `ObjectLockEnabledForBucket: true` makes AWS auto-enable versioning, so Object Lock alone is sufficient. A standalone "enable versioning" choice is handled by a follow-up `PutBucketVersioningCommand` after creation (idempotent, and harmless if versioning is already on).

Creating in the account's region keeps the signing region and endpoint aligned, avoids cross-region redirect complications, and works identically for Amazon S3 and Hetzner. The dialog mirrors the existing AddAccountForm / dialog patterns. `listBuckets` stays in `objects.ts` (moving it would be unrelated churn); the new bucket-lifecycle op lives in a dedicated `buckets.ts`.

## Architecture

```
src/main/s3/buckets.ts                                 # CREATE: createBucket op
src/main/s3/providers.ts                               # MODIFY: bucketLocationConstraint helper
src/main/ipc/channels.ts                               # MODIFY: s3:createBucket + ApiMap
src/main/ipc/register.ts                               # MODIFY: createBucket handler (resolves account region/provider)
src/preload.ts                                         # MODIFY: createBucket method
src/renderer/hooks/useCreateBucket.ts                  # CREATE: create mutation
src/renderer/components/buckets/CreateBucketDialog.tsx # CREATE: dialog UI
src/renderer/components/buckets/BucketsPane.tsx        # MODIFY: "+ Create bucket" button + dialog
```

### Backend — `providers.ts` helper

```ts
export function bucketLocationConstraint(id: ProviderId, region: string): string | undefined {
  if (id !== 'amazon-s3') return undefined;       // Hetzner: endpoint targets the region
  return region === 'us-east-1' ? undefined : region; // AWS: omit for us-east-1
}
```

### Backend — `src/main/s3/buckets.ts`

Reuses `ok`/`type Result` from `../shared/result` and `toErr` from `./objects` (no circular import: `buckets` imports from `objects`; `objects` does not import `buckets`).

```ts
export async function createBucket(
  client: S3Client,
  args: { bucket: string; objectLock: boolean; versioning: boolean; locationConstraint: string | undefined },
): Promise<Result<true>>
```

- `await client.send(new CreateBucketCommand({ Bucket: args.bucket, CreateBucketConfiguration: args.locationConstraint ? { LocationConstraint: args.locationConstraint } : undefined, ObjectLockEnabledForBucket: args.objectLock || undefined }))`
- if `args.versioning`: `await client.send(new PutBucketVersioningCommand({ Bucket: args.bucket, VersioningConfiguration: { Status: 'Enabled' } }))`
- returns `ok(true)`; errors → `toErr`.

(`LocationConstraint` is typed `BucketLocationConstraint` by the SDK; pass the region string — the SDK accepts the string union loosely. If tsc requires it, cast via `as BucketLocationConstraint`.)

### IPC wiring

- `channels.ts`: `CH.createBucket = 's3:createBucket'`. `ApiMap`:
  - `[CH.createBucket]: { args: [{ accountId: string; bucket: string; objectLock: boolean; versioning: boolean }]; res: Result<true> }`
- `register.ts`:
  ```ts
  h(CH.createBucket, (a: { accountId: string; bucket: string; objectLock: boolean; versioning: boolean }) => {
    const account = deps.accounts.get(a.accountId);
    if (!account) return err('AccountNotFound', `Unknown account: ${a.accountId}`);
    const locationConstraint = bucketLocationConstraint(account.provider, account.region);
    return createBucket(clientFor(a.accountId), { bucket: a.bucket, objectLock: a.objectLock, versioning: a.versioning, locationConstraint });
  });
  ```
  (`account.provider` is `string`; `bucketLocationConstraint` takes `ProviderId`. The handler already guards providers elsewhere via `isKnownProvider`; cast `account.provider as ProviderId` — accounts are only ever created with a known provider.)
- `preload.ts`: `createBucket: (a: ApiMap[typeof CH.createBucket]['args'][0]) => invoke(CH.createBucket, a)`.

### Renderer

**`useCreateBucket(accountId)`**:
- `mutation` → `unwrap(await window.s3.createBucket({ accountId, bucket, objectLock, versioning }))`; `onSuccess` invalidates `['buckets', accountId]` (the `bucketsKey(accountId)` from `useBuckets`).

**`CreateBucketDialog`** (`{ accountId, onClose, onCreated }`):
- Local state: `name` (string), `objectLock` (bool), `versioning` (bool).
- **Object Lock ⇒ versioning:** when `objectLock` is true, the versioning checkbox renders checked and disabled; the effective `versioning` sent is `objectLock || versioning`.
- **Name validation** (client-side, for immediate feedback only): `isValidBucketName(name)` — 3–63 chars, lowercase letters/digits/hyphens/dots, must start and end with a letter or digit. The Create button is disabled while the name is invalid or `mutation.isPending`; an inline hint shows when a non-empty name is invalid. The server remains the authority for the rest (e.g. global uniqueness).
- **Submit:** `await mutation.mutateAsync({ accountId, bucket: name.trim(), objectLock, versioning: objectLock || versioning })` → toast "Bucket created" → `onCreated(name.trim())` → `onClose`. On throw → error toast; dialog stays open with entered values.
- **Cancel / Close (✕):** `onClose` (discard). Toast via `useToast()` `show(...)`; the ✕ uses `FiX` to match the other dialogs.

**BucketsPane** — add a **"+ Create bucket"** button in the pane header, shown only when `accountId !== null`; clicking sets `creating`. Render `{creating && <CreateBucketDialog accountId={accountId} onClose={() => setCreating(false)} onCreated={(name) => { setCreating(false); onSelect(name); }} />}`. (Invalidation is handled by the hook; selecting the new bucket triggers its content load, and the refreshed list shows it.)

## Data flow

1. With an account selected, click **+ Create bucket** → dialog opens.
2. Enter a name; optionally enable Object Lock (forces versioning) and/or versioning.
3. **Create** → `createBucket` handler resolves the account's region/provider → `CreateBucketCommand` (+ `PutBucketVersioning` when versioning) → toast + close.
4. The `['buckets', accountId]` query is invalidated and refetches; `onSelect(name)` selects the new bucket.

## States & error handling

- The dialog disables Create until the name passes client-side validation; an inline hint explains the rule.
- Errors (`AccessDenied`; `BucketAlreadyExists` / `BucketAlreadyOwnedByYou`; `InvalidBucketName`; a provider rejecting Object Lock) → error toast; the dialog stays open with the working input.
- No optimistic update — the list refetches after a successful create.
- `objectLock` implies `versioning` at the request level even if the versioning checkbox state lags.

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend).

- **`providers.ts`**: `bucketLocationConstraint` → `amazon-s3`+`eu-central-1` ⇒ `'eu-central-1'`; `amazon-s3`+`us-east-1` ⇒ `undefined`; `hetzner`+`fsn1` ⇒ `undefined`.
- **`buckets.ts`**: `createBucket` issues `CreateBucketCommand` with `CreateBucketConfiguration.LocationConstraint` when `locationConstraint` is set and **no** `CreateBucketConfiguration` when it is `undefined`; sets `ObjectLockEnabledForBucket: true` only when `objectLock`; issues `PutBucketVersioningCommand` (Status `Enabled`) only when `versioning`; returns `ok(true)`; errors → `toErr` (`ok: false`).
- **IPC `register.test.ts`**: `s3:createBucket` resolves the created account's region, returns `ok(true)` (mock `CreateBucketCommand`); returns an error result for an unknown account id.
- **`useCreateBucket`**: mutation calls `window.s3.createBucket` with the args and invalidates `['buckets', accountId]`.
- **`CreateBucketDialog`**: Create disabled for an invalid name and enabled for a valid one; checking Object Lock checks+disables the versioning checkbox; submitting a valid form calls `createBucket` with the entered name and the `{ objectLock, versioning }` booleans (versioning forced true when Object Lock is on); a create error shows the message and keeps the dialog open.
- **BucketsPane**: the "+ Create bucket" button appears when an account is selected and opens the dialog; it is absent when no account is selected.

## Dependencies

None new. Uses `@aws-sdk/client-s3` (`CreateBucketCommand`, `PutBucketVersioningCommand`), the existing `ToastProvider`, `react-icons/fi` (`FiX`), TanStack Query, `deps.accounts.get`, and the existing IPC/`Result` conventions.
