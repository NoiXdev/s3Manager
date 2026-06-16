# Duplicate-name import handling & dismissible modals — design

## Summary

Two independent refinements on the `feat/account-import-export` branch:

1. **Duplicate names on import:** when an imported account's name (label)
   already exists, warn the user and let them choose, for all collisions at
   once: **skip**, **import as copies**, or **replace** the existing account.
2. **Dismissible modals:** every modal in the app closes via **Esc** and via a
   **backdrop click** (clicking outside the panel), through one shared `Modal`
   wrapper that all 10 dialogs adopt.

## Decisions made

- **Duplicate options:** one global choice — `skip | copy | replace` — applied
  to every name collision. `replace` matches by label and updates the existing
  account (credentials included). Default selection is **skip**.
- **Backward compatible:** the import IPC's new `onDuplicate` argument defaults
  to `'copy'` (today's behaviour), so callers that omit it are unchanged.
- **Modal scope:** all 10 dialogs adopt a shared `ui/Modal` (Export, Import,
  QuickAdd, CreateBucket, Metadata, Permissions, UploadLink, Move, Name,
  Confirm). Also resolves the ROADMAP "Escape-to-close" a11y item.
- **Both parts land on `feat/account-import-export`.**

## Part A — duplicate-name handling

### Backend — `accountsImport` gains `onDuplicate`

- `ApiMap[CH.accountsImport].args` becomes
  `[{ blob: string; password?: string; onDuplicate?: 'skip' | 'copy' | 'replace' }]`.
- Handler: parse + validate every provider as today (all-or-nothing). Snapshot
  `existing = deps.accounts.list()` once. In the single `db.transaction`, for
  each resolved account, find `dup = existing.find(e => e.label === acc.label)`:
  - `onDuplicate === 'skip'` and `dup` → skip it.
  - `onDuplicate === 'replace'` and `dup` → `accounts.update(dup.id, {...fields})`
    + `secrets.set(dup.id, secret)`; push the updated account.
  - otherwise (`'copy'`, the default, or no `dup`) → `accounts.create` +
    `secrets.set`; push the created account.
  - Return the array of created/updated accounts.
  - Edge: if several existing accounts share a label, `replace` updates the
    first match (snapshot order). Documented, acceptable.
- `useImportAccounts` mutation input type widens to include the optional
  `onDuplicate`. `preload` already forwards the whole arg object — no change.

### Renderer — `ImportAccountsDialog`

- Read existing accounts via `useAccounts`. From the **preview** list compute
  collisions: `preview.accounts.filter(a => existingLabels.has(a.label))`.
- When `collisions.length > 0`:
  - Show a warning line `transfer.duplicateWarning` ({{count}}).
  - Show a labelled `<select>` (`transfer.duplicateMode`) with options
    `transfer.duplicateSkip` / `transfer.duplicateCopy` /
    `transfer.duplicateReplace`; state `duplicateMode` defaults to `'skip'`.
  - Mark each colliding row in the preview list with `transfer.nameExists`.
- Import passes `onDuplicate: collisions.length > 0 ? duplicateMode : 'copy'`.
- The import still goes through `useImportAccounts` (which invalidates the
  accounts query), so replaced/created accounts refresh the list.

### i18n (6 locales)

`transfer.duplicateWarning` ("{{count}} names already exist"),
`transfer.duplicateMode` ("Existing names"), `transfer.duplicateSkip` ("Skip"),
`transfer.duplicateCopy` ("Import as copies"), `transfer.duplicateReplace`
("Replace existing"), `transfer.nameExists` ("name exists").

## Part B — shared dismissible `Modal`

### `src/renderer/components/ui/Modal.tsx`

```ts
function Modal({ onDismiss, className, children }: {
  onDismiss: () => void;
  className?: string;       // panel classes (width/padding/bg)
  children: ReactNode;
}): JSX.Element
```

- Renders the overlay `<div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">` with a panel child carrying `className`.
- **Esc:** a `document` keydown listener (added/removed in an effect) calls
  `onDismiss` on `Escape`.
- **Backdrop:** the overlay's `onMouseDown` calls `onDismiss` only when
  `e.target === e.currentTarget` (the overlay itself, not a child) — so clicks
  inside the panel never dismiss; no `stopPropagation` needed.

### Refactor the 10 dialogs

Each dialog's hand-rolled
`<div className="fixed inset-0 … bg-black/30" role="dialog" aria-modal="true"><div className="<panel>">…</div></div>`
becomes `<Modal onDismiss={<onClose|onCancel>} className="<panel>">…</Modal>`,
dropping the duplicated overlay/role/aria. `ConfirmDialog` uses `onCancel` as
`onDismiss`. Panel classes (e.g. `w-80`, `w-96`, `w-[28rem]`) move to the
`className` prop unchanged. Inner content (headers, FiX buttons, forms) is
untouched.

Dialogs: `ExportAccountsDialog`, `ImportAccountsDialog`, `QuickAddAccountDialog`,
`CreateBucketDialog`, `MetadataDialog`, `PermissionsDialog`, `UploadLinkDialog`,
`MoveDialog`, `NameDialog`, `ConfirmDialog`.

## Error handling & edge cases

- Empty existing list → no collisions → chooser hidden → import `'copy'`.
- Live DB differs from the preview snapshot (account added meanwhile): the
  handler re-detects collisions against the live list and is authoritative.
- Backdrop/Esc dismiss while a dialog has unsaved input or a pending action: the
  user explicitly asked for this; dismiss = the dialog's existing cancel/close.
- Existing dialog FiX/Cancel buttons keep working (they call the same handler).

## Testing (TDD)

- `register.test.ts`: `accountsImport` with `onDuplicate` —
  `skip` (collision skipped, non-colliding created), `copy`/default (duplicate
  created), `replace` (existing account updated in place + secret replaced, no
  new row). Assert via `deps.accounts.list()` / `deps.secrets.get`.
- `Modal.test.tsx`: Esc fires `onDismiss`; backdrop click fires `onDismiss`;
  a click inside the panel does NOT; renders `role="dialog"` with the panel
  className.
- Each refactored dialog's existing test still passes (content + role + buttons
  unchanged). Add an Esc-closes test to `ConfirmDialog.test.tsx` as a
  representative.
- `ImportAccountsDialog.test.tsx`: a preview with a label that matches an
  existing account shows the warning + chooser and marks the row; importing with
  the chooser set to `replace` calls `accounts.import` with
  `onDuplicate: 'replace'`; no collision → no warning, import sends `'copy'`.

## Out of scope

- Per-account duplicate decisions (one global choice only).
- `aria-labelledby` wiring for dialog titles (separate a11y task).
- Focus-trapping inside modals (Esc + backdrop only).
- Deduplicating accounts already in the database.

## Open questions

None.
