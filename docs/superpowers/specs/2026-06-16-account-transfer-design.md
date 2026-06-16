# Account import / export — design

## Summary

Let users export one, several, or all S3 accounts to a portable string
(optionally password-encrypted) and import accounts from such a string or a
saved file. Export is reachable per-account and as "export all" from the
Accounts (Connections) screen; import lives there too. The export bundle carries
each account's metadata **and its secret access key**, so the password
encryption is the protective layer.

## Decisions made

- **Scope:** per-account export (a row action) **and** "export all" (header
  button); import accepts a pasted string **or** a loaded file.
- **Password optional.** With a password the bundle is encrypted; without one,
  the secret keys are only base64-encoded (not encrypted) — the export dialog
  shows a clear warning in that case. (User explicitly wanted the password
  optional.)
- **Crypto:** scrypt KDF (random salt) → AES-256-GCM (random IV, auth tag). The
  GCM tag detects both tampering and a wrong password.
- **Import is all-or-nothing** and always creates **new** account ids (no silent
  overwrite; duplicates are possible if the same bundle is imported twice).
- **No new npm dependency** — uses `node:crypto`. File read/write goes through
  injected main-process helpers (mirrors the existing `saveDialog`).

## Data shapes

```ts
// One account in the bundle — exactly what accountsCreate needs (no id/createdAt).
interface ExportAccount {
  label: string;
  provider: ProviderId;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

// The decoded envelope (the export string is base64 of JSON.stringify(envelope)).
interface ExportEnvelope {
  format: 's3manager-accounts';
  version: 1;
  encrypted: boolean;
  // present only when encrypted:
  kdf?: { name: 'scrypt'; N: number; r: number; p: number; salt: string /*base64*/ };
  cipher?: 'aes-256-gcm';
  iv?: string;  // base64
  tag?: string; // base64
  // encrypted: base64 ciphertext of JSON.stringify({ accounts });
  // plaintext: JSON.stringify({ accounts })
  data: string;
}
```

scrypt params: `N=32768, r=8, p=1`, keylen 32; salt 16 bytes; GCM iv 12 bytes.

## Components

### Pure module `src/main/accounts/accountTransfer.ts`

No Electron, no fs — only `node:crypto`. Exports:

- `exportAccounts(accounts: ExportAccount[], password?: string): string`
  — builds `{ accounts }`, wraps in an `ExportEnvelope` (encrypting when a
  non-empty password is given), returns `base64(JSON.stringify(envelope))`.
- `importAccounts(blob: string, password?: string): ExportAccount[]`
  — base64-decodes, parses the envelope, validates `format`/`version`; if
  `encrypted` and no password → throw `PasswordRequired`; decrypts (GCM failure
  → `IncorrectPassword`); parses and returns `accounts`. Malformed input →
  `InvalidData`. Errors are thrown as `Error` with a stable `.code`
  (`'PasswordRequired' | 'IncorrectPassword' | 'InvalidData'`) so handlers map
  them to `err(code, message)`.

### Main — IPC handlers + file helpers

New `RegisterDeps`:
- `saveTextFile: (defaultName: string, contents: string) => Promise<boolean>`
  (true = saved, false = cancelled).
- `openTextFile: () => Promise<string | null>` (file text, or null if cancelled).

`main.ts` wires them with `dialog.showSaveDialog` + `fs.writeFile` and
`dialog.showOpenDialog({ properties: ['openFile'] })` + `fs.readFile`.

New channels:
- `accountsExport: { args: [{ accountIds: string[]; password?: string }]; res: Result<string> }`
  — for each id: `accounts.get(id)` + `secrets.get(id)`; skip ids with no
  account; if a selected account's secret can't be read → `err`. Build
  `ExportAccount[]`, call `exportAccounts`, return the string.
- `accountsImport: { args: [{ blob: string; password?: string }]; res: Result<Account[]> }`
  — `importAccounts(blob, password)`; validate every provider is known and
  resolve conn params (reuse the existing create-path validation); then in **one
  `db.transaction`** create each account + `secrets.set`. Return the created
  accounts. Any validation failure → `err` before writing anything.
- `saveTextFile: { args: [{ defaultName: string; contents: string }]; res: Result<{ saved: boolean }> }`
- `openTextFile: { args: []; res: Result<string | null> }`

`preload.ts` exposes all four.

### Renderer

- Hooks `src/renderer/hooks/useAccountTransfer.ts`: `useExportAccounts()` and
  `useImportAccounts()` mutations (the latter invalidates the accounts query on
  success). Plus thin wrappers for `saveTextFile` / `openTextFile` used by the
  dialogs.
- `ExportAccountsDialog({ accountIds, onClose })` — optional password field;
  "Generate" → `accountsExport` → shows the result in a readonly textarea with
  **Copy** and **Download** (`saveTextFile`, default name
  `s3manager-accounts.txt`). Shows the no-password warning when the field is
  empty.
- `ImportAccountsDialog({ onClose, onImported })` — paste textarea + **Load
  file** (`openTextFile` fills the textarea) + optional password field;
  "Import" → `accountsImport`. On `PasswordRequired`/`IncorrectPassword`, show an
  inline message asking for (or correcting) the password and keep the dialog
  open. On success: toast "N imported", call `onImported`, close.

### `ConnectionsScreen` entry points

- Header (list view): existing "Add account" plus **Import** and **Export all**
  (the latter disabled when there are zero accounts).
- Each account row: a new **Export** icon button alongside edit/remove, opening
  `ExportAccountsDialog` with that single id.

## Error handling & edge cases

- Encryption unavailable (`secrets.get` can't decrypt) → export `err` with a
  clear message.
- Import of an unknown provider or invalid endpoint → `err`, nothing created.
- Wrong/missing password → mapped error surfaced inline in the import dialog.
- Empty selection / empty paste → button disabled.
- Tampered ciphertext → GCM failure → `IncorrectPassword` (we don't distinguish
  tamper from wrong key; both mean "can't decrypt").

## i18n

New keys in all six locales for both dialogs and the entry-point buttons
(generate, copy, download, password, no-password warning, paste, load file,
import, "N imported", error messages, export/import/export-all labels and aria).

## Testing (TDD)

- `accountTransfer.test.ts`: round-trip with and without password; wrong
  password → `IncorrectPassword`; encrypted blob + no password →
  `PasswordRequired`; non-base64 / wrong-format / wrong-version → `InvalidData`;
  tampered ciphertext → `IncorrectPassword`; multi-account round-trip.
- `register.test.ts`: `accountsExport` returns a string that decodes to the
  selected account incl. its secret (stub secrets); `accountsImport` creates the
  accounts + secrets (assert repo + secrets state) and is all-or-nothing on a
  bad provider; `saveTextFile`/`openTextFile` delegate to the injected helpers.
- `ExportAccountsDialog.test.tsx`: generate shows the string; download calls
  `saveTextFile`; no-password warning visible/hidden.
- `ImportAccountsDialog.test.tsx`: paste + import calls `accountsImport`; load
  file fills the textarea; incorrect-password path shows the inline error.
- `ConnectionsScreen.test.tsx`: row Export opens the dialog; header Import /
  Export all open their dialogs; Export all disabled with zero accounts.

## Out of scope

- Cloud sync of accounts; QR codes; key rotation; merging/dedup on import;
  exporting bucket/sync configuration. Only accounts + their secrets.

## Open questions

None.
