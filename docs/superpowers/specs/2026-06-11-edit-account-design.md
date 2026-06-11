# Edit an account/connection — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

S3Manager supports creating, listing, testing, and removing accounts, but there
is no way to edit an existing account. Today a user who mistypes a label,
rotates an access key, or needs to adjust a region must delete the connection
and recreate it from scratch. This spec adds an edit/update flow across the full
stack (storage → IPC → renderer).

## Decisions

- **Secret access key:** Leave blank = keep existing. The edit form starts with
  an empty secret field showing a `••••• (unchanged)` placeholder. A blank value
  keeps the stored secret; a typed value replaces it.
- **Editable fields:** All fields, including provider. The edit form behaves like
  Add but pre-filled, and a provider switch re-runs the same endpoint /
  forcePathStyle resolution used by create.
- **UI:** Reuse the Add form. `AddAccountForm` is refactored into a shared
  `AccountForm` that takes an optional existing account.

## Architecture

### 1. Storage layer — `src/main/storage/accountsRepo.ts`

Add:

```typescript
update(id: string, input: NewAccount): Account
```

- Updates the `accounts` row columns: `label`, `provider`, `endpoint`,
  `region`, `access_key_id`, `force_path_style`.
- Preserves `id` and `created_at`.
- Returns the refreshed `Account` (re-read via the existing `get(id)` path).
- Throws / returns nothing special for a missing id — caller (`get`) already
  handles the not-found case; the IPC handler maps that to an error result.

Secret persistence is unchanged: the existing `secrets.set(id, secret)` is
reused, called only when a new secret is supplied.

### 2. IPC layer — `src/main/ipc/channels.ts` + `src/main/ipc/register.ts`

**channels.ts**

- New channel constant: `accountsUpdate: 'accounts:update'`.
- New input type:

  ```typescript
  export interface UpdateAccountInput {
    id: string;
    label: string;
    provider: ProviderId;
    region: string;
    accessKeyId: string;
    secretAccessKey?: string; // blank/omitted = keep existing
    endpoint?: string;
    forcePathStyle?: boolean;
  }
  ```

- `ApiMap` entry: `[CH.accountsUpdate]: { args: [UpdateAccountInput]; res: Result<Account> }`.
- Extend the **test** input so edit-mode can test without re-typing the secret:
  add an optional `id` to the test input type (`accounts:test`). When the secret
  is blank and an `id` is present, the test handler loads the existing secret via
  `secrets.get(id)`.

**register.ts**

- New handler for `CH.accountsUpdate`, mirroring `accountsCreate`:
  1. Validate provider with `isKnownProvider`; return `InvalidProvider` if not.
  2. `resolveConnParams(input)` to derive endpoint + forcePathStyle.
  3. In a `deps.db.transaction`:
     - `deps.accounts.update(input.id, { label, provider, endpoint, region,
       accessKeyId, forcePathStyle })`.
     - **Only if `input.secretAccessKey` is a non-empty string**, call
       `deps.secrets.set(input.id, input.secretAccessKey)`.
  4. Return `ok(account)`.
- Update the `accounts:test` handler: when `secretAccessKey` is blank and `id`
  is provided, resolve the secret from `deps.secrets.get(id)` before building
  the test client.

### 3. Renderer

**Preload — `src/preload.ts`**

Add `update: (input: UpdateAccountInput) => invoke(CH.accountsUpdate, input)` to
the `accounts` API. Update the `test` signature to accept the optional `id`.

**Form — `src/renderer/components/accounts/AccountForm.tsx`** (renamed from
`AddAccountForm.tsx`)

- Accepts optional `account?: Account` prop.
- Add mode (no `account`): behaves exactly as today.
- Edit mode (`account` present):
  - Pre-fills label, provider, region, accessKeyId, endpoint, forcePathStyle.
  - Secret field starts blank with placeholder `••••• (unchanged)`.
  - Submit button label: **"Save changes"** (vs "Add account").
  - On submit, calls the update mutation with `{ id: account.id, ... }`; secret
    is sent only if the field is non-empty.
  - Test Connection passes `account.id` so a blank secret still tests.

**Hook — `src/renderer/hooks/useAccounts.ts`**

```typescript
export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAccountInput) =>
      unwrap(await window.s3.accounts.update(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}
```

**Screen — `src/renderer/components/connections/ConnectionsScreen.tsx`**

- Each account row gets an **Edit** button alongside delete.
- Clicking Edit opens `AccountForm` pre-filled with that account (replacing /
  alongside the existing add toggle — a single `editing` state holding the
  account being edited, or `'new'` for add, or `null` for closed).
- On successful save, the form closes and the list refreshes via cache
  invalidation.

## Data flow

```
ConnectionsScreen (Edit click)
  → AccountForm (pre-filled, edit mode)
  → useUpdateAccount.mutate({ id, ...fields, secret? })
  → window.s3.accounts.update
  → IPC 'accounts:update' handler
      → resolveConnParams + accountsRepo.update(id, ...)
      → secrets.set(id, secret)   [only if secret provided]
  → Result<Account>
  → React Query invalidates ['accounts']
  → list re-renders
```

## Error handling

- Unknown provider → `InvalidProvider` error result (same as create).
- Missing account id on update → not-found error result.
- Secret omitted → stored secret untouched (not an error).
- All handlers stay within the existing `h()` try/catch → `Result<T>` wrapper.

## Testing

- **Repo (`accountsRepo`):** `update` changes the targeted fields and preserves
  `id`/`created_at`; updating without touching secrets leaves the stored secret
  intact.
- **IPC handler (`accounts:update`):** secret is replaced only when provided and
  left intact when blank; provider switch re-resolves endpoint/forcePathStyle;
  unknown provider returns `InvalidProvider`.
- **IPC handler (`accounts:test`):** with a blank secret + `id`, the existing
  stored secret is used.

## Out of scope

- Bulk edit of multiple accounts.
- Changing the account `id`.
- Migrating/renaming on-disk data beyond the `accounts` row.
