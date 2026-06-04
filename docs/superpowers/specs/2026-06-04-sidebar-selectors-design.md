# Sidebar account & bucket selectors — design

## Summary

Move the account and bucket selection out of the Files `<main>` area and into the
left sidebar as dropdown selectors placed above the section menu. Account
management (add/remove) moves to a new full-screen Connections view reached via a
"Manage connections" button. Bucket creation stays inline as a `+` next to the
bucket dropdown.

## Motivation

Today the Files section devotes two columns (`AccountsPane` ~w-60, `BucketsPane`
~w-56) to account/bucket selection, leaving less room for the file browser, and
that context only exists inside the Files section even though CORS, Object Lock,
and Sync also operate on a selected account/bucket. Collapsing selection into
sidebar dropdowns frees horizontal space and makes the selected context a
first-class, sidebar-level concept.

## Sidebar layout

```
S3 Manager
┌─────────────────────────┐
│ Account   [ select  ▾ ]  │   only on relevant sections
│ Bucket    [ select ▾][+] │   only on relevant sections; + = create bucket
└─────────────────────────┘
[ Manage connections ]        always visible, opens full screen

Files
Object Lock
CORS
Sync
──────────────                divider
Dashboard
Settings

SyncStatus
© S3 Manager
```

- **Account / Bucket** are native `<select>` dropdowns (consistent with the
  existing Settings `<select>`).
- Selectors are shown only on account/bucket-aware sections: **Files, Object
  Lock, CORS, Sync**. They are hidden on Dashboard, Settings, and the Connections
  screen.
- The **bucket `+`** sits next to the bucket dropdown and opens the existing
  `CreateBucketDialog`. It is disabled until an account is selected.
- **Manage connections** sits between the selectors and the menu and is always
  visible — it is the entry point when there are zero accounts.

## Connections full screen

A new `ConnectionsScreen` rendered full-screen like `SettingsScreen`, active when
`section === 'connections'`. It absorbs what `AccountsPane` did:

- Account list with `ProviderBadge`.
- Per-row **remove** (`useRemoveAccount`).
- **Add account** form, reusing `AddAccountForm` as-is (`useCreateAccount`).

It is opened only via the Manage connections button; it is **not** a nav item.

## Component changes

- **New** `AccountSelect` — bound to `useAccounts`; options render `label
  (provider)`; placeholder "Select account"; handles loading and no-accounts
  (disabled) states; calls `onSelect(id)` on change.
- **New** `BucketSelect` — bound to `useBuckets(accountId)`; owns the `+` button
  and `CreateBucketDialog`; disabled when `accountId` is null; handles loading
  and no-buckets states; calls `onSelect(bucket)` on change.
- **New** `ConnectionsScreen` — full-screen account management (add/remove),
  absorbing `AccountsPane`'s logic.
- **`SectionNav`** — reorder and add a divider: group
  `[Files, Object Lock, CORS, Sync]`, then a divider, then
  `[Dashboard, Settings]`. The `connections` value is excluded from the rendered
  list.
- **`App.tsx`** — render `AccountSelect`, `BucketSelect`, and the Manage
  connections button inside `<aside>`; show the selectors only on relevant
  sections. The Files `<main>` drops its two left columns, leaving
  `FileBrowser | MetadataPanel`. Render `ConnectionsScreen` when
  `section === 'connections'`.
- **Removed** `AccountsPane` and `BucketsPane` (logic absorbed above), along with
  their tests.

## State & data flow

No change to state shape. `accountId` and `bucket` remain in `App`. The selectors
call the existing `selectAccount` / `selectBucket`, which already reset
`bucket`/`prefix`/`selectedKey` appropriately. `'connections'` is added to the
`Section` union but excluded from `SectionNav`'s list.

## Testing

TDD per component:

- `AccountSelect`: renders options from accounts, fires `onSelect` on change,
  disabled/empty/loading states.
- `BucketSelect`: renders bucket options, opens `CreateBucketDialog` via `+`,
  disabled without an account, empty/loading states.
- `ConnectionsScreen`: lists accounts, add via form, remove a row.
- `SectionNav`: updated order and divider grouping.
- `App`: selectors appear in sidebar on relevant sections and are hidden
  elsewhere; Manage connections opens the Connections screen.

Existing `AccountsPane` / `BucketsPane` tests are removed with their components.

## Decisions made

- Native `<select>` rather than a custom dropdown; provider shown as text
  `label (provider)` instead of the colored badge in the selector.
- Nav order: Files first; Dashboard demoted below the divider.
