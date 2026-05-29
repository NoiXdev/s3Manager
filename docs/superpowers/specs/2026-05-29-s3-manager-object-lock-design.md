# S3 Manager — Object Lock (Bucket Default Retention)

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle (new backend Object Lock ops + an editor UI), built on the completed File Manager MVP, Dashboard, and CORS (all merged to `develop`).

## Overview

View a bucket's Object Lock status and configure its **default retention** — the retention mode (Governance/Compliance) and period (days or years) automatically applied to new objects. It replaces the "Coming soon" placeholder for the Object Lock section. New main-process operations wrap the S3 `GetObjectLockConfiguration` / `PutObjectLockConfiguration` commands. The design closely mirrors the CORS feature.

## Goals

- Show whether a bucket has Object Lock enabled; a bucket without it shows a read-only informational state (not an error).
- For lock-enabled buckets, view and set the default retention: mode (Governance/Compliance) + period (days **or** years).
- Remove the default retention rule (keeping Object Lock enabled).
- Self-contained target selection: own account + bucket dropdowns, seeded from the app's current selection.

## Non-Goals (out of scope)

- **Enabling Object Lock on a bucket** — S3 only allows this at bucket-creation time; it cannot be turned on for an existing bucket via the API. The UI displays the not-enabled state read-only.
- Per-object retention and legal hold (a later cycle / Files-view integration).
- Bypassing or shortening existing object retention (Governance bypass, etc.).

## Why a bucket can't be lock-enabled here

S3 requires `ObjectLockEnabledForBucket: true` at `CreateBucket` time; there is no API to enable Object Lock on an existing bucket. This app lists pre-existing buckets, so for non-enabled buckets it can only report the state. Configuring the *default retention* (`PutObjectLockConfiguration`) is only valid on buckets that were already created with Object Lock enabled.

## Architecture

Renderer UI on top of two new main-process operations in a **new `src/main/s3/objectLock.ts`** module (mirrors `cors.ts`; Object Lock is a distinct bucket-level concern).

### Backend operations (`src/main/s3/objectLock.ts`)

Each takes an `S3Client` and returns a `Result` (from `../shared/result`), catching errors via `toErr` (from `./objects`).

- `getObjectLockConfig(client, bucket): Promise<Result<ObjectLockStatus>>` — sends `GetObjectLockConfigurationCommand`. **A bucket without Object Lock enabled makes S3 throw `ObjectLockConfigurationNotFoundError`; this specific error is caught and returned as `ok({ enabled: false, defaultRetention: null })`.** When enabled, maps `ObjectLockConfiguration.ObjectLockEnabled === 'Enabled'` → `enabled: true` and `Rule.DefaultRetention` → `defaultRetention` (or `null` when there's no rule). Other errors → `err`.
- `putObjectLockConfig(client, bucket, retention: DefaultRetention | null): Promise<Result<true>>` — sends `PutObjectLockConfigurationCommand` with `ObjectLockConfiguration.ObjectLockEnabled: 'Enabled'`. When `retention` is non-null, includes `Rule.DefaultRetention: { Mode, Days }` or `{ Mode, Years }`. When `retention` is `null`, sends no `Rule` (clears the default retention while keeping Object Lock enabled).

### Types (shared, normalized)

```ts
export interface DefaultRetention {
  mode: 'GOVERNANCE' | 'COMPLIANCE';
  days: number | null;
  years: number | null;   // exactly one of days/years is non-null
}

export interface ObjectLockStatus {
  enabled: boolean;
  defaultRetention: DefaultRetention | null;
}
```

Mapping:
- **Read** (SDK → status): `ObjectLockEnabled === 'Enabled'` → `enabled`; `Rule.DefaultRetention.Mode → mode`, `Days → days ?? null`, `Years → years ?? null`. No rule → `defaultRetention: null`.
- **Write** (`DefaultRetention` → SDK): always `ObjectLockEnabled: 'Enabled'`; if `days` is non-null send `Rule: { DefaultRetention: { Mode, Days: days } }`, else if `years` is non-null send `{ Mode, Years: years }`. `retention: null` → omit `Rule` entirely.

### Wiring

- `channels.ts`: `CH.getObjectLockConfig` (`'s3:getObjectLockConfig'`) and `CH.putObjectLockConfig` (`'s3:putObjectLockConfig'`), with `ApiMap` entries:
  - `getObjectLockConfig`: args `[{ accountId, bucket }]`, res `Result<ObjectLockStatus>`.
  - `putObjectLockConfig`: args `[{ accountId, bucket, retention: DefaultRetention | null }]`, res `Result<true>`.
  `ObjectLockStatus`/`DefaultRetention` imported type-only.
- `register.ts`: two handlers via `h` + `clientFor(accountId)`.
- `preload.ts`: two `window.s3` methods forwarding to `invoke`.

No secrets cross the boundary; payloads contain only retention mode/period.

## UI

An `ObjectLockEditor` view rendered by `App` when `section === 'objectLock'`.

### File structure

```
src/renderer/
  hooks/useObjectLock.ts                          # query (getObjectLockConfig) + save/clear mutations
  components/objectlock/ObjectLockEditor.tsx      # pickers + status + default-retention form + Save/Remove
  App.tsx                                         # MODIFY: render ObjectLockEditor for section==='objectLock'
```

### Layout (top to bottom)

1. **Target pickers** — account `<select>` (from `useAccounts`) + bucket `<select>` (from `useBuckets` for the chosen account), seeded from the app's current `accountId`/`bucket`. Choosing a bucket loads its Object Lock status.
2. **Not enabled** (`enabled: false`) — read-only info panel: *"Object Lock is not enabled on this bucket. It can only be enabled when a bucket is created."* No edit controls.
3. **Enabled** — a default-retention form:
   - **Mode** — `<select>`: Governance / Compliance.
   - **Period** — number input + a **unit** toggle (Days / Years).
   - **Save** — `putObjectLockConfig({ mode, days|years })` → success toast + refetch. Disabled when the period is not a positive integer.
   - **Remove default** — `ConfirmDialog` → `putObjectLockConfig(null)` → toast.
   - If enabled with no default yet, the form starts at Governance with a blank period.

### Components

- **`useObjectLock(accountId, bucket)`** — `getObjectLockConfig` query (enabled when both set) + `save(retention)` and `clear()` mutations (calling `putObjectLockConfig` with the retention or `null`), invalidating the query on success. One responsibility: Object Lock data access for a target.
- **`ObjectLockEditor`** — owns the account/bucket selection, the working form state (mode + period + unit, seeded from the loaded config), the not-enabled branch, and Save/Remove (via `useObjectLock` + toasts + confirm).

### Working-state model

`ObjectLockEditor` keeps the form state (mode, period number, unit) in local state, initialized from the loaded `defaultRetention` when it resolves (Governance + blank when there's no default). Switching account/bucket reloads from the server. No draft persistence across target changes.

## Data flow

1. Object Lock section → `App` renders `<ObjectLockEditor>` seeded with current `accountId`/`bucket`.
2. User picks account + bucket → `useObjectLock` runs `getObjectLockConfig`.
3. Not enabled → info panel. Enabled → form seeded from `defaultRetention`.
4. **Save** → `useObjectLock.save({ mode, days|years })` → `putObjectLockConfig` → toast + refetch.
5. **Remove default** → confirm → `useObjectLock.clear()` → `putObjectLockConfig(null)` → toast + refetch.

## States & error handling

- **No account or bucket selected** → prompt to choose a target.
- **Loading** → "Loading Object Lock…".
- **Not enabled** → read-only info panel.
- **Enabled, no default** → empty form.
- **Enabled, with default** → form pre-filled.
- **Query error** (non-not-found, e.g. `AccessDenied`) → inline error.
- **Save/Remove error** (e.g. `AccessDenied`, `NotImplemented`, or attempting to configure a non-enabled bucket) → error toast with code+message; working form values preserved.
- **Validation:** period must be a positive integer; Save is disabled otherwise so no invalid `Days`/`Years` reaches S3.

## Testing

Vitest + React Testing Library against a mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend ops), consistent with the existing codebase.

- **`objectLock.ts`** — `getObjectLockConfig`: maps an enabled config with a `DefaultRetention` (mode + days); `ObjectLockConfigurationNotFoundError` → `{ enabled: false, defaultRetention: null }`; other errors → `err`. `putObjectLockConfig`: with retention sends `ObjectLockEnabled: 'Enabled'` + `Rule.DefaultRetention` (Days when days set, Years when years set, never both); with `null` sends no `Rule`.
- **IPC register** — the two channels are registered and invoke the ops with `clientFor(accountId)`.
- **`useObjectLock`** — query loads status; `save`/`clear` call the right `window.s3` method and invalidate the query.
- **`ObjectLockEditor`** — not-enabled bucket shows the info panel (no form); enabled bucket → set mode + period + unit → Save calls `putObjectLockConfig` with the right shape; Remove default → confirm → `putObjectLockConfig(null)`; Save disabled for an empty/invalid period; no-bucket prompt.
- **`App`** — the Object Lock section renders `ObjectLockEditor` (no longer "Coming soon").

## Dependencies

None new. Uses the installed `@aws-sdk/client-s3` Object Lock commands (`GetObjectLockConfigurationCommand` / `PutObjectLockConfigurationCommand` — confirmed present), the existing `useAccounts` / `useBuckets` hooks, `ToastProvider`, and `ConfirmDialog`.
