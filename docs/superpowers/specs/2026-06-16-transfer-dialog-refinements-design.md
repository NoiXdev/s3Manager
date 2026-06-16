# Transfer dialog refinements — design

## Summary

Two UX refinements to the account export/import dialogs (built in
`2026-06-16-account-transfer-design.md`):

1. **Export:** hide the password field (and its no-password warning) once the
   export string has been generated and is shown — they only belong to the
   input phase.
2. **Import:** show the password field only when the pasted/loaded export is
   actually encrypted (detected in the background), and add an **import
   preview** — the accounts (label + provider) that will be created, shown
   before importing. For encrypted exports the preview appears once the correct
   password is entered.

## Decisions made

- **Encrypted preview = decrypt-then-preview.** For an encrypted export, the
  password field appears; once the correct password is entered (auto-checked in
  the background), the decrypted preview list is shown, then the user imports.
- **Background check, debounced** (~350 ms) on blob/password change — no manual
  "check" button.
- **Preview never returns secrets** — only `label` + `provider` per account; no
  DB writes (pure dry-run).
- **Import is gated on a valid preview** — the Import button is enabled only when
  a preview account list is available, so the user only imports what they could
  preview.

## Components

### Export dialog (`ExportAccountsDialog.tsx`)

Move the password `<label>`/`<input>` and the `noPasswordWarning` paragraph
inside the `result === null` branch. When `result !== null` (the generated
string + Copy/Download are shown), neither is rendered. No logic change.

### Backend — `peekEnvelope` (`accountTransfer.ts`)

`export function peekEnvelope(blob: string): { encrypted: boolean }` — base64
decode + JSON parse + validate `format`/`version`; return `{ encrypted: env.encrypted === true }`.
Throws `TransferError('InvalidData', …)` on malformed input (reuses the same
parsing/validation as `importAccounts`).

### Backend — IPC `accountsImportPreview`

- Channel `accountsImportPreview: 'accounts:importPreview'`,
  `{ args: [{ blob: string; password?: string }]; res: Result<ImportPreview> }`
  where `interface ImportPreview { encrypted: boolean; accounts: { label: string; provider: ProviderId }[] | null }`.
- Handler:
  1. `const { encrypted } = peekEnvelope(blob)` (TransferError → `err(code, message)`).
  2. If `encrypted && !password` → `ok({ encrypted: true, accounts: null })`.
  3. Else `const accs = importAccounts(blob, password)` (TransferError →
     `err`); → `ok({ encrypted, accounts: accs.map(a => ({ label: a.label, provider: a.provider })) })`.
  - No `accounts.create`, no `secrets.set`, never returns `secretAccessKey`.
- `preload.ts`: `accounts.importPreview`.
- `ImportPreview` type lives in `accountTransfer.ts` and is imported into `channels.ts`.

### Renderer — `useImportPreview`

`src/renderer/hooks/useAccountTransfer.ts` gains
`useImportPreview()` — a mutation calling `unwrap(window.s3.accounts.importPreview(input))`.
(Mutation, driven by the dialog's debounced effect.)

### Renderer — `ImportAccountsDialog.tsx` rework

State: `blob`, `password`, `preview: ImportPreview | null`, `previewError: string | null`,
`error: string | null` (import-stage).

- A debounced `useEffect` (~350 ms) on `[blob, password]`: when `blob.trim()` is
  non-empty, call the preview mutation; on success set `preview`, clear
  `previewError`; on error set `previewError` (via `humanErrorMessage`/code map →
  `incorrectPassword`/`invalidData`) and clear `preview`. When `blob` is empty,
  clear both.
- **Password field**: rendered only when `preview?.encrypted === true`.
- **Preview area**:
  - `preview?.accounts` non-null → `transfer.previewCount` ({{count}}) + a list
    of `label (provider)`.
  - `preview?.encrypted && preview.accounts === null` → `transfer.encryptedHint`.
  - while the debounced check is pending → `transfer.checking`.
  - `previewError` → inline red message (near the password field when encrypted).
- **Import button**: disabled unless `preview?.accounts` is non-null and not
  pending. On click: `useImportAccounts().mutateAsync({ blob, password: password || undefined })`
  → success toast `transfer.imported` + `onImported()` + `onClose()`; on error set
  `error` inline (fallback; preview already validated).
- **Load file** unchanged (fills `blob`, which triggers the debounced preview).

## i18n (6 locales)

New `transfer.*` keys: `previewCount` ("{{count}} accounts will be imported"),
`encryptedHint` ("Encrypted — enter the password to preview"), `checking`
("Checking…"). Wrong-password / malformed reuse the existing `incorrectPassword`
/ `invalidData` keys.

## Error handling & edge cases

- Empty/whitespace blob → no preview call, Import disabled.
- Malformed blob → `previewError` = invalidData, no password field, Import disabled.
- Encrypted + wrong password → `previewError` = incorrectPassword, accounts stay
  null, Import disabled.
- Switching a blob from encrypted to unencrypted (re-paste) → preview re-runs,
  password field hides when no longer encrypted.
- The debounce avoids running scrypt on every keystroke; the latest call wins
  (ignore stale results — guard with a request token or rely on mutation's latest
  `data`; the dialog keys preview off the most recent successful call).

## Testing (TDD)

- `accountTransfer.test.ts`: `peekEnvelope` → encrypted true (password export),
  false (plain export), throws InvalidData on garbage.
- `register.test.ts`: `accountsImportPreview` — unencrypted returns `{ encrypted:false, accounts:[{label,provider}] }` with NO secret field; encrypted without password → `{ encrypted:true, accounts:null }`; encrypted with correct password → accounts list; wrong password → err; assert the returned objects have no `secretAccessKey`.
- `useAccountTransfer.test.tsx`: `useImportPreview` returns the preview payload.
- `ImportAccountsDialog.test.tsx`: paste unencrypted blob → preview list shown, NO password field, Import enabled; paste encrypted blob → password field shown, no list; entering the correct password → list appears and Import enables; wrong password → inline error. (Use fake timers or `findBy*` to let the debounce settle.)
- `ExportAccountsDialog.test.tsx`: after Generate, the password field is no longer in the document.

## Out of scope

- Per-account selection within an import (all-or-nothing stays).
- Showing regions/endpoints in the preview (label + provider only).
- Changing the export bundle format.

## Open questions

None.
