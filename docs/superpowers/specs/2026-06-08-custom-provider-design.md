# Custom S3-compatible provider — design

**Date:** 2026-06-08
**Status:** Approved

## Goal

Let users connect to any S3-compatible host by adding their own endpoint,
instead of being limited to the built-in Amazon S3 and Hetzner providers.

## Background

Connections are modeled around a hardcoded provider list in
`src/main/s3/providers.ts`:

```ts
export type ProviderId = 'amazon-s3' | 'hetzner';
```

Each `ProviderDef` carries a fixed `forcePathStyle` and a
`resolveEndpoint(region)` function. The account record already stores an
`endpoint` column, but on create/test the endpoint is **always derived** from
`resolveEndpoint(provider, region)` — the user can never type one. Likewise
`forcePathStyle` is **not stored**; it is looked up from the provider
definition at client-build time (`accountClients.ts`).

`AddAccountForm` only exposes Label / Provider dropdown / Region / keys.

## Design decisions (confirmed)

- **Endpoint entry:** user types the full endpoint URL
  (e.g. `https://minio.example.com:9000`). Region is entered separately
  (still required for SigV4 signing).
- **Path style:** a toggle, defaulting ON (path-style), since most
  S3-compatible servers (MinIO, Ceph, …) require it. This requires persisting
  `forcePathStyle` per account.
- **Region:** required; prefilled with `us-east-1` when the user selects the
  custom provider.

## Changes

### 1. Provider definition (`src/main/s3/providers.ts`)

Add `'custom'` to `ProviderId` and a third entry to `PROVIDERS`:

```ts
export type ProviderId = 'amazon-s3' | 'hetzner' | 'custom';

{ id: 'custom', label: 'Custom (S3-compatible)', forcePathStyle: true, resolveEndpoint: () => undefined }
```

Registering it in `PROVIDERS` means `isKnownProvider`, `getProvider`, and the
renderer's `UI_PROVIDERS` all pick it up with no further changes. The
`forcePathStyle`/`resolveEndpoint` values on this entry are inert defaults; for
custom accounts the effective values come from user input (see §3).

### 2. Persisted `forcePathStyle`

A custom host needs a user-controlled `forcePathStyle`, so it must be stored
per account rather than derived from the provider def.

- **Migration** (`db.ts`): idempotently add the column, then backfill. The
  WASM SQLite driver has no `ADD COLUMN IF NOT EXISTS`, so guard with a
  `PRAGMA table_info(accounts)` check:

  ```sql
  ALTER TABLE accounts ADD COLUMN force_path_style INTEGER;
  UPDATE accounts SET force_path_style =
    CASE provider WHEN 'hetzner' THEN 1 ELSE 0 END
  WHERE force_path_style IS NULL;
  ```

- `accountsRepo`: `NewAccount` and `Account` gain `forcePathStyle: boolean`;
  written in `create`, read in `toAccount` (`Boolean(row.force_path_style)`).
- `accountClients.ts`: use `account.forcePathStyle` directly instead of
  `getProvider(account.provider).forcePathStyle` (removes the `getProvider`
  import).

### 3. IPC input + handlers

`CreateAccountInput` (`channels.ts`) gains two optional fields, used only when
the provider is `custom`:

```ts
endpoint?: string;
forcePathStyle?: boolean;
```

In `register.ts`, both `accountsCreate` and `accountsTest` compute:

```ts
const isCustom = input.provider === 'custom';
const endpoint = isCustom ? input.endpoint?.trim() : resolveEndpoint(input.provider, input.region);
const forcePathStyle = isCustom ? (input.forcePathStyle ?? true) : getProvider(input.provider).forcePathStyle;
```

For custom providers, validate that `endpoint` is a non-empty `http(s)://`
URL; otherwise return `err('InvalidEndpoint', …)` before building a client.
Both `endpoint` and `forcePathStyle` are persisted on create and passed to
`createClient` on test.

`bucketLocationConstraint` already returns `undefined` for any provider that is
not `amazon-s3`, which is the correct behavior for custom hosts — no change
needed.

### 4. UI (`AddAccountForm.tsx`)

When `provider === 'custom'`, conditionally render:

- **Endpoint URL** text input (required) — placeholder
  `https://minio.example.com:9000`.
- **Path-style addressing** checkbox, default checked.

When the user switches the provider select to `custom` and Region is empty,
prefill Region with `us-east-1`. The `endpoint` and `forcePathStyle` values are
included in the submitted `CreateAccountInput`; the backend ignores them for
non-custom providers.

### 5. Testing

- `providers.test.ts`: `custom` is a known provider with the expected label and
  defaults.
- `db` / `accountsRepo` tests: the column migrates and backfills correctly, and
  `forcePathStyle` round-trips through create/read.
- `register` test: a custom account create/test uses the typed endpoint and
  toggle; an invalid/missing endpoint returns `InvalidEndpoint`.
- `clientFactory.test.ts`: already covers endpoint + `forcePathStyle`
  passthrough; no change expected.
- `AddAccountForm.test.tsx`: custom fields appear only when custom is selected;
  Region is prefilled with `us-east-1` on switch.

## Out of scope

- Editing existing accounts (current UI only adds/removes).
- Per-account region templates / placeholder substitution for custom hosts.
- Custom TLS / CA certificate configuration.
