# S3 Manager — Per-Object Retention & Legal Hold

**Date:** 2026-05-30
**Status:** Approved design
**Scope:** A single feature cycle: view and edit a single object's Object Lock **retention** (GOVERNANCE set/extend) and **legal hold** (ON/OFF), in the metadata panel. Builds on the bucket-level Object Lock feature (default retention config) already merged.

## Overview

The app already manages bucket-level Object Lock (enable + default retention) in a dedicated section. This feature adds the **per-object** half: for an object in an Object-Lock-enabled bucket, the metadata panel shows the object's current retention (mode + retain-until date) and legal-hold status, and lets the user:

- **Set or extend a GOVERNANCE retention** (a retain-until date the object can't be deleted before). Extend-only — the UI never shortens or removes an active retention.
- **Toggle a legal hold** ON/OFF (an indefinite, no-date deletion block that's freely reversible).

A COMPLIANCE retention set elsewhere is shown read-only. The section only appears when the bucket has Object Lock enabled.

## Goals

- View an object's retention (`None` / `GOVERNANCE until <date>` / `COMPLIANCE until <date>`) and legal-hold (`On`/`Off`).
- Set/extend a **GOVERNANCE** retain-until date (with a confirm), enforcing extend-only (no shortening).
- Toggle a **legal hold** ON/OFF (immediate, reversible).
- Reflect real state after each change (refetch), with toasts and clear errors.

## Non-Goals (out of scope)

- Setting **COMPLIANCE** mode (irreversible until the date — display-only here).
- **Governance bypass** (`x-amz-bypass-governance-retention`) to shorten or remove an active retention.
- **Bulk / folder** retention or legal-hold changes (single object only).
- Setting retention/legal-hold **at upload time** (object-lock headers on PUT).
- Showing the section on **non-Object-Lock** buckets.

## Why this approach

`objectLock.ts` already wraps the bucket-level `Get/PutObjectLockConfiguration` with a `DefaultRetention`/`ObjectLockStatus` shape and maps the "not configured" error to a clean disabled state. The per-object operations are the parallel `Get/PutObjectRetention` and `Get/PutObjectLegalHold` commands; placing them in a sibling `objectRetention.ts` keeps `objectLock.ts` focused on the bucket config and gives the per-object concern its own small module. The UI is a focused `RetentionSection` component (rather than inlining into the already-large `MetadataPanel`), rendered only when the bucket's lock is enabled — so the common non-lock buckets see no clutter and no permission errors. GOVERNANCE-only + extend-only + a confirm keeps a genuinely dangerous S3 feature from becoming a footgun: nothing the UI does is irreversible (legal hold toggles freely; a governance retention can still be lifted later by a privileged user outside the app).

## Architecture

```
src/main/s3/objectRetention.ts                      # CREATE: get/putObjectRetention, get/putObjectLegalHold + types
src/main/ipc/channels.ts                            # MODIFY: 4 channels + ApiMap entries
src/main/ipc/register.ts                            # MODIFY: 4 handlers
src/preload.ts                                      # MODIFY: 4 methods
src/renderer/hooks/useObjectRetention.ts            # CREATE: retention + legalHold queries + setRetention/setLegalHold mutations
src/renderer/components/files/RetentionSection.tsx  # CREATE: retention + legal-hold UI
src/renderer/components/files/MetadataPanel.tsx     # MODIFY: render RetentionSection when bucket lock enabled
```

### Backend (`src/main/s3/objectRetention.ts`)

Reuses `ok`/`type Result` from `../shared/result` and `toErr` from `./objects`.

```ts
export interface ObjectRetention {
  mode: 'GOVERNANCE' | 'COMPLIANCE' | null;
  retainUntil: string | null; // ISO string
}
export type LegalHoldStatus = 'ON' | 'OFF';
```

- `getObjectRetention(client, { bucket, key }): Promise<Result<ObjectRetention>>` — `GetObjectRetentionCommand`; on success maps `out.Retention` to `{ mode: Retention.Mode ?? null, retainUntil: Retention.RetainUntilDate?.toISOString() ?? null }`. Catch: if the error name is `NoSuchObjectLockConfiguration` (object has no retention) return `ok({ mode: null, retainUntil: null })`; else `toErr`.
- `getObjectLegalHold(client, { bucket, key }): Promise<Result<LegalHoldStatus>>` — `GetObjectLegalHoldCommand`; on success returns `ok(out.LegalHold?.Status === 'ON' ? 'ON' : 'OFF')`. Catch: `NoSuchObjectLockConfiguration` → `ok('OFF')`; else `toErr`.
- `putObjectRetention(client, { bucket, key, retainUntil }): Promise<Result<true>>` — `PutObjectRetentionCommand` with `Retention: { Mode: 'GOVERNANCE', RetainUntilDate: new Date(retainUntil) }`. No bypass header. Returns `ok(true)`.
- `putObjectLegalHold(client, { bucket, key, status }): Promise<Result<true>>` — `PutObjectLegalHoldCommand` with `LegalHold: { Status: status }`. Returns `ok(true)`.

### IPC wiring

- `channels.ts`: `CH.getObjectRetention = 's3:getObjectRetention'`, `CH.putObjectRetention = 's3:putObjectRetention'`, `CH.getObjectLegalHold = 's3:getObjectLegalHold'`, `CH.putObjectLegalHold = 's3:putObjectLegalHold'`. `ApiMap`:
  - `getObjectRetention`: args `[{ accountId; bucket; key }]`, res `Result<ObjectRetention>`.
  - `putObjectRetention`: args `[{ accountId; bucket; key; retainUntil: string }]`, res `Result<true>`.
  - `getObjectLegalHold`: args `[{ accountId; bucket; key }]`, res `Result<LegalHoldStatus>`.
  - `putObjectLegalHold`: args `[{ accountId; bucket; key; status: 'ON' | 'OFF' }]`, res `Result<true>`.
  - Imports `ObjectRetention`, `LegalHoldStatus` (types) from `../s3/objectRetention`.
- `register.ts`: four `h(...)` handlers with `clientFor(a.accountId)`.
- `preload.ts`: four methods forwarding to `invoke`.

### Renderer

**`useObjectRetention(accountId, bucket, key)`** (mirrors `useObjectDetails`):
- `retention` query (`['objectRetention', accountId, bucket, key]` → `window.s3.getObjectRetention`).
- `legalHold` query (`['objectLegalHold', accountId, bucket, key]` → `window.s3.getObjectLegalHold`).
- `setRetention` mutation (`{ retainUntil: string }` → `window.s3.putObjectRetention`; `onSuccess` invalidates the retention query).
- `setLegalHold` mutation (`status: 'ON' | 'OFF'` → `window.s3.putObjectLegalHold`; `onSuccess` invalidates the legal-hold query).
- All queries `enabled` only when accountId/bucket/key are non-null.

**`RetentionSection`** (`{ accountId: string; bucket: string; objectKey: string }`): a bordered block with two rows.
- **Retention row**: label + current value (`None` / `GOVERNANCE until <localized date>` / `COMPLIANCE until <localized date>`, using `formatTimestamp`). If `mode === 'COMPLIANCE'`, no editing controls (read-only). Otherwise: an `<input type="date">` (aria-label "Retain until") with `min` = the later of tomorrow and the current retain-until date (extend-only), and an **Apply** button (disabled until a date is chosen / while pending) → a `ConfirmDialog` ("Lock this object from deletion until <date>? You won't be able to shorten this here.") → `setRetention.mutateAsync({ retainUntil })` (the date string converted to an ISO at `T00:00:00.000Z`).
- **Legal hold row**: label + `On`/`Off` + a button **Turn on legal hold** / **Turn off legal hold** → `setLegalHold.mutateAsync({ status })` immediately (no confirm) → toast.
- Pending mutations disable their controls; success → toast ("Retention updated" / "Legal hold on" / "Legal hold off"); error → error toast (`useToast`).

**`MetadataPanel`** — add `const lock = useObjectLock(accountId, bucket);` and, below the Visibility row, render:
```tsx
{lock.query.data?.enabled && (
  <RetentionSection accountId={accountId ?? ''} bucket={bucket ?? ''} objectKey={objectKey} />
)}
```
(`useObjectLock` is the existing bucket Object-Lock hook returning `{ query }` whose `data` is `ObjectLockStatus { enabled, defaultRetention }`. The bucket query is cached, so selecting multiple objects in one bucket reuses it.)

## Data flow

1. Select an object in an Object-Lock-enabled bucket → the panel shows the Retention & legal-hold section with current values.
2. **Set/extend retention**: pick a future date → **Apply** → confirm → `PutObjectRetention` (GOVERNANCE) → retention query refetches → value updates + toast.
3. **Legal hold**: click **Turn on/off** → `PutObjectLegalHold` → legal-hold query refetches → value updates + toast.

## States & error handling

- The section renders only when the bucket's Object Lock is enabled (`lock.query.data?.enabled`).
- Retention editing is hidden when `mode === 'COMPLIANCE'` (can't be modified) and disabled while `setRetention` is pending.
- The date input's `min` enforces extend-only (cannot pick a date earlier than the current retain-until, nor in the past); Apply is disabled until a valid date is chosen.
- Legal-hold toggle is disabled while `setLegalHold` is pending; it's reversible, so no confirm.
- Errors (`AccessDenied`, attempting to shorten, bucket/object not lock-eligible) → error toast; state unchanged (the refetch reflects the real value). No optimistic updates.
- The retention/legal-hold getters map the "none set" case to `null`/`'OFF'` so a lock-enabled object with nothing applied shows clean "None"/"Off".

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend).

- **`objectRetention.ts`**: `getObjectRetention` returns `{ mode, retainUntil }` from a `Retention` payload and `{ mode: null, retainUntil: null }` on `NoSuchObjectLockConfiguration`; `getObjectLegalHold` returns `'ON'`/`'OFF'` and `'OFF'` on not-set; `putObjectRetention` sends `PutObjectRetentionCommand` with `Mode: 'GOVERNANCE'` + the right `RetainUntilDate`; `putObjectLegalHold` sends `LegalHold.Status`.
- **IPC `register.test.ts`**: each of the 4 channels resolves `clientFor(accountId)` and returns the mapped result (e.g. `getObjectRetention` → `{ mode: null, retainUntil: null }` when not set; `putObjectLegalHold` → `ok(true)`).
- **`useObjectRetention`**: `setRetention` calls `window.s3.putObjectRetention` and invalidates `['objectRetention', …]`; `setLegalHold` calls `putObjectLegalHold` and invalidates `['objectLegalHold', …]`.
- **`RetentionSection`**: shows `None`/`Off` for an unset object; picking a date + Apply opens the confirm, confirming calls `setRetention` with the ISO date; a `COMPLIANCE` retention renders read-only (no date input); "Turn on legal hold" calls `setLegalHold` with `status: 'ON'` (no confirm); pending disables controls.
- **`MetadataPanel`**: the Retention section is rendered when `useObjectLock` reports `enabled: true`, and absent when `enabled: false`.

## Dependencies

None new. Uses `@aws-sdk/client-s3` (`GetObjectRetentionCommand`, `PutObjectRetentionCommand`, `GetObjectLegalHoldCommand`, `PutObjectLegalHoldCommand`), the existing `useObjectLock` hook, `ConfirmDialog`, `ToastProvider`, `formatTimestamp`, TanStack Query, and the existing IPC/`Result` patterns.
